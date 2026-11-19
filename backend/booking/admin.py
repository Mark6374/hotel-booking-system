"""Django admin for the hotel staff. See ADMIN.md.

Rules used here:
  * Money and history are never edited by hand: payments are read-only, a booking's status changes
    only through the actions (which also refund / log), and nothing that has history can be deleted.
  * Every status change made in the admin is written to the admin log (who, what, when).
  * What a person may do is decided by Django permissions / groups (python manage.py setup_admin_groups).
"""
import datetime

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.models import LogEntry
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.urls import reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .reviews import HIDDEN, PUBLISHED, RoomReview
from .roles import ROLES, GuestRole
from .serializers import PHONE_MESSAGE, PHONE_RE

ACTIVE = ('Confirmed', 'CheckedIn')

BADGES = {
    'Confirmed': 'info', 'CheckedIn': 'ok', 'Completed': 'muted', 'Cancelled': 'bad',
    'Available': 'ok', 'Maintenance': 'warn',
    'Paid': 'ok', 'Refunded': 'warn', 'Failed': 'bad',
    'Published': 'ok', 'Hidden': 'bad',
}


def badge(text):
    return format_html('<span class="hb hb-{}">{}</span>', BADGES.get(text, 'muted'), text)


def stars(n):
    n = int(n or 0)
    return format_html('<span class="hb-stars" title="{}/5">{}{}</span>', n, '★' * n, '☆' * (5 - n))


def link(obj, label=None):
    url = reverse('admin:booking_%s_change' % obj._meta.model_name, args=[obj.pk])
    return format_html('<a href="{}">{}</a>', url, label or str(obj))


class HotelModelAdmin(admin.ModelAdmin):
    list_per_page = 50
    show_full_result_count = False

    class Media:
        css = {'all': ('booking/admin.css',)}


class NoDeleteMixin:
    """Rows with history are never deleted from the admin (the database also refuses it)."""

    def has_delete_permission(self, request, obj=None):
        return False


class ReadOnlyMixin(NoDeleteMixin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# ======================================================================= guests

class AccountFilter(admin.SimpleListFilter):
    title = 'website login'
    parameter_name = 'account'

    def lookups(self, request, model_admin):
        return (('yes', 'Has a login'), ('no', 'No login (walk-in guest)'))

    def queryset(self, request, queryset):
        has = Q(password__isnull=False) & ~Q(password='')
        return {'yes': queryset.filter(has), 'no': queryset.exclude(has)}.get(self.value(), queryset)


class GuestForm(forms.ModelForm):
    email = forms.EmailField(max_length=100)

    class Meta:
        model = Guest
        exclude = ('password',)           # the hash is never shown or edited here

    def clean_email(self):
        return self.cleaned_data['email'].strip().lower()

    def clean_phone(self):
        value = self.cleaned_data['phone'].strip()
        if not PHONE_RE.match(value):
            raise forms.ValidationError(PHONE_MESSAGE)
        return value


class GuestRoleInline(admin.StackedInline):
    model = GuestRole
    can_delete = False
    max_num = 1
    extra = 0
    verbose_name = 'website role'
    verbose_name_plural = 'website role (empty = ordinary guest account)'


@admin.register(Guest)
class GuestAdmin(NoDeleteMixin, HotelModelAdmin):
    form = GuestForm
    inlines = [GuestRoleInline]
    list_display = ('guest_id', 'full_name', 'email', 'phone', 'has_login', 'role', 'bookings', 'reviews')
    list_display_links = ('guest_id', 'full_name')
    list_filter = (AccountFilter,)
    search_fields = ('first_name', 'last_name', 'email', 'phone')
    ordering = ('-guest_id',)
    list_select_related = ('role_row',)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            n_bookings=Count('booking', distinct=True),
            n_reviews=Count('booking__bookingroom__review', distinct=True))

    @admin.display(description='Name', ordering='last_name')
    def full_name(self, obj):
        return str(obj)

    @admin.display(boolean=True, description='Login')
    def has_login(self, obj):
        return bool(obj.password)

    @admin.display(description='Role')
    def role(self, obj):
        try:
            row = obj.role_row
        except ObjectDoesNotExist:
            return 'guest'
        return row.role if row.is_active else format_html('{} <span class="hb hb-bad">blocked</span>', row.role)

    @admin.display(description='Bookings', ordering='n_bookings')
    def bookings(self, obj):
        return obj.n_bookings

    @admin.display(description='Reviews', ordering='n_reviews')
    def reviews(self, obj):
        return obj.n_reviews


