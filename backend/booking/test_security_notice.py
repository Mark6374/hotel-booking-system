"""10 tests for week 13 (tester 24B032036):
 * attempts counter: "Invalid email or password. 3 attempts left before the account is locked."
 * "someone tried to log in" notice after the next successful login

Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_security_notice -v 2
"""
from rest_framework.test import APIClient

from .auth import make_token
from .test_login_lock import LoginLockTests, later


class SecurityNoticeTests(LoginLockTests):
    """Same test accounts and helpers as test_login_lock.py (amina, daniel, admin;
    self.wrong(n), self.login(...)). The 10 lock tests of that file are not run
    again here, only the 10 tests below."""

    locals().update({name: None for name in dir(LoginLockTests) if name.startswith('test_')})

    # ---------------------------------------------------------------- counter

    def test_11_wrong_password_tells_attempts_left(self):
        r = self.wrong(1)[0]
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data['detail'], 'Invalid email or password. 4 attempts left before the account is locked.')
        self.assertEqual(r.data['attempts_left'], 4)

    def test_12_counter_goes_down_then_locks(self):
        rs = self.wrong(5)
        self.assertEqual([r.data.get('attempts_left') for r in rs[:4]], [4, 3, 2, 1])
        self.assertIn('1 attempt left', rs[3].data['detail'])      # "attempt", not "attempts"
        self.assertEqual(rs[4].status_code, 423)

    def test_13_unknown_email_gets_the_same_counter(self):
        r = self.wrong(1, 'nobody@example.com')[0]
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data, self.wrong(1, 'amina@example.com')[0].data)

    def test_14_counter_starts_again_after_a_good_login(self):
        self.wrong(3)
        self.login('amina@example.com', 'Amina2026')
        self.assertEqual(self.wrong(1)[0].data['attempts_left'], 4)

    # ---------------------------------------------------------------- notice

    def test_15_no_wrong_passwords_no_notice(self):
        r = self.login('amina@example.com', 'Amina2026')
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data['security_notice'])

    def test_16_notice_after_wrong_passwords(self):
        self.wrong(2)
        n = self.login('amina@example.com', 'Amina2026').data['security_notice']
        self.assertEqual(n['failed_attempts'], 2)
        self.assertFalse(n['was_locked'])
        self.assertIsNotNone(n['last_failed_at'])

    def test_17_notice_after_lock_says_the_account_was_locked(self):
        self.wrong(5)
        with later(16):
            r = self.login('amina@example.com', 'Amina2026')
        n = r.data['security_notice']
        self.assertEqual(n['failed_attempts'], 5)
        self.assertTrue(n['was_locked'])
        self.assertIsNotNone(n['last_locked_at'])

    def test_18_notice_is_shown_only_once(self):
        self.wrong(2)
        self.login('amina@example.com', 'Amina2026')
        self.assertIsNone(self.login('amina@example.com', 'Amina2026').data['security_notice'])

    def test_19_admin_unlock_keeps_the_notice_for_the_owner(self):
        self.wrong(5)
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(self.admin))
        admin.patch('/api/admin/accounts/%d/' % self.amina.guest_id, {'unlock': True}, format='json')
        r = self.login('amina@example.com', 'Amina2026')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['security_notice']['failed_attempts'], 5)
        self.assertTrue(r.data['security_notice']['was_locked'])

    def test_20_notice_is_per_account(self):
        self.wrong(3, 'daniel@example.com')
        self.assertIsNone(self.login('amina@example.com', 'Amina2026').data['security_notice'])
        self.assertEqual(self.login('daniel@example.com', 'Daniel2026').data['security_notice']['failed_attempts'], 3)
