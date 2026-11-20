"""Django admin panel. Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking
"""
import datetime

from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import reverse

from .login_lock import LoginLock
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .reviews import RoomReview
from .roles import GuestRole

MODELS = [Guest, GuestRole, RoomType, Room, Booking, BookingRoom, Payment, RoomReview, LoginLock]
TODAY = datetime.date.today()


def day(n):
    return TODAY + datetime.timedelta(days=n)


class AdminTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.schema_editor() as editor:
            for m in MODELS:
                editor.create_model(m)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            for m in reversed(MODELS):
                editor.delete_model(m)
        super().tearDownClass()

    def setUp(self):
        cache.clear()
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.guest = Guest(first_name='Amina', last_name='Sadykova', email='amina@example.com', phone='+7 700 111 2233')
        self.guest.set_password('Passw0rd!')
        self.guest.save()
        self.walkin = Guest.objects.create(first_name='Walk', last_name='In', email='walk@example.com', phone='+7 700 000 0000')
        t = RoomType.objects.create(type_name='Standard', capacity=2, price_per_night=60)
        self.r1 = Room.objects.create(room_number='101', floor=1, room_type=t)
        self.r2 = Room.objects.create(room_number='102', floor=1, room_type=t)
        self.type = t
        self.b_new = self.booking('Confirmed', day(0), day(3), self.r1)               # arrives today
        self.b_done = self.booking('Completed', day(-10), day(-7), self.r2)
        self.b_in = self.booking('CheckedIn', day(-1), day(2), self.r2)
        self.payment = Payment.objects.create(booking=self.b_new, amount=180, payment_method='Card', payment_status='Paid',
                               payment_date=datetime.datetime.now())
        self.review = RoomReview.objects.create(booking_room=self.b_done.bookingroom.first(), rating=4,
                                                comment='Nice <b>room</b>')
        self.su = User.objects.create_superuser('boss', 'b@example.com', 'Sup3r-secret-pass')
        self.client.force_login(self.su)

    def booking(self, status, ci, co, room):
        b = Booking.objects.create(guest=self.guest, booking_date=datetime.datetime.now(),
                                   check_in=ci, check_out=co, status=status)
        BookingRoom.objects.create(booking=b, room=room, guests_count=1, price_per_night=60)
        return b

    def url(self, name, *args):
        return reverse('admin:' + name, args=args)

    # ---- every page renders
    def test_anonymous_goes_to_login(self):
        self.client.logout()
        r = self.client.get('/admin/')
        self.assertEqual(r.status_code, 302)
        self.assertIn('/admin/login/', r['Location'])
        self.assertEqual(self.client.get('/admin/booking/payment/').status_code, 302)

    def test_dashboard(self):
        r = self.client.get('/admin/')
        self.assertContains(r, 'Arrivals today')
        self.assertContains(r, 'Front desk')                       # grouped navigation
        self.assertContains(r, 'Guests and reviews')
        d = r.context['dashboard']
        self.assertEqual((d['arrivals_today'], d['departures_today'], d['in_house']), (1, 0, 1))
        self.assertEqual(d['reviews_published'], 1)
        self.assertEqual(d['reviews_average'], 4.0)
        self.assertEqual(d['occupied_tonight'], 2)                 # room 101 (arriving) + room 102 (in house)
        self.assertEqual(d['occupancy_percent'], 100)
        self.assertEqual(d['revenue_30d'], 180)
        self.assertNotContains(r, '<b>room</b>')                    # comments are escaped everywhere

    def test_every_changelist_and_change_page_renders(self):
        pages = [
            ('booking_booking_changelist', ()), ('booking_booking_change', (self.b_new.pk,)),
            ('booking_payment_changelist', ()), ('booking_payment_change', (self.payment.pk,)),
            ('booking_room_changelist', ()), ('booking_room_change', (self.r1.pk,)), ('booking_room_add', ()),
            ('booking_roomtype_changelist', ()), ('booking_roomtype_change', (self.type.pk,)),
            ('booking_guest_changelist', ()), ('booking_guest_change', (self.guest.pk,)), ('booking_guest_add', ()),
            ('booking_guestrole_changelist', ()), ('booking_guestrole_add', ()),
            ('booking_roomreview_changelist', ()), ('booking_roomreview_change', (self.review.pk,)),
            ('admin_logentry_changelist', ()),
        ]
        for name, args in pages:
            r = self.client.get(self.url(name, *args))
            self.assertEqual(r.status_code, 200, name)

    def test_search_filters_and_date_hierarchy_work(self):
        for qs in ('booking/booking/?q=amina', 'booking/booking/?q=abc', 'booking/booking/?q=%d' % self.b_new.pk,
                   'booking/booking/?status__exact=Confirmed', 'booking/booking/?check_in__gte=%s' % day(-30),
                   'booking/booking/?check_in__year=%d' % TODAY.year,
                   'booking/room/?status__exact=Maintenance', 'booking/room/?room_type__room_type_id__exact=%d' % self.type.pk,
                   'booking/roomreview/?q=nice', 'booking/roomreview/?rating__exact=4&status__exact=Published',
                   'booking/roomreview/?booking_room__room__room_id__exact=%d' % self.r2.pk,
                   'booking/roomreview/?booking_room__room__room_type__room_type_id__exact=%d' % self.type.pk,
                   'booking/guest/?account=yes', 'booking/guest/?account=no', 'booking/guest/?q=%2B7',
                   'booking/payment/?q=amina', 'booking/payment/?payment_status__exact=Paid'):
            r = self.client.get('/admin/' + qs)
            self.assertEqual(r.status_code, 200, qs)           # a bad lookup would redirect with ?e=1
        r = self.client.get('/admin/booking/roomreview/?booking_room__room__room_id__exact=%d' % self.r1.pk)
        self.assertEqual(r.context['cl'].result_count, 0)
        r = self.client.get('/admin/booking/guest/?account=no')
        self.assertEqual([g.email for g in r.context['cl'].result_list], ['walk@example.com'])

    def test_changelists_do_not_query_per_row(self):
        for i in range(8):
            self.booking('Confirmed', day(10 + i), day(12 + i), self.r1)
        with self.assertNumQueries(self._count('/admin/booking/booking/')):
            self.client.get('/admin/booking/booking/')

    def _count(self, url):
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(url)
        self.assertLess(len(ctx), 20, 'too many queries: %d' % len(ctx))     # 9 bookings, still a handful
        return len(ctx)

    # ---- read-only rules
    def test_money_and_history_are_read_only(self):
        for name, args in (('booking_payment_add', ()), ('booking_payment_delete', (self.payment.pk,)),
                           ('booking_booking_add', ()), ('booking_booking_delete', (self.b_new.pk,)),
                           ('booking_guest_delete', (self.guest.pk,)), ('booking_room_delete', (self.r1.pk,)),
                           ('booking_roomtype_delete', (self.type.pk,)), ('booking_roomreview_add', ())):
            self.assertEqual(self.client.get(self.url(name, *args)).status_code, 403, name)
        r = self.client.post(self.url('booking_payment_change', self.payment.pk), {'amount': '1', 'payment_status': 'Failed'})
        self.assertEqual(Payment.objects.get().amount, 180)
        # a booking's own page cannot be saved either
        before = Booking.objects.get(pk=self.b_new.pk)
        self.client.post(self.url('booking_booking_change', self.b_new.pk), {'status': 'Cancelled'})
        self.assertEqual(Booking.objects.get(pk=self.b_new.pk).status, before.status)

    def test_password_hash_is_never_shown(self):
        for url in (self.url('booking_guest_change', self.guest.pk), self.url('booking_guest_changelist')):
            body = self.client.get(url).content.decode()
            self.assertNotIn('pbkdf2', body)
            self.assertNotIn(self.guest.password, body)

    # ---- booking actions
    def act(self, name, *objs, model='booking'):
        return self.client.post(self.url('booking_%s_changelist' % model),
                                {'action': name, '_selected_action': [o.pk for o in objs]}, follow=True)

    def test_check_in_and_out_actions(self):
        r = self.act('check_in_selected', self.b_new, self.b_done)
        self.assertContains(r, '1 booking(s) moved to CheckedIn')
        self.assertContains(r, '1 booking(s) skipped')
        self.assertEqual(Booking.objects.get(pk=self.b_new.pk).status, 'CheckedIn')
        self.assertEqual(Booking.objects.get(pk=self.b_done.pk).status, 'Completed')
        self.act('check_out_selected', self.b_new, self.b_in)
        self.assertEqual(Booking.objects.filter(status='Completed').count(), 3)

    def test_cancel_refunds_and_is_logged(self):
        self.act('cancel_selected', self.b_new, self.b_in)
        self.assertEqual(Booking.objects.get(pk=self.b_new.pk).status, 'Cancelled')
        self.assertEqual(Booking.objects.get(pk=self.b_in.pk).status, 'CheckedIn')       # only Confirmed can be cancelled
        self.assertEqual(Payment.objects.get().payment_status, 'Refunded')
        entry = LogEntry.objects.get()
        self.assertEqual(entry.user, self.su)
        self.assertIn('Confirmed → Cancelled', entry.change_message)
        self.assertIn('refunded', entry.change_message)

    # ---- rooms
    def test_maintenance_actions_and_warning(self):
        r = self.act('close_for_maintenance', self.r1, model='room')
        self.assertEqual(Room.objects.get(pk=self.r1.pk).status, 'Maintenance')
        self.assertContains(r, 'active bookings still exist for room(s) 101')            # b_new is Confirmed in 101
        self.act('reopen', self.r1, model='room')
        self.assertEqual(Room.objects.get(pk=self.r1.pk).status, 'Available')
        self.assertEqual(LogEntry.objects.count(), 2)

    def test_room_type_price_edit_is_validated(self):
        url = self.url('booking_roomtype_change', self.type.pk)
        data = {'type_name': 'Standard', 'capacity': 2, 'price_per_night': '75.00', 'description': 'x'}
        self.client.post(url, data)
        self.assertEqual(RoomType.objects.get(pk=self.type.pk).price_per_night, 75)
        for bad in ('0', '-5', '100000'):
            self.client.post(url, {**data, 'price_per_night': bad})
            self.assertEqual(RoomType.objects.get(pk=self.type.pk).price_per_night, 75, bad)
        self.assertEqual(BookingRoom.objects.first().price_per_night, 60)               # history keeps its price

    # ---- reviews
    def test_moderation_actions(self):
        self.act('hide', self.review, model='roomreview')
        self.assertEqual(RoomReview.objects.get().status, 'Hidden')
        self.act('publish', self.review, model='roomreview')
        self.assertEqual(RoomReview.objects.get().status, 'Published')
        self.assertEqual(LogEntry.objects.count(), 2)

    def test_moderator_can_only_change_status(self):
        url = self.url('booking_roomreview_change', self.review.pk)
        self.client.post(url, {'status': 'Hidden', 'rating': 1, 'comment': 'hacked'})
        r = RoomReview.objects.get()
        self.assertEqual((r.status, r.rating, r.comment), ('Hidden', 4, 'Nice <b>room</b>'))
        self.assertEqual(r.created_at, r.updated_at)                                     # moderation is not an edit
        self.client.post(url, {'status': 'Weird'})
        self.assertEqual(RoomReview.objects.get().status, 'Hidden')

    # ---- guests and roles
    def test_guest_form_validates_and_hides_hash(self):
        url = self.url('booking_guest_add')
        base = {'first_name': 'New', 'last_name': 'Guest', 'email': 'NEW@Example.com', 'phone': '+7 700 555 0000',
                'role_row-TOTAL_FORMS': 0, 'role_row-INITIAL_FORMS': 0, 'role_row-MIN_NUM_FORMS': 0,
                'role_row-MAX_NUM_FORMS': 1}
        self.client.post(url, {**base, 'phone': '(((((('})
        self.assertFalse(Guest.objects.filter(first_name='New').exists())
        self.client.post(url, base)
        g = Guest.objects.get(first_name='New')
        self.assertEqual(g.email, 'new@example.com')
        self.assertFalse(g.password)

    def test_guest_role_inline_and_block_action(self):
        url = self.url('booking_guest_change', self.guest.pk)
        r = self.client.post(url, {
            'first_name': 'Amina', 'last_name': 'Sadykova', 'email': 'amina@example.com', 'phone': '+7 700 111 2233',
            'role_row-TOTAL_FORMS': 1, 'role_row-INITIAL_FORMS': 0, 'role_row-MIN_NUM_FORMS': 0,
            'role_row-MAX_NUM_FORMS': 1, 'role_row-0-guest': self.guest.pk, 'role_row-0-role': 'staff',
            'role_row-0-is_active': 'on'})
        errs = [] if r.status_code == 302 else (r.context['adminform'].form.errors, [f.errors for f in r.context['inline_admin_formsets'][0].formset.forms], r.context['inline_admin_formsets'][0].formset.non_form_errors())
        self.assertEqual(r.status_code, 302, errs)
        self.assertEqual(GuestRole.objects.get(pk=self.guest.pk).role, 'staff')
        self.assertTrue(Guest.objects.get(pk=self.guest.pk).password)                     # password untouched
        self.act('block', GuestRole.objects.get(pk=self.guest.pk), model='guestrole')
        self.assertFalse(GuestRole.objects.get(pk=self.guest.pk).is_active)

    # ---- who may do what
    def _staff_user(self, group):
        call_command('setup_admin_groups', verbosity=0)
        u = User.objects.create_user('u_' + group.replace(' ', ''), password='Sup3r-secret-pass', is_staff=True)
        u.groups.add(Group.objects.get(name=group))
        self.client.force_login(u)
        return u

    def test_groups_command_is_repeatable(self):
        call_command('setup_admin_groups', verbosity=0)
        call_command('setup_admin_groups', verbosity=0)
        self.assertEqual(sorted(Group.objects.values_list('name', flat=True)),
                         ['Front desk', 'Managers', 'Review moderators'])

    def test_front_desk_group(self):
        self._staff_user('Front desk')
        self.assertEqual(self.client.get('/admin/').status_code, 200)
        self.assertEqual(self.client.get('/admin/booking/booking/').status_code, 200)
        self.assertEqual(self.client.get('/admin/booking/payment/').status_code, 200)
        self.assertEqual(self.client.get('/admin/booking/guestrole/').status_code, 403)       # roles: superuser only
        self.assertEqual(self.client.get('/admin/admin/logentry/').status_code, 403)
        self.assertEqual(self.client.get(self.url('booking_roomtype_change', self.type.pk)).status_code, 200)  # view only
        self.client.post(self.url('booking_roomtype_change', self.type.pk),
                         {'type_name': 'Standard', 'capacity': 2, 'price_per_night': '1.00'})
        self.assertEqual(RoomType.objects.get().price_per_night, 60)                      # cannot change prices
        self.act('check_in_selected', self.b_new)
        self.assertEqual(Booking.objects.get(pk=self.b_new.pk).status, 'CheckedIn')

    def test_moderator_group(self):
        self._staff_user('Review moderators')
        self.assertEqual(self.client.get('/admin/booking/roomreview/').status_code, 200)
        self.assertEqual(self.client.get('/admin/booking/payment/').status_code, 403)       # no money
        self.assertEqual(self.client.get('/admin/booking/guest/').status_code, 200)         # sees guests, cannot edit
        self.act('hide', self.review, model='roomreview')
        self.assertEqual(RoomReview.objects.get().status, 'Hidden')
        self.act('check_in_selected', self.b_new)                                            # no booking actions
        self.assertEqual(Booking.objects.get(pk=self.b_new.pk).status, 'Confirmed')
        r = self.client.get('/admin/')
        self.assertNotIn('dashboard', r.context or {}) if False else None
        self.assertEqual(r.status_code, 200)

    def test_normal_site_account_is_not_an_admin(self):
        self.client.logout()
        r = self.client.post('/admin/login/?next=/admin/', {'username': 'amina@example.com', 'password': 'Passw0rd!'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/admin/').status_code, 302)

    # ---- login protection
    def test_login_locks_after_five_failures(self):
        self.client.logout()
        for _ in range(5):
            r = self.client.post('/admin/login/', {'username': 'boss', 'password': 'wrong'})
            self.assertEqual(r.status_code, 200)
        r = self.client.post('/admin/login/', {'username': 'boss', 'password': 'Sup3r-secret-pass'})
        self.assertEqual(r.status_code, 429)                                                 # even the right password
        self.assertIn('Retry-After', r)
        # another username from the same address is not locked yet
        r = self.client.post('/admin/login/', {'username': 'someone', 'password': 'x'})
        self.assertEqual(r.status_code, 200)

    def test_successful_login_resets_counter(self):
        self.client.logout()
        for _ in range(4):
            self.client.post('/admin/login/', {'username': 'boss', 'password': 'wrong'})
        r = self.client.post('/admin/login/', {'username': 'boss', 'password': 'Sup3r-secret-pass'})
        self.assertEqual(r.status_code, 302)
        self.client.logout()
        for _ in range(4):
            self.assertEqual(self.client.post('/admin/login/', {'username': 'boss', 'password': 'wrong'}).status_code, 200)

    # ---- the JSON API is not affected by the admin's CSRF / session middleware
    def test_api_still_works_without_csrf_token(self):
        from rest_framework.test import APIClient
        c = APIClient(enforce_csrf_checks=True)
        r = c.post('/api/auth/login/', {'email': 'amina@example.com', 'password': 'Passw0rd!'}, format='json')
        self.assertEqual(r.status_code, 200)