class GuestRoleForm(forms.ModelForm):
    role = forms.ChoiceField(choices=[(r, r) for r in ROLES])

    class Meta:
        model = GuestRole
        fields = '__all__'


@admin.register(GuestRole)
class GuestRoleAdmin(NoDeleteMixin, HotelModelAdmin):
    """Who is staff / admin on the website, and who is blocked."""
    form = GuestRoleForm
    list_display = ('guest', 'role', 'is_active')
    list_filter = ('role', 'is_active')
    list_editable = ('is_active',)
    search_fields = ('guest__first_name', 'guest__last_name', 'guest__email')
    autocomplete_fields = ('guest',)
    actions = ('block', 'unblock')

    def get_readonly_fields(self, request, obj=None):
        return ('guest',) if obj else ()

    def _set_active(self, request, queryset, value):
        changed = 0
        for row in queryset.exclude(is_active=value):
            row.is_active = value
            row.save(update_fields=['is_active'])
            self.log_change(request, row, 'Account %s' % ('unblocked' if value else 'blocked'))
            changed += 1
        self.message_user(request, '%d account(s) %s.' % (changed, 'unblocked' if value else 'blocked'))

    @admin.action(description='Block selected accounts (they cannot use the website)', permissions=['change'])
    def block(self, request, queryset):
        self._set_active(request, queryset, False)

    @admin.action(description='Unblock selected accounts', permissions=['change'])
    def unblock(self, request, queryset):
        self._set_active(request, queryset, True)


# ======================================================================= rooms

class PriceForm(forms.ModelForm):
    class Meta:
        model = RoomType
        fields = '__all__'

    def clean_price_per_night(self):
        price = self.cleaned_data['price_per_night']
        if not 0 < price < 100000:
            raise forms.ValidationError('Enter a price above 0.')
        return price

    def clean_capacity(self):
        capacity = self.cleaned_data['capacity']
        if not 1 <= capacity <= 10:
            raise forms.ValidationError('Capacity must be between 1 and 10.')
        return capacity


def _published(prefix):
    return Q(**{prefix + 'status': PUBLISHED})


@admin.register(RoomType)
class RoomTypeAdmin(NoDeleteMixin, HotelModelAdmin):
    form = PriceForm
    list_display = ('type_name', 'capacity', 'price_per_night', 'rooms', 'rating')
    list_editable = ('price_per_night',)
    search_fields = ('type_name',)
    ordering = ('price_per_night',)
    fieldsets = ((None, {'fields': ('type_name', 'capacity', 'price_per_night', 'description'),
                         'description': 'A new price applies to new bookings only. Existing bookings keep '
                                        'the price they were made with.'}),)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            n_rooms=Count('room', distinct=True),
            avg_rating=Avg('room__bookingroom__review__rating',
                           filter=_published('room__bookingroom__review__')),
            n_reviews=Count('room__bookingroom__review', filter=_published('room__bookingroom__review__')))

    @admin.display(description='Rooms', ordering='n_rooms')
    def rooms(self, obj):
        return obj.n_rooms

    @admin.display(description='Guest rating', ordering='avg_rating')
    def rating(self, obj):
        return _rating_cell(obj.avg_rating, obj.n_reviews)


