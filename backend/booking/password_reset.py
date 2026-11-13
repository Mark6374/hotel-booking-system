"""Forgot-password flow for the React frontend.

1. POST /api/auth/password-reset/          {email}
   Always answers the same way, so nobody can test which emails have accounts.
   For an active account with a password it emails a link to
   FRONTEND_URL/#reset?token=...  (no SMTP configured -> printed in the runserver console).
   With DEBUG on, the token is also returned as `debug_token` so the demo works without email.

2. POST /api/auth/password-reset/confirm/  {token, new_password}
   The token is signed, valid for 1 hour, and tied to the current password hash,
   so it stops working once it has been used (or the password changed another way).
"""
import hashlib

from django.conf import settings
from django.core import signing
from django.core.mail import get_connection, send_mail
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Guest
from .roles import role_info

RESET_SALT = 'hotel_api.password_reset'
RESET_MAX_AGE = 60 * 60  # 1 hour
SENT = 'If an account with that email exists, we sent a link to reset the password. It works for 1 hour.'


def _fingerprint(guest):
    return hashlib.sha256((guest.password or '').encode()).hexdigest()[:16]


def make_reset_token(guest):
    return signing.dumps({'gid': guest.guest_id, 'pw': _fingerprint(guest)}, salt=RESET_SALT)


def guest_from_reset_token(token):
    """The guest the token belongs to, or None if it is bad, expired or already used."""
    try:
        data = signing.loads(token, salt=RESET_SALT, max_age=RESET_MAX_AGE)
        guest = Guest.objects.get(pk=data['gid'])
    except (signing.BadSignature, Guest.DoesNotExist, KeyError, TypeError):
        return None
    if not guest.password or data.get('pw') != _fingerprint(guest):
        return None
    if not role_info(guest)[1]:
        return None
    return guest


def _mail_connection():
    # Without a mail server the email goes to the runserver console.
    smtp = settings.EMAIL_BACKEND == 'django.core.mail.backends.smtp.EmailBackend'
    if smtp and not getattr(settings, 'EMAIL_HOST_USER', ''):
        return get_connection('django.core.mail.backends.console.EmailBackend')
    return get_connection()


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        email = (request.data.get('email') or '').strip()
        if not email or '@' not in email:
            return Response({'detail': 'Enter your email.'}, status=status.HTTP_400_BAD_REQUEST)

        body = {'detail': SENT}
        guest = Guest.objects.filter(email__iexact=email).first()
        if guest and guest.password and role_info(guest)[1]:
            token = make_reset_token(guest)
            base = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173').rstrip('/')
            link = base + '/#reset?token=' + token
            send_mail(
                'Reset your Juniper Court password',
                f'Hello {guest.first_name},\n\n'
                f'Open this link to choose a new password (valid for 1 hour):\n{link}\n\n'
                'If you did not ask for this, ignore this email. Your password stays the same.\n',
                getattr(settings, 'DEFAULT_FROM_EMAIL', 'no-reply@junipercourt.example'),
                [guest.email],
                connection=_mail_connection(),
            )
            if settings.DEBUG:
                body['debug_token'] = token
        return Response(body)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        token = request.data.get('token') or ''
        new = request.data.get('new_password') or ''
        guest = guest_from_reset_token(token)
        if guest is None:
            return Response({'detail': 'This reset link is invalid, expired or already used. Ask for a new one.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(new) < 8 or new.isdigit():
            return Response({'detail': 'Use at least 8 characters, not only digits.'},
                            status=status.HTTP_400_BAD_REQUEST)
        guest.set_password(new)
        guest.save(update_fields=['password'])
        return Response({'detail': 'Password changed. You can log in with the new password.'})
