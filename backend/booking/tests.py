from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from .login_lock import LoginLock
from .models import Guest

REGISTER = '/api/auth/register/'
LOGIN = '/api/auth/login/'
ME = '/api/auth/me/'

VALID = {
    'first_name': 'Aida', 'last_name': 'Nur', 'email': 'Aida@Example.com',
    'phone': '+7 701 000 1122', 'password': 'S3curePass!',
}


class AuthTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Guest is an unmanaged model (tables come from the SQL file), so create it for tests.
        with connection.schema_editor() as editor:
            editor.create_model(Guest)
            editor.create_model(LoginLock)  # login checks the lock table

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            editor.delete_model(LoginLock)
            editor.delete_model(Guest)
        super().tearDownClass()

    def setUp(self):
        LoginLock.objects.all()._raw_delete('default')
        Guest.objects.all()._raw_delete('default')  # unmanaged tables aren't flushed between tests
        self.api = APIClient()

    def test_register_success_hashes_password_and_hides_it(self):
        r = self.api.post(REGISTER, VALID, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertIn('token', r.data)
        self.assertNotIn('password', r.data['guest'])
        self.assertEqual(r.data['guest']['email'], 'aida@example.com')
        stored = Guest.objects.get(email='aida@example.com').password
        self.assertNotEqual(stored, VALID['password'])
        self.assertTrue(stored.startswith('pbkdf2_'))

    def test_register_duplicate_email_case_insensitive(self):
        self.api.post(REGISTER, VALID, format='json')
        r = self.api.post(REGISTER, {**VALID, 'email': 'AIDA@example.com'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('email', r.data)

    def test_register_validation(self):
        for bad in ({'password': 'short'}, {'password': '123456789'},
                    {'email': 'not-an-email'}, {'first_name': ''}, {'phone': ''}):
            r = self.api.post(REGISTER, {**VALID, **bad}, format='json')
            self.assertEqual(r.status_code, 400, bad)
        self.assertEqual(Guest.objects.count(), 0)

    def test_login_success_and_me(self):
        self.api.post(REGISTER, VALID, format='json')
        r = self.api.post(LOGIN, {'email': 'aida@EXAMPLE.com', 'password': VALID['password']}, format='json')
        self.assertEqual(r.status_code, 200)
        me = self.api.get(ME, HTTP_AUTHORIZATION='Bearer ' + r.data['token'])
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['email'], 'aida@example.com')
        self.assertNotIn('password', me.data)

    def test_login_wrong_password_and_unknown_email_same_error(self):
        self.api.post(REGISTER, VALID, format='json')
        a = self.api.post(LOGIN, {'email': 'aida@example.com', 'password': 'wrong-pass'}, format='json')
        b = self.api.post(LOGIN, {'email': 'nobody@example.com', 'password': 'wrong-pass'}, format='json')
        self.assertEqual(a.status_code, 401)
        self.assertEqual(b.status_code, 401)
        self.assertEqual(a.data, b.data)

    def test_guest_without_password_cannot_login(self):
        Guest.objects.create(first_name='X', last_name='Y', email='x@example.com', phone='1')
        r = self.api.post(LOGIN, {'email': 'x@example.com', 'password': ''}, format='json')
        self.assertIn(r.status_code, (400, 401))

    def test_me_requires_valid_token(self):
        self.assertEqual(self.api.get(ME).status_code, 401)
        self.assertEqual(self.api.get(ME, HTTP_AUTHORIZATION='Bearer garbage').status_code, 401)

    def test_guest_list_does_not_leak_password(self):
        self.api.post(REGISTER, VALID, format='json')
        r = self.api.get('/api/guests/')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(all('password' not in g for g in r.data))