def _rating_cell(avg, n):
    if not n:
        return mark_safe('<span class="hb-dim">no reviews</span>')
    return format_html('{} <b>{}</b> <span class="hb-dim">({})</span>', stars(round(avg)), round(avg, 1), n)


class RoomForm(forms.ModelForm):
    status = forms.ChoiceField(choices=[('Available', 'Available'), ('Maintenance', 'Maintenance')])

    class Meta:
        model = Room
        fields = '__all__'

    def clean_floor(self):
        floor = self.cleaned_data['floor']
        if not 0 <= floor <= 50:
            raise forms.ValidationError('Floor must be between 0 and 50.')
        return floor


@admin.register(Room)
class RoomAdmin(NoDeleteMixin, HotelModelAdmin):
    form = RoomForm
    list_display = ('room_number', 'floor', 'room_type', 'state', 'rating', 'reviews_link')
    list_filter = ('status', 'room_type', 'floor')
    search_fields = ('room_number',)
    ordering = ('room_number',)
    list_select_related = ('room_type',)
    actions = ('close_for_maintenance', 'reopen')

    def get_queryset(self, request):
        pub = _published('bookingroom__review__')
        return super().get_queryset(request).annotate(
            avg_rating=Avg('bookingroom__review__rating', filter=pub),
            n_reviews=Count('bookingroom__review', filter=pub))

    @admin.display(description='Status', ordering='status')
    def state(self, obj):
        return badge(obj.status)

    @admin.display(description='Guest rating', ordering='avg_rating')
    def rating(self, obj):
        return _rating_cell(obj.avg_rating, obj.n_reviews)

    @admin.display(description='Reviews')
    def reviews_link(self, obj):
        url = reverse('admin:booking_roomreview_changelist') + '?booking_room__room__exact=%d' % obj.pk
        return format_html('<a href="{}">open</a>', url)

    def _set_status(self, request, queryset, old, new):
        rooms = list(queryset.filter(status=old))
        for room in rooms:
            room.status = new
            room.save(update_fields=['status'])
            self.log_change(request, room, 'Status %s → %s' % (old, new))
        self.message_user(request, '%d room(s) set to %s.' % (len(rooms), new))
        return rooms

    @admin.action(description='Close selected rooms for maintenance', permissions=['change'])
    def close_for_maintenance(self, request, queryset):
        rooms = self._set_status(request, queryset, 'Available', 'Maintenance')
        busy = (BookingRoom.objects
                .filter(room__in=rooms, booking__status__in=ACTIVE, booking__check_out__gt=datetime.date.today())
                .values_list('room__room_number', flat=True).distinct())
        if busy:
            self.message_user(request, 'Careful: active bookings still exist for room(s) %s. Move those guests.'
                              % ', '.join(sorted(busy)), messages.WARNING)

    @admin.action(description='Reopen selected rooms (Available)', permissions=['change'])
    def reopen(self, request, queryset):
        self._set_status(request, queryset, 'Maintenance', 'Available')


# ======================================================================= bookings and payments

