"""Room reviews (rating 1-5 + comment), one per room per finished stay.

Kept in its own module, like roles.py, so the shared models.py stays as it is.
Table: db/06_room_reviews.sql

A review hangs on booking_room (the "room inside a booking" row). The room, the
booking and the guest are therefore always derived from it and cannot disagree.
"""
import datetime

from django.db import models
from django.db.models import Avg, Count, Q

from .models import BookingRoom

PENDING = 'Pending'      # written by a guest, waiting for an admin (not on the website yet)
PUBLISHED = 'Published'  # approved by an admin: visible and counted in the ratings
HIDDEN = 'Hidden'        # rejected or removed by an admin
STATUSES = (PENDING, PUBLISHED, HIDDEN)

# A stay can be reviewed once the guest has left.
REVIEWABLE_BOOKING_STATUSES = ('Completed',)

MAX_COMMENT_LENGTH = 1000


def now():
    """Local time without microseconds (MySQL DATETIME has none), same style as the booking code."""
    return datetime.datetime.now().replace(microsecond=0)


class RoomReview(models.Model):
    review_id = models.AutoField(primary_key=True)
    booking_room = models.OneToOneField(BookingRoom, db_column='booking_room_id',
                                        on_delete=models.PROTECT, related_name='review')
    rating = models.PositiveSmallIntegerField()
    comment = models.CharField(max_length=MAX_COMMENT_LENGTH, blank=True, default='')
    status = models.CharField(max_length=10, default=PENDING)   # db/10_review_moderation.sql
    created_at = models.DateTimeField(default=now)
    updated_at = models.DateTimeField(default=now)   # set when the author edits, see reviews_api.py

    class Meta:
        managed = False
        db_table = 'room_review'
        ordering = ('-created_at', '-review_id')
        verbose_name = 'room review'
        verbose_name_plural = 'room reviews'
        # Same rules as db/06_room_reviews.sql (the tests build the table from this Meta).
        constraints = [
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name='chk_review_rating'),
            models.CheckConstraint(condition=Q(status__in=STATUSES), name='chk_review_status'),
        ]

    def __str__(self):
        return 'Room %s: %d/5' % (self.booking_room.room.room_number, self.rating)

    @property
    def room(self):
        return self.booking_room.room

    @property
    def guest(self):
        return self.booking_room.booking.guest

    @property
    def booking(self):
        return self.booking_room.booking


def public_name(guest):
    """'Amina S.' - the only part of a guest that is shown next to a public review."""
    first = (guest.first_name or '').strip()
    last = (guest.last_name or '').strip()
    return (first + (' ' + last[0].upper() + '.' if last else '')).strip() or 'Guest'


def rating_summary(published_reviews):
    """{'average': 4.5 | None, 'count': n, 'distribution': {'1': n, ... '5': n}} for a review queryset."""
    agg = published_reviews.aggregate(avg=Avg('rating'), n=Count('review_id'))
    per_star = dict(published_reviews.order_by().values_list('rating').annotate(n=Count('review_id')))
    return {
        'average': round(float(agg['avg']), 2) if agg['avg'] is not None else None,
        'count': agg['n'],
        'distribution': {str(star): per_star.get(star, 0) for star in range(5, 0, -1)},
    }


def published():
    return RoomReview.objects.filter(status=PUBLISHED)
