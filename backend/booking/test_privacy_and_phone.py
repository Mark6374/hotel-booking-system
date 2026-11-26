"""Tests for the bugs found by testing on 13 Nov 2026 (tester 24B032036).

API-01..03: GET /api/guests/ and /api/payments/ gave every guest's name,
email and phone, and every payment, to anyone - even without login.
API-04..05 / UI-12: a phone without digits ("((((((", "abc") was accepted
at sign-up, in the profile and in a booking.

Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking
"""
import datetime

from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from .auth import make_token
from .login_lock import LoginLock
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .roles import GuestRole
from .photos import GuestPhoto
from .chat import ChatMessage, Conversation

MODELS = [Guest, GuestRole, GuestPhoto, Conversation, ChatMessage, RoomType, Room, Booking, BookingRoom, Payment, LoginLock]
IN_A_MONTH = datetime.date.today() + datetime.timedelta(days=30)


class PrivacyAndPhoneTests(TransactionTestCase):
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
        cache.clear()  # sign-up is limited to 20 per minute; start each test with a clean counter
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.amina = self._guest('amina@example.com')
        self.daniel = self._guest('daniel@example.com')
        self.staff = self._guest('staff@example.com', 'staff')
        t = RoomType.objects.create(type_name='Standard', capacity=2, price_per_night=60)
        self.room = Room.objects.create(room_number='101', floor=1, room_type=t)
        for g in (self.amina, self.daniel):
            b = Booking.objects.create(guest=g, booking_date=datetime.datetime.now(),
                                       check_in=IN_A_MONTH, check_out=IN_A_MONTH + datetime.timedelta(days=1))
            Payment.objects.create(booking=b, amount=60, payment_method='Card', payment_status='Paid',
                                   payment_date=datetime.datetime.now())

    def tearDown(self):
        cache.clear()  # do not leave our sign-ups in the counter for the next tests

    def _guest(self, email, role=None):
        g = Guest(first_name='F', last_name='L', email=email, phone='+7 700 000 0000')
        g.set_password('Passw0rd!')
        g.save()
        if role:
            GuestRole.objects.create(guest=g, role=role)
        return g

    def api(self, guest=None):
        c = APIClient()
        if guest:
            c.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(guest))
        return c

    # ---------- API-01..03: personal data ----------

    def test_visitor_gets_no_guests_and_no_payments(self):
        self.assertEqual(self.api().get('/api/guests/').data, [])
        self.assertEqual(self.api().get('/api/payments/').data, [])

    def test_guest_gets_only_herself_and_her_payments(self):
        guests = self.api(self.amina).get('/api/guests/').data
        self.assertEqual([g['email'] for g in guests], ['amina@example.com'])
        payments = self.api(self.amina).get('/api/payments/').data
        self.assertEqual(len(payments), 1)
        self.assertEqual(Booking.objects.get(pk=payments[0]['booking']).guest_id, self.amina.guest_id)

    def test_staff_gets_everybody(self):
        self.assertEqual(len(self.api(self.staff).get('/api/guests/').data), 3)
        self.assertEqual(len(self.api(self.staff).get('/api/payments/').data), 2)

    def test_blocked_account_gets_nothing(self):
        GuestRole.objects.create(guest=self.daniel, role='guest', is_active=False)
        self.assertEqual(self.api(self.daniel).get('/api/guests/').data, [])

    def test_rooms_and_bookings_still_public_for_availability(self):
        # the booking page of a visitor needs these to count free rooms
        self.assertEqual(len(self.api().get('/api/rooms/').data), 1)
        self.assertEqual(len(self.api().get('/api/bookings/').data), 2)

    # ---------- API-04..05 / UI-12: phone ----------

    def test_phone_without_digits_is_refused_at_sign_up(self):
        for bad in ('((((((', 'abc', '------', '+12 34'):
            r = self.api().post('/api/auth/register/', {
                'first_name': 'A', 'last_name': 'B', 'email': 'new@example.com',
                'phone': bad, 'password': 'Hotel2026a'}, format='json')
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn('phone', r.data)

    def test_good_phones_are_accepted_at_sign_up(self):
        for i, good in enumerate(('+7 701 123 4567', '(727) 250-1234', '87011234567')):
            r = self.api().post('/api/auth/register/', {
                'first_name': 'A', 'last_name': 'B', 'email': 'ok%d@example.com' % i,
                'phone': good, 'password': 'Hotel2026a'}, format='json')
            self.assertEqual(r.status_code, 201, good)

    def test_phone_without_digits_is_refused_in_profile(self):
        r = self.api(self.amina).patch('/api/account/', {'first_name': 'A', 'last_name': 'B', 'phone': 'abc'})
        self.assertEqual(r.status_code, 400)

    def test_phone_without_digits_is_refused_in_booking_and_not_saved(self):
        r = self.api(self.amina).post('/api/bookings/create/', {
            'check_in': (IN_A_MONTH + datetime.timedelta(days=10)).isoformat(),
            'check_out': (IN_A_MONTH + datetime.timedelta(days=12)).isoformat(),
            'rooms': [{'room_id': self.room.room_id, 'guests_count': 1}],
            'payment_method': 'Cash', 'phone': 'abc'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.amina.refresh_from_db()
        self.assertEqual(self.amina.phone, '+7 700 000 0000')