class BookingRoomInline(admin.TabularInline):
    model = BookingRoom
    extra = 0
    can_delete = False
    fields = ('room', 'guests_count', 'price_per_night')
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    can_delete = False
    fields = ('payment_id', 'amount', 'payment_method', 'payment_status', 'payment_date')
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Booking)
class BookingAdmin(NoDeleteMixin, HotelModelAdmin):
    """Bookings are created on the website, so here they are read-only. The status moves with the
    actions below; these use the same rules as the API (frontend_api.py)."""
    inlines = [BookingRoomInline, PaymentInline]
    list_display = ('booking_id', 'guest', 'room_numbers', 'stay', 'state', 'total', 'payment')
    list_display_links = ('booking_id', 'guest')
    list_filter = ('status', 'check_in')
    date_hierarchy = 'check_in'
    search_fields = ('=booking_id', 'guest__first_name', 'guest__last_name', 'guest__email',
                     'bookingroom__room__room_number')
    ordering = ('-booking_id',)
    list_select_related = ('guest',)
    actions = ('check_in_selected', 'check_out_selected', 'cancel_selected')

    def has_add_permission(self, request):
        return False                       # bookings are made on the website (they need payment + checks)

    def has_change_permission(self, request, obj=None):
        return False                       # view-only page; changes go through the actions

    def has_transition_permission(self, request):
        return request.user.has_perm('booking.change_booking')

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related('bookingroom__room', 'payment_set')

    @admin.display(description='Rooms')
    def room_numbers(self, obj):
        return ', '.join(br.room.room_number for br in obj.bookingroom.all())

    @admin.display(description='Stay', ordering='check_in')
    def stay(self, obj):
        return format_html('<span class="hb-nw">{} → {} ({} n)</span>', obj.check_in.strftime('%d %b'),
                           obj.check_out.strftime('%d %b'), (obj.check_out - obj.check_in).days)

    @admin.display(description='Status', ordering='status')
    def state(self, obj):
        return badge(obj.status)

    @admin.display(description='Total')
    def total(self, obj):
        return sum(br.price_per_night for br in obj.bookingroom.all()) * (obj.check_out - obj.check_in).days

    @admin.display(description='Payment')
    def payment(self, obj):
        states = [p.payment_status for p in obj.payment_set.all()]
        if not states:
            return mark_safe('<span class="hb-dim">none</span>')
        return badge('Paid' if 'Paid' in states else states[-1])

    def _move(self, request, queryset, old, new, refund=False):
        done = skipped = 0
        ids = list(queryset.values_list('pk', flat=True))
        with transaction.atomic():
            for booking in Booking.objects.select_for_update().filter(pk__in=ids):
                if booking.status != old:
                    skipped += 1
                    continue
                booking.status = new
                booking.save(update_fields=['status'])
                note = 'Status %s → %s' % (old, new)
                if refund:
                    refunded = Payment.objects.filter(booking=booking, payment_status='Paid') \
                        .update(payment_status='Refunded')
                    note += '; %d payment(s) refunded' % refunded
                self.log_change(request, booking, note)
                done += 1
        self.message_user(request, '%d booking(s) moved to %s.' % (done, new),
                          messages.SUCCESS if done else messages.WARNING)
        if skipped:
            self.message_user(request, '%d booking(s) skipped: only %s bookings can move to %s.'
                              % (skipped, old, new), messages.WARNING)

    @admin.action(description='Check in selected (Confirmed → CheckedIn)', permissions=['transition'])
    def check_in_selected(self, request, queryset):
        self._move(request, queryset, 'Confirmed', 'CheckedIn')

    @admin.action(description='Check out selected (CheckedIn → Completed)', permissions=['transition'])
    def check_out_selected(self, request, queryset):
        self._move(request, queryset, 'CheckedIn', 'Completed')

    @admin.action(description='Cancel selected and refund payments (Confirmed → Cancelled)',
                  permissions=['transition'])
    def cancel_selected(self, request, queryset):
        self._move(request, queryset, 'Confirmed', 'Cancelled', refund=True)


@admin.register(Payment)
class PaymentAdmin(ReadOnlyMixin, HotelModelAdmin):
    """Payments are a financial record: view only."""
    list_display = ('payment_id', 'booking_link', 'guest', 'amount', 'payment_method', 'state', 'payment_date')
    list_display_links = ('payment_id',)
    list_filter = ('payment_status', 'payment_method', 'payment_date')
    date_hierarchy = 'payment_date'
    search_fields = ('=payment_id', '=booking__booking_id', 'booking__guest__email', 'booking__guest__last_name')
    ordering = ('-payment_id',)
    list_select_related = ('booking__guest',)

    @admin.display(description='Booking', ordering='booking_id')
    def booking_link(self, obj):
        return link(obj.booking, '#%s' % obj.booking_id)

    @admin.display(description='Guest')
    def guest(self, obj):
        return obj.booking.guest

    @admin.display(description='Status', ordering='payment_status')
    def state(self, obj):
        return badge(obj.payment_status)


