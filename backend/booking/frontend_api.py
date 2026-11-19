"""Write endpoints used by the React frontend.

Everything here is additive: the read-only list views and the
register / login / me endpoints in views.py are used as they are.
Auth is the Bearer token from booking/auth.py; roles come from roles.py.
"""
import datetime
import re
from decimal import Decimal

from django.core.management import call_command
from django.db import transaction
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .roles import ROLES, GuestRole, IsActiveAccount, IsAdmin, IsStaff, account_payload, role_info
from .serializers import clean_phone

ACTIVE = ('Confirmed', 'CheckedIn')


def _err(message, code=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({'detail': message, **extra}, status=code)


# ---------------------------------------------------------------- account

class ProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50)
    last_name = serializers.CharField(max_length=50)
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value):
        return clean_phone(value)


class AccountView(APIView):
    """GET: the logged-in account with its role. PATCH: edit name / phone."""
    permission_classes = [IsActiveAccount]

    def get(self, request):
        return Response(account_payload(request.user))

    def patch(self, request):
        s = ProfileSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        g = request.user
        g.first_name = s.validated_data['first_name'].strip()
        g.last_name = s.validated_data['last_name'].strip()
        g.phone = s.validated_data['phone']
        g.save(update_fields=['first_name', 'last_name', 'phone'])
        return Response(account_payload(g))


class ChangePasswordView(APIView):
    permission_classes = [IsActiveAccount]

    def post(self, request):
        old = request.data.get('old_password') or ''
        new = request.data.get('new_password') or ''
        g = request.user
        if not g.check_password(old):
            return _err('Your current password is wrong.')
        if len(new) < 8 or new.isdigit():
            return _err('Use at least 8 characters, not only digits.')
        g.set_password(new)
        g.save(update_fields=['password'])
        return Response({'detail': 'Password changed.'})


# ---------------------------------------------------------------- booking

class BookingRequestSerializer(serializers.Serializer):
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    rooms = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=20)
    payment_method = serializers.ChoiceField(choices=['Card', 'Cash', 'Transfer'])
    card_number = serializers.CharField(required=False, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=50, required=False)
    last_name = serializers.CharField(max_length=50, required=False)
    phone = serializers.CharField(max_length=20, required=False)

    def validate_phone(self, value):
        # the phone sent with a booking is saved into the account, so check it too
        return clean_phone(value)

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('Check-out must be after check-in.')
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError('Check-in cannot be in the past.')
        lines = []
        for r in data['rooms']:
            try:
                lines.append({'room_id': int(r['room_id']), 'guests_count': int(r.get('guests_count', 1))})
            except (KeyError, TypeError, ValueError):
                raise serializers.ValidationError('Each room needs a room_id and guests_count.')
        if len({l['room_id'] for l in lines}) != len(lines):
            raise serializers.ValidationError('The same room is listed twice.')
        data['rooms'] = lines
        digits = re.sub(r'[\s-]', '', data.get('card_number') or '')
        if data['payment_method'] == 'Card' and not re.fullmatch(r'\d{16}', digits):
            raise serializers.ValidationError('Enter a 16-digit card number.')
        data['card_number'] = digits
        return data


class _Rollback(Exception):
    pass


