"""Login protection: after 5 wrong passwords in a row the account is locked
for 15 minutes (tester / backend 24B032036, week 12).

Table login_lock (backend/db/07_login_lock.sql): one row per account that
typed a wrong password. It is kept apart from `guest` (like `guest_role`),
so the guest table does not change.

Rules
 * wrong password            -> failed_count + 1
 * 5th wrong password        -> locked_until = now + 15 min, counter back to 0
 * while locked              -> login refused, even with the RIGHT password
 * right password (unlocked) -> the row is deleted (counter back to 0)
 * password reset by e-mail  -> the row is deleted (the owner proved who she is)
 * admin can unlock at once  -> PATCH /api/admin/accounts/<id>/ {"unlock": true}
 * unknown e-mail            -> nothing is stored, same answer as before

Week 13 (11_login_security_notice.sql):
 * every wrong password tells how many tries are left before the lock
   ("Invalid email or password. 3 attempts left before the account is locked.")
 * the wrong passwords since the last successful login are remembered
   (unseen_failed, last_failed_at, last_locked_at); at the next successful
   login the owner gets a notice and the record is removed
 * admin unlock removes only the lock, so the owner still gets the notice
 * an unknown e-mail gets EXACTLY the same answers (counter, then lock), so
   nobody can find out which e-mails have an account (rule of
   tests.AuthTests.test_login_wrong_password_and_unknown_email_same_error).
   For unknown e-mails nothing is written to the database: the count is kept
   in the Django cache for 15 minutes.
"""
import datetime
import math

from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.db import models

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


class LoginLock(models.Model):
    guest = models.OneToOneField('booking.Guest', on_delete=models.CASCADE,
                                 primary_key=True, db_column='guest_id')
    failed_count = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    last_failed_at = models.DateTimeField(null=True, blank=True)
    unseen_failed = models.IntegerField(default=0)                  # week 13
    last_locked_at = models.DateTimeField(null=True, blank=True)    # week 13

    class Meta:
        managed = False
        db_table = 'login_lock'


def _now():
    # whole seconds: MySQL DATETIME keeps no fractions (it would round them up)
    return datetime.datetime.now().replace(microsecond=0)


def minutes_left(guest):
    """Minutes until the lock ends (rounded up, at most 15), or 0 when the account is not locked."""
    row = LoginLock.objects.filter(guest=guest).first()
    if row is None or row.locked_until is None:
        return 0
    seconds = (row.locked_until - _now()).total_seconds()
    if seconds <= 0:
        return 0
    return min(LOCK_MINUTES, math.ceil(seconds / 60))


def register_failure(guest):
    """Count one wrong password. Returns True when this attempt locks the account."""
    row, _ = LoginLock.objects.get_or_create(guest=guest)
    if row.locked_until is not None and row.locked_until <= _now():
        row.locked_until = None          # an old lock that already ended
    row.failed_count += 1
    row.unseen_failed += 1
    row.last_failed_at = _now()
    locked = row.failed_count >= MAX_ATTEMPTS
    if locked:
        row.locked_until = _now() + datetime.timedelta(minutes=LOCK_MINUTES)
        row.last_locked_at = _now()
        row.failed_count = 0
    row.save()
    return locked


def attempts_left(guest):
    """Wrong passwords that are still allowed before the lock (week 13)."""
    row = LoginLock.objects.filter(guest=guest).first()
    return MAX_ATTEMPTS - (row.failed_count if row else 0)


def wrong_password_message(left):
    return 'Invalid email or password. %d attempt%s left before the account is locked.' % (
        left, '' if left == 1 else 's')


def _iso(dt):
    """Times are stored without a zone (USE_TZ = False, server zone = TIME_ZONE);
    send them with the zone, so the browser shows the guest's local time."""
    return dt.replace(tzinfo=ZoneInfo(settings.TIME_ZONE)).isoformat() if dt else None


def take_notice(guest):
    """Right password: return the "someone tried to log in" notice (or None)
    and remove the record, so the notice is shown only once (week 13)."""
    row = LoginLock.objects.filter(guest=guest).first()
    notice = None
    if row is not None and row.unseen_failed > 0:
        notice = {
            'failed_attempts': row.unseen_failed,
            'last_failed_at': _iso(row.last_failed_at),
            'was_locked': row.last_locked_at is not None,
            'last_locked_at': _iso(row.last_locked_at),
        }
    clear(guest)
    return notice


def unlock(guest):
    """Admin unlock: end the lock but keep the notice for the owner (week 13)."""
    LoginLock.objects.filter(guest=guest).update(locked_until=None, failed_count=0)


def clear(guest):
    """Right password, password reset or admin unlock: start from zero."""
    LoginLock.objects.filter(guest=guest).delete()


def locked_message(minutes):
    return ('Too many wrong passwords. This account is locked for %d more minute%s. '
            'Try again later or reset your password.' % (minutes, '' if minutes == 1 else 's'))


def unknown_email_answer(email):
    """Wrong login for an e-mail without an account: the same (status, body) a real
    account would get, counted in the cache only (week 13)."""
    key = 'login-unknown:' + email.strip().lower()
    state = cache.get(key) or {'count': 0, 'until': None}
    now = _now()
    if state['until'] and state['until'] > now:
        minutes = min(LOCK_MINUTES, math.ceil((state['until'] - now).total_seconds() / 60))
        return 423, {'detail': locked_message(minutes), 'locked': True}
    state['count'] += 1
    if state['count'] >= MAX_ATTEMPTS:
        state = {'count': 0, 'until': now + datetime.timedelta(minutes=LOCK_MINUTES)}
        cache.set(key, state, (LOCK_MINUTES + 1) * 60)
        return 423, {'detail': locked_message(LOCK_MINUTES), 'locked': True}
    cache.set(key, state, (LOCK_MINUTES + 1) * 60)
    left = MAX_ATTEMPTS - state['count']
    return 401, {'detail': wrong_password_message(left), 'attempts_left': left}
