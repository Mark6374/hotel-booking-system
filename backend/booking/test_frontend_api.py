import datetime

from django.db import connection
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from .auth import make_token
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .roles import GuestRole

MODELS = [Guest, GuestRole, RoomType, Room, Booking, BookingRoom, Payment]
D = datetime.date.today() + datetime.timedelta(days=30)


def iso(days):
    return (D + datetime.timedelta(days=days)).isoformat()


class FrontendApiTests(TransactionTestCase):
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
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.guest = self._guest('g@example.com')
        self.other = self._guest('o@example.com')
        self.staff = self._guest('s@example.com', 'staff')
        self.admin = self._guest('a@example.com', 'admin')
        t = RoomType.objects.create(type_name='Standard', capacity=2, price_per_night=60)
        self.r1 = Room.objects.create(room_number='101', floor=1, room_type=t)
        self.r2 = Room.objects.create(room_number='102', floor=1, room_type=t)

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

    def book(self, guest, rooms=None, card='4242424242424242', ci=0, co=3):
        return self.api(guest).post('/api/bookings/create/', {
            'check_in': iso(ci), 'check_out': iso(co),
            'rooms': rooms or [{'room_id': self.r1.room_id, 'guests_count': 2}],
            'payment_method': 'Card', 'card_number': card}, format='json')

    def test_account_has_role(self):
        self.assertEqual(self.api().get('/api/account/').status_code, 401)
        self.assertEqual(self.api(self.guest).get('/api/account/').data['role'], 'guest')
        self.assertEqual(self.api(self.admin).get('/api/account/').data['role'], 'admin')

    def test_booking_commits_everything(self):
        r = self.book(self.guest)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['log'][-1]['label'], 'COMMIT')
        b = Booking.objects.get(pk=r.data['booking_id'])
        self.assertEqual(b.guest_id, self.guest.guest_id)
        self.assertEqual(BookingRoom.objects.filter(booking=b).count(), 1)
        self.assertEqual(Payment.objects.get(booking=b).amount, 180)

    def test_declined_card_rolls_back(self):
        r = self.book(self.guest, card='4242424242420000')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data['log'][-1]['label'], 'ROLLBACK')
        self.assertEqual(Booking.objects.count(), 0)
        self.assertEqual(BookingRoom.objects.count(), 0)

    def test_overlap_and_maintenance_rejected(self):
        self.assertEqual(self.book(self.guest).status_code, 201)
        self.assertEqual(self.book(self.other, ci=1, co=2).status_code, 409)
        self.assertEqual(self.book(self.other, ci=3, co=5).status_code, 201)  # starts on check-out day
        self.api(self.staff).post('/api/rooms/%d/maintenance/' % self.r2.room_id)
        r = self.book(self.other, rooms=[{'room_id': self.r2.room_id, 'guests_count': 1}])
        self.assertEqual(r.status_code, 409)

    def test_cancel_only_own_or_staff(self):
        bid = self.book(self.guest).data['booking_id']
        self.assertEqual(self.api(self.other).post('/api/bookings/%d/cancel/' % bid).status_code, 403)
        r = self.api(self.guest).post('/api/bookings/%d/cancel/' % bid)
        self.assertTrue(r.data['refunded'])
        self.assertEqual(Payment.objects.get(booking_id=bid).payment_status, 'Refunded')

    def test_check_in_out_staff_only(self):
        bid = self.book(self.guest).data['booking_id']
        self.assertEqual(self.api(self.guest).post('/api/bookings/%d/check-in/' % bid).status_code, 403)
        self.assertEqual(self.api(self.staff).post('/api/bookings/%d/check-out/' % bid).status_code, 409)
        self.assertEqual(self.api(self.staff).post('/api/bookings/%d/check-in/' % bid).status_code, 200)
        self.assertEqual(self.api(self.staff).post('/api/bookings/%d/check-out/' % bid).status_code, 200)
        self.assertEqual(Booking.objects.get(pk=bid).status, 'Completed')

    def test_admin_endpoints(self):
        self.assertEqual(self.api(self.staff).get('/api/admin/accounts/').status_code, 403)
        self.assertEqual(len(self.api(self.admin).get('/api/admin/accounts/').data), 4)
        a = self.api(self.admin)
        self.assertEqual(a.patch('/api/admin/accounts/%d/' % self.admin.guest_id, {'role': 'guest'}).status_code, 409)
        self.assertEqual(a.patch('/api/admin/accounts/%d/' % self.guest.guest_id, {'role': 'staff'}).data['role'], 'staff')
        a.patch('/api/admin/accounts/%d/' % self.other.guest_id, {'is_active': False})
        self.assertEqual(self.api(self.other).get('/api/account/').status_code, 403)
        self.assertEqual(a.patch('/api/room-types/%d/price/' % self.r1.room_type_id, {'price_per_night': 75}).status_code, 200)
        self.assertEqual(RoomType.objects.get().price_per_night, 75)

    def test_profile_and_password(self):
        c = self.api(self.guest)
        self.assertEqual(c.patch('/api/account/', {'first_name': 'New', 'last_name': 'Name', 'phone': '+7 701 222 3344'}).data['first_name'], 'New')
        self.assertEqual(c.post('/api/account/password/', {'old_password': 'bad', 'new_password': 'Another1!'}).status_code, 400)
        self.assertEqual(c.post('/api/account/password/', {'old_password': 'Passw0rd!', 'new_password': 'Another1!'}).status_code, 200)
        r = self.api().post('/api/auth/login/', {'email': 'g@example.com', 'password': 'Another1!'}, format='json')
        self.assertEqual(r.status_code, 200)

    # ---- forgot password (booking/password_reset.py)

    def reset_request(self, email):
        return self.api().post('/api/auth/password-reset/', {'email': email}, format='json')

    @override_settings(DEBUG=True)
    def test_password_reset_flow(self):
        from django.core import mail
        r = self.reset_request('G@example.com')
        self.assertEqual(r.status_code, 200)
        token = r.data['debug_token']
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('#reset?token=' + token, mail.outbox[0].body)

        c = self.api()
        self.assertEqual(c.post('/api/auth/password-reset/confirm/', {'token': token, 'new_password': '12345678'}, format='json').status_code, 400)
        r = c.post('/api/auth/password-reset/confirm/', {'token': token, 'new_password': 'NewPass123'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.guest.refresh_from_db()
        self.assertTrue(self.guest.check_password('NewPass123'))
        # the link works only once
        r = c.post('/api/auth/password-reset/confirm/', {'token': token, 'new_password': 'Other1234'}, format='json')
        self.assertEqual(r.status_code, 400)

    @override_settings(DEBUG=True)
    def test_password_reset_unknown_or_blocked(self):
        from django.core import mail
        r = self.reset_request('nobody@example.com')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('debug_token', r.data)
        GuestRole.objects.create(guest=self.other, role='guest', is_active=False)
        self.assertNotIn('debug_token', self.reset_request('o@example.com').data)
        self.assertEqual(len(mail.outbox), 0)
        bad = self.api().post('/api/auth/password-reset/confirm/', {'token': 'junk', 'new_password': 'NewPass123'}, format='json')
        self.assertEqual(bad.status_code, 400)
