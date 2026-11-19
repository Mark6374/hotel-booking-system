"""Numbers for the admin home page. Plain ORM queries, a handful per page view."""
import datetime

from django.db.models import Avg, Count, Sum

from .models import Booking, BookingRoom, Payment, Room
from .reviews import PUBLISHED, HIDDEN, RoomReview

ACTIVE = ('Confirmed', 'CheckedIn')


def dashboard_stats():
    today = datetime.date.today()
    week = today + datetime.timedelta(days=7)
    month_ago = datetime.datetime.now() - datetime.timedelta(days=30)
    week_ago = datetime.datetime.now() - datetime.timedelta(days=7)

    rooms_total = Room.objects.count()
    in_maintenance = Room.objects.filter(status='Maintenance').count()
    sellable = rooms_total - in_maintenance
    tonight = (BookingRoom.objects
               .filter(booking__status__in=ACTIVE, booking__check_in__lte=today, booking__check_out__gt=today)
               .values('room_id').distinct().count())

    money = Payment.objects.filter(payment_date__gte=month_ago).values('payment_status').annotate(total=Sum('amount'))
    totals = {row['payment_status']: row['total'] or 0 for row in money}

    reviews = RoomReview.objects
    review_row = reviews.filter(status=PUBLISHED).aggregate(avg=Avg('rating'), n=Count('review_id'))

    return {
        'today': today,
        'arrivals_today': Booking.objects.filter(check_in=today, status='Confirmed').count(),
        'departures_today': Booking.objects.filter(check_out=today, status='CheckedIn').count(),
        'in_house': Booking.objects.filter(status='CheckedIn').count(),
        'rooms_total': rooms_total,
        'rooms_in_maintenance': in_maintenance,
        'occupancy_percent': round(100 * tonight / sellable) if sellable > 0 else 0,
        'occupied_tonight': tonight,
        'revenue_30d': totals.get('Paid', 0),
        'refunds_30d': totals.get('Refunded', 0),
        'upcoming_arrivals': list(
            Booking.objects.filter(status='Confirmed', check_in__gte=today, check_in__lte=week)
            .select_related('guest').order_by('check_in', 'booking_id')[:8]),
        'reviews_published': review_row['n'],
        'reviews_average': round(float(review_row['avg']), 2) if review_row['avg'] is not None else None,
        'reviews_hidden': reviews.filter(status=HIDDEN).count(),
        'reviews_this_week': reviews.filter(created_at__gte=week_ago).count(),
        'latest_reviews': list(
            reviews.select_related('booking_room__room', 'booking_room__booking__guest')
            .order_by('-created_at', '-review_id')[:5]),
    }
