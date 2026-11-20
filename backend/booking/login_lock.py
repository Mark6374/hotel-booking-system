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
"""
import datetime
import math

from django.db import models

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


class LoginLock(models.Model):
    guest = models.OneToOneField('booking.Guest', on_delete=models.CASCADE,
                                 primary_key=True, db_column='guest_id')
    failed_count = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    last_failed_at = models.DateTimeField(null=True, blank=True)

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
    row.last_failed_at = _now()
    locked = row.failed_count >= MAX_ATTEMPTS
    if locked:
        row.locked_until = _now() + datetime.timedelta(minutes=LOCK_MINUTES)
        row.failed_count = 0
    row.save()
    return locked


def clear(guest):
    """Right password, password reset or admin unlock: start from zero."""
    LoginLock.objects.filter(guest=guest).delete()


def locked_message(minutes):
    return ('Too many wrong passwords. This account is locked for %d more minute%s. '
            'Try again later or reset your password.' % (minutes, '' if minutes == 1 else 's'))
