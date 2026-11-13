from django.core import signing
from rest_framework import authentication, exceptions

from .models import Guest

TOKEN_SALT = 'hotel_api.auth.token'
TOKEN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def make_token(guest):
    return signing.dumps({'gid': guest.guest_id}, salt=TOKEN_SALT)


class BearerTokenAuthentication(authentication.BaseAuthentication):
    """Authorization: Bearer <signed token>. Stateless; no token table needed."""

    keyword = 'Bearer'

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed('Invalid Authorization header.')
        try:
            data = signing.loads(header[1].decode(), salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE)
        except (signing.BadSignature, UnicodeError):
            raise exceptions.AuthenticationFailed('Invalid or expired token.')
        try:
            guest = Guest.objects.get(pk=data['gid'])
        except (Guest.DoesNotExist, KeyError):
            raise exceptions.AuthenticationFailed('Account no longer exists.')
        return (guest, header[1].decode())

    def authenticate_header(self, request):
        return self.keyword