class CreateBookingView(APIView):
    """Books rooms and takes payment in ONE database transaction.

    Returns the list of steps so the frontend can show what the database did.
    Any failed step rolls everything back: no room is blocked without payment.
    A card number ending in 0000 is declined (demo).
    """
    permission_classes = [IsActiveAccount]

    def post(self, request):
        s = BookingRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        ci, co = d['check_in'], d['check_out']
        nights = (co - ci).days
        room_ids = [l['room_id'] for l in d['rooms']]
        log = []

        def step(label, fn):
            try:
                out = fn()
            except _Rollback as e:
                log.append({'label': label, 'ok': False, 'detail': str(e)})
                raise
            log.append({'label': label, 'ok': True})
            return out

        try:
            with transaction.atomic():
                def lock():
                    rooms = {r.room_id: r for r in Room.objects.select_for_update()
                             .select_related('room_type').filter(room_id__in=room_ids)}
                    for rid in room_ids:
                        r = rooms.get(rid)
                        if r is None:
                            raise _Rollback('Room %s does not exist.' % rid)
                        if r.status != 'Available':
                            raise _Rollback('Room %s is closed for maintenance.' % r.room_number)
                    return rooms
                rooms = step('Lock the chosen rooms and check they are open', lock)

                def overlap():
                    clash = (BookingRoom.objects
                             .filter(room_id__in=room_ids, booking__status__in=ACTIVE,
                                     booking__check_in__lt=co, booking__check_out__gt=ci)
                             .select_related('room').first())
                    if clash:
                        raise _Rollback('Room %s was just booked by someone else for overlapping dates.'
                                        % clash.room.room_number)
                step('Check that no active booking overlaps these dates', overlap)

                def guest():
                    g = request.user
                    changed = []
                    for f in ('first_name', 'last_name', 'phone'):
                        v = (d.get(f) or '').strip()
                        if v and v != getattr(g, f):
                            setattr(g, f, v)
                            changed.append(f)
                    if changed:
                        g.save(update_fields=changed)
                    return g
                g = step('Find or create the guest', guest)

                booking = step('Insert the booking', lambda: Booking.objects.create(
                    guest=g, booking_date=datetime.datetime.now().replace(microsecond=0),
                    check_in=ci, check_out=co, status='Confirmed'))

                def lines():
                    total = Decimal('0')
                    for l in d['rooms']:
                        r = rooms[l['room_id']]
                        cap = r.room_type.capacity
                        if not 1 <= l['guests_count'] <= cap:
                            raise _Rollback('Room %s sleeps at most %d.' % (r.room_number, cap))
                        price = r.room_type.price_per_night
                        BookingRoom.objects.create(booking=booking, room=r,
                                                   guests_count=l['guests_count'], price_per_night=price)
                        total += price * nights
                    return total
                total = step('Insert one room line for each room', lines)

                def pay():
                    if d['payment_method'] == 'Card' and d['card_number'].endswith('0000'):
                        raise _Rollback('The bank declined this card.')
                    Payment.objects.create(booking=booking, amount=total, payment_method=d['payment_method'],
                                           payment_status='Paid',
                                           payment_date=datetime.datetime.now().replace(microsecond=0))
                step('Insert the payment', pay)
        except _Rollback as e:
            log.append({'label': 'ROLLBACK', 'ok': False, 'final': True,
                        'detail': 'Nothing was saved, so no room is blocked without payment.'})
            return Response({'ok': False, 'detail': str(e), 'log': log}, status=status.HTTP_409_CONFLICT)

        log.append({'label': 'COMMIT', 'ok': True, 'final': True,
                    'detail': 'Booking, rooms, and payment saved together.'})
        return Response({'ok': True, 'booking_id': booking.booking_id, 'total': str(total), 'log': log},
                        status=status.HTTP_201_CREATED)


class CancelBookingView(APIView):
    """The guest who owns the booking, or staff, can cancel a Confirmed booking."""
    permission_classes = [IsActiveAccount]

    def post(self, request, pk):
        with transaction.atomic():
            b = Booking.objects.select_for_update().filter(pk=pk).first()
            if b is None:
                return _err('Booking not found.', status.HTTP_404_NOT_FOUND)
            role, _ = role_info(request.user)
            if b.guest_id != request.user.guest_id and role not in ('staff', 'admin'):
                return _err('This is not your booking.', status.HTTP_403_FORBIDDEN)
            if b.status != 'Confirmed':
                return _err('Only confirmed bookings can be cancelled.', status.HTTP_409_CONFLICT)
            b.status = 'Cancelled'
            b.save(update_fields=['status'])
            refunded = Payment.objects.filter(booking=b, payment_status='Paid').update(payment_status='Refunded')
        return Response({'ok': True, 'refunded': refunded > 0})


class _StatusMove(APIView):
    permission_classes = [IsStaff]
    from_status = to_status = ''

    def post(self, request, pk):
        n = Booking.objects.filter(pk=pk, status=self.from_status).update(status=self.to_status)
        if not n:
            return _err('Booking must be %s first.' % self.from_status, status.HTTP_409_CONFLICT)
        return Response({'ok': True})


class CheckInView(_StatusMove):
    from_status, to_status = 'Confirmed', 'CheckedIn'


class CheckOutView(_StatusMove):
    from_status, to_status = 'CheckedIn', 'Completed'


