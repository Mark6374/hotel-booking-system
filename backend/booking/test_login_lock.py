"""10 tests for the login protection (login_lock.py), tester 24B032036, week 12.

Rule: 5 wrong passwords in a row lock the account for 15 minutes.

Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_login_lock -v 2
"""
import datetime
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from .auth import make_token
from .login_lock import LoginLock
from .models import Guest
from .password_reset import make_reset_token
from .roles import GuestRole
from .photos import GuestPhoto
from .chat import ChatMessage, Conversation

LOGIN = '/api/auth/login/'
MODELS = [Guest, GuestRole, GuestPhoto, Conversation, ChatMessage, LoginLock]
REAL_NOW = datetime.datetime.now


def later(minutes):
    """Pretend that `minutes` minutes have passed."""
    return mock.patch('booking.login_lock._now', lambda: REAL_NOW() + datetime.timedelta(minutes=minutes))


class LoginLockTests(TransactionTestCase):
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
        cache.clear()  # login is also limited to 20 per minute; start with a clean counter
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.amina = self._account('amina@example.com', 'Amina2026')
        self.daniel = self._account('daniel@example.com', 'Daniel2026')
        self.admin = self._account('admin@example.com', 'Admin2026', role='admin')
        self.api = APIClient()

    def tearDown(self):
        cache.clear()

    def _account(self, email, password, role=None):
        g = Guest(first_name='F', last_name='L', email=email, phone='+7 700 000 0000')
        g.set_password(password)
        g.save()
        if role:
            GuestRole.objects.create(guest=g, role=role)
        return g

    def login(self, email, password):
        return self.api.post(LOGIN, {'email': email, 'password': password}, format='json')

    def wrong(self, times, email='amina@example.com'):
        return [self.login(email, 'wrong-pass1') for _ in range(times)]

    # ---------------------------------------------------------------- 1-3

    def test_01_four_wrong_passwords_do_not_lock(self):
        self.assertEqual([r.status_code for r in self.wrong(4)], [401, 401, 401, 401])
        self.assertEqual(self.login('amina@example.com', 'Amina2026').status_code, 200)

    def test_02_fifth_wrong_password_locks_for_15_minutes(self):
        last = self.wrong(5)[-1]
        self.assertEqual(last.status_code, 423)
        self.assertTrue(last.data['locked'])
        self.assertIn('15 more minutes', last.data['detail'])

    def test_03_right_password_is_refused_while_locked(self):
        self.wrong(5)
        r = self.login('amina@example.com', 'Amina2026')
        self.assertEqual(r.status_code, 423)
        self.assertNotIn('token', r.data)

    # ---------------------------------------------------------------- 4-5 time

    def test_04_lock_still_on_after_14_minutes(self):
        self.wrong(5)
        with later(14):
            r = self.login('amina@example.com', 'Amina2026')
        self.assertEqual(r.status_code, 423)
        self.assertIn('1 more minute', r.data['detail'])

    def test_05_lock_ends_after_15_minutes(self):
        self.wrong(5)
        with later(16):
            r = self.login('amina@example.com', 'Amina2026')
        self.assertEqual(r.status_code, 200)
        self.assertIn('token', r.data)

    # ---------------------------------------------------------------- 6-8

    def test_06_successful_login_resets_the_counter(self):
        self.wrong(4)
        self.assertEqual(self.login('amina@example.com', 'Amina2026').status_code, 200)
        self.assertEqual([r.status_code for r in self.wrong(4)], [401, 401, 401, 401])

    def test_07_email_letter_case_counts_as_the_same_account(self):
        self.wrong(3, 'amina@example.com')
        self.wrong(1, 'AMINA@EXAMPLE.COM')
        self.assertEqual(self.wrong(1, 'Amina@Example.com')[0].status_code, 423)

    def test_08_unknown_email_gets_the_same_answers_and_is_not_stored(self):
        # week 13: same counter and lock as a real account, so nobody can tell
        # which e-mails exist; nothing is written to the database for it
        real = [(r.status_code, r.data['detail']) for r in self.wrong(6, 'amina@example.com')]
        fake = [(r.status_code, r.data['detail']) for r in self.wrong(6, 'nobody@example.com')]
        self.assertEqual(real, fake)
        self.assertEqual(LoginLock.objects.filter(guest__email='nobody@example.com').count(), 0)

    def test_09_lock_is_per_account(self):
        self.wrong(5)
        self.assertEqual(self.login('daniel@example.com', 'Daniel2026').status_code, 200)

    # ---------------------------------------------------------------- 10 ways out

    def test_10_password_reset_and_admin_unlock(self):
        # a) the owner resets the password by e-mail -> unlocked at once
        self.wrong(5)
        r = self.api.post('/api/auth/password-reset/confirm/',
                          {'token': make_reset_token(self.amina), 'new_password': 'NewPass2026'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.login('amina@example.com', 'NewPass2026').status_code, 200)

        # b) admin sees the lock and removes it; a guest is not allowed to
        self.wrong(5, 'daniel@example.com')
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(self.admin))
        rows = {a['email']: a for a in admin.get('/api/admin/accounts/').data}
        self.assertEqual(rows['daniel@example.com']['locked_minutes'], 15)
        guest = APIClient()
        guest.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(self.amina))
        self.assertEqual(guest.patch('/api/admin/accounts/%d/' % self.daniel.guest_id,
                                     {'unlock': True}, format='json').status_code, 403)
        self.assertEqual(admin.patch('/api/admin/accounts/%d/' % self.daniel.guest_id,
                                     {'unlock': True}, format='json').status_code, 200)
        self.assertEqual(self.login('daniel@example.com', 'Daniel2026').status_code, 200)