# ======================================================================= reviews

class ReviewForm(forms.ModelForm):
    status = forms.ChoiceField(choices=[(PUBLISHED, 'Published (visible on the website)'),
                                        (HIDDEN, 'Hidden (removed from the website)')])

    class Meta:
        model = RoomReview
        fields = ('status',)


@admin.register(RoomReview)
class RoomReviewAdmin(HotelModelAdmin):
    """Moderation: read the review, hide it or publish it again. The words of a guest are not edited."""
    form = ReviewForm
    list_display = ('review_id', 'room', 'stars', 'excerpt', 'guest', 'state', 'created_at')
    list_display_links = ('review_id', 'excerpt')
    list_filter = ('status', 'rating', 'booking_room__room__room_type', 'booking_room__room', 'created_at')
    date_hierarchy = 'created_at'
    search_fields = ('comment', 'booking_room__room__room_number', 'booking_room__booking__guest__email',
                     'booking_room__booking__guest__last_name', 'booking_room__booking__guest__first_name')
    ordering = ('-created_at', '-review_id')
    list_select_related = ('booking_room__room__room_type', 'booking_room__booking__guest')
    actions = ('hide', 'publish')

    fields = ('room', 'guest', 'stay', 'stars', 'comment_text', 'created_at', 'updated_at', 'status')
    readonly_fields = ('room', 'guest', 'stay', 'stars', 'comment_text', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False                      # reviews come from guests with a finished stay

    @admin.display(description='Room', ordering='booking_room__room__room_number')
    def room(self, obj):
        return '%s (%s)' % (obj.booking_room.room, obj.booking_room.room.room_type)

    @admin.display(description='Guest')
    def guest(self, obj):
        return obj.booking_room.booking.guest

    @admin.display(description='Stay')
    def stay(self, obj):
        b = obj.booking_room.booking
        return format_html('{} → {} ({})', b.check_in, b.check_out, link(b, 'booking #%s' % b.pk))

    @admin.display(description='Rating', ordering='rating')
    def stars(self, obj):
        return stars(obj.rating)

    @admin.display(description='Comment')
    def comment_text(self, obj):
        return format_html('<div class="hb-comment">{}</div>', obj.comment) if obj.comment else '—'

    @admin.display(description='Comment')
    def excerpt(self, obj):
        text = obj.comment
        return (text[:45] + '…') if len(text) > 45 else (text or '—')

    @admin.display(description='Status', ordering='status')
    def state(self, obj):
        return badge(obj.status)

    def _set_status(self, request, queryset, new):
        changed = 0
        for review in queryset.exclude(status=new):
            old = review.status
            review.status = new
            review.save(update_fields=['status'])
            self.log_change(request, review, 'Status %s → %s' % (old, new))
            changed += 1
        self.message_user(request, '%d review(s) set to %s.' % (changed, new))

    @admin.action(description='Hide selected reviews (remove from the website)', permissions=['change'])
    def hide(self, request, queryset):
        self._set_status(request, queryset, HIDDEN)

    @admin.action(description='Publish selected reviews', permissions=['change'])
    def publish(self, request, queryset):
        self._set_status(request, queryset, PUBLISHED)


# ======================================================================= audit trail

@admin.register(LogEntry)
class LogEntryAdmin(ReadOnlyMixin, admin.ModelAdmin):
    """Who changed what in this admin. Superusers only."""
    list_display = ('action_time', 'user', 'content_type', 'object_repr', 'action', 'change_message')
    list_filter = ('action_flag', 'content_type', 'user')
    date_hierarchy = 'action_time'
    search_fields = ('object_repr', 'change_message', 'user__username')
    list_select_related = ('user', 'content_type')
    list_per_page = 50

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    @admin.display(description='Action')
    def action(self, obj):
        return obj.get_action_flag_display() if hasattr(obj, 'get_action_flag_display') else obj.action_flag