class ToggleMaintenanceView(APIView):
    permission_classes = [IsStaff]

    def post(self, request, pk):
        r = Room.objects.filter(pk=pk).first()
        if r is None:
            return _err('Room not found.', status.HTTP_404_NOT_FOUND)
        r.status = 'Maintenance' if r.status == 'Available' else 'Available'
        r.save(update_fields=['status'])
        return Response({'ok': True, 'status': r.status})


# ---------------------------------------------------------------- admin

class RoomTypePriceView(APIView):
    permission_classes = [IsAdmin]

    def patch(self, request, pk):
        try:
            price = Decimal(str(request.data.get('price_per_night'))).quantize(Decimal('0.01'))
        except Exception:
            return _err('Enter a price.')
        if not Decimal('0') < price < Decimal('100000'):
            return _err('Enter a price above 0.')
        n = RoomType.objects.filter(pk=pk).update(price_per_night=price)
        if not n:
            return _err('Room type not found.', status.HTTP_404_NOT_FOUND)
        return Response({'ok': True, 'price_per_night': str(price)})


class AccountListView(APIView):
    """Website accounts = guests that have a password."""
    permission_classes = [IsAdmin]

    def get(self, request):
        guests = Guest.objects.exclude(password__isnull=True).exclude(password='').order_by('guest_id')
        roles = {r.guest_id: r for r in GuestRole.objects.all()}
        out = []
        for g in guests:
            r = roles.get(g.guest_id)
            out.append({'guest_id': g.guest_id, 'first_name': g.first_name, 'last_name': g.last_name,
                        'email': g.email, 'phone': g.phone,
                        'role': r.role if r else 'guest', 'is_active': r.is_active if r else True})
        return Response(out)


class AccountAdminView(APIView):
    """PATCH: change role / block. DELETE: remove the login (guest row and bookings stay)."""
    permission_classes = [IsAdmin]

    def _target(self, request, pk):
        if pk == request.user.guest_id:
            return None, _err('You cannot change or remove your own admin account.', status.HTTP_409_CONFLICT)
        g = Guest.objects.filter(pk=pk).first()
        if g is None:
            return None, _err('Account not found.', status.HTTP_404_NOT_FOUND)
        return g, None

    def patch(self, request, pk):
        g, error = self._target(request, pk)
        if error:
            return error
        role, active = role_info(g)
        if 'role' in request.data:
            role = request.data['role']
            if role not in ROLES:
                return _err('Unknown role.')
        if 'is_active' in request.data:
            v = request.data['is_active']
            active = v if isinstance(v, bool) else str(v).strip().lower() in ('1', 'true', 'yes', 'on')
        GuestRole.objects.update_or_create(guest_id=g.guest_id, defaults={'role': role, 'is_active': active})
        return Response(account_payload(g))

    def delete(self, request, pk):
        g, error = self._target(request, pk)
        if error:
            return error
        g.password = None
        g.save(update_fields=['password'])
        GuestRole.objects.filter(guest_id=g.guest_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResetDemoView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        kept = _registered_accounts()
        call_command('seed_demo')
        call_command('seed_roles')
        _restore_accounts(kept)
        return Response({'ok': True, 'kept_accounts': len(kept)})


def _demo_emails():
    from .management.commands.seed_demo import GUESTS
    from .management.commands.seed_roles import STAFF
    return {r['email'].lower() for r in GUESTS + STAFF}


def _registered_accounts():
    """Accounts people created on the site (not the demo ones), with their password
    hash and role, so a demo reset does not delete them. Their bookings are not kept."""
    demo = _demo_emails()
    rows = []
    for g in Guest.objects.exclude(password__isnull=True).exclude(password=''):
        if g.email.lower() in demo:
            continue
        role = GuestRole.objects.filter(guest_id=g.guest_id).first()
        rows.append({
            'guest': {'guest_id': g.guest_id, 'first_name': g.first_name, 'last_name': g.last_name,
                      'email': g.email, 'phone': g.phone, 'password': g.password},
            'role': (role.role, role.is_active) if role else None,
        })
    return rows


def _restore_accounts(rows):
    for row in rows:
        data = dict(row['guest'])
        if Guest.objects.filter(pk=data['guest_id']).exists():
            data.pop('guest_id')  # id taken by a demo row: the account gets a new id
        if Guest.objects.filter(email__iexact=data['email']).exists():
            continue
        g = Guest.objects.create(**data)
        if row['role']:
            GuestRole.objects.update_or_create(guest_id=g.guest_id,
                                               defaults={'role': row['role'][0], 'is_active': row['role'][1]})
