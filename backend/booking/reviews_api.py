"""Room reviews API for the React frontend. See REVIEWS_API.md.

Reading is public (visitors choose a room by what guests say).
Writing needs a logged-in, not blocked account AND a finished stay in that room.
"""
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, Q
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import Booking, BookingRoom, Guest, Room, RoomType
from .reviews import (HIDDEN, MAX_COMMENT_LENGTH, PENDING, PUBLISHED, REVIEWABLE_BOOKING_STATUSES, STATUSES,
                      RoomReview, now, public_name, rating_summary)
from .roles import IsActiveAccount, IsAdmin, role_info


def _err(message, code=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({'detail': message, **extra}, status=code)


def _viewer(request):
    """(guest or None, is_staff). Blocked accounts count as visitors, like in views.py."""
    user = request.user
    if not isinstance(user, Guest):
        return None, False
    role, active = role_info(user)
    if not active:
        return None, False
    return user, role in ('staff', 'admin')


def _with_stay(qs):
    return qs.select_related('booking_room__room__room_type', 'booking_room__booking__guest')


def review_payload(review, viewer=None, staff=False):
    br = review.booking_room
    guest = br.booking.guest
    data = {
        'review_id': review.review_id,
        'room_id': br.room_id,
        'room_number': br.room.room_number,
        'rating': review.rating,
        'comment': review.comment,
        'author': public_name(guest),
        'stay_check_in': br.booking.check_in.isoformat(),
        'stay_check_out': br.booking.check_out.isoformat(),
        'created_at': review.created_at.isoformat(),
        'updated_at': review.updated_at.isoformat(),
        'edited': review.updated_at > review.created_at,
        'is_mine': bool(viewer and guest.guest_id == viewer.guest_id),
    }
    if staff or data['is_mine']:
        data['status'] = review.status   # the owner may see that a moderator hid the review
    return data


class ReviewWriteThrottle(UserRateThrottle):
    scope = 'review_write'


class ReviewInputSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(max_length=MAX_COMMENT_LENGTH, required=False, allow_blank=True, default='')
    booking_id = serializers.IntegerField(required=False)

    def validate_comment(self, value):
        value = value.strip()
        # control characters (except new lines) have no place in a comment
        return ''.join(ch for ch in value if ch in '\n\t' or ch.isprintable())


class ReviewPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 50


class RoomReviewListCreateView(generics.ListAPIView):
    """GET  /api/rooms/<id>/reviews/   public: published reviews + rating summary of the room
       POST /api/rooms/<id>/reviews/   a guest with a finished stay in this room writes a review"""
    pagination_class = ReviewPagination
    throttle_classes = [ReviewWriteThrottle]

    def get_throttles(self):
        # only writing is limited; reading stays free
        return super().get_throttles() if self.request.method == 'POST' else []

    ORDERINGS = {
        'newest': ('-created_at', '-review_id'),
        'oldest': ('created_at', 'review_id'),
        'highest': ('-rating', '-created_at', '-review_id'),
        'lowest': ('rating', '-created_at', '-review_id'),
    }

    def _room(self):
        return Room.objects.filter(pk=self.kwargs['pk']).first()

    def get_queryset(self):
        _, staff = _viewer(self.request)
        qs = RoomReview.objects.filter(booking_room__room_id=self.kwargs['pk'])
        wanted = self.request.query_params.get('status', PUBLISHED)
        if not (staff and wanted in STATUSES + ('all',)):
            wanted = PUBLISHED                      # visitors and guests only ever see published reviews
        if wanted != 'all':
            qs = qs.filter(status=wanted)
        rating = self.request.query_params.get('rating')
        if rating and rating.isdigit() and 1 <= int(rating) <= 5:
            qs = qs.filter(rating=int(rating))
        order = self.ORDERINGS.get(self.request.query_params.get('ordering'), self.ORDERINGS['newest'])
        return _with_stay(qs).order_by(*order)

    def list(self, request, *args, **kwargs):
        room = self._room()
        if room is None:
            return _err('Room not found.', status.HTTP_404_NOT_FOUND)
        viewer, staff = _viewer(request)
        page = self.paginate_queryset(self.get_queryset())
        body = self.get_paginated_response([review_payload(r, viewer, staff) for r in page]).data
        body['room'] = {'room_id': room.room_id, 'room_number': room.room_number}
        body['summary'] = rating_summary(RoomReview.objects.filter(booking_room__room_id=room.room_id,
                                                                  status=PUBLISHED))
        return Response(body)

    def post(self, request, pk):
        if not isinstance(request.user, Guest):
            return _err('Log in to review a room.', status.HTTP_401_UNAUTHORIZED)
        user, _ = _viewer(request)
        if user is None:
            return _err('This account is blocked.', status.HTTP_403_FORBIDDEN)
        room = self._room()
        if room is None:
            return _err('Room not found.', status.HTTP_404_NOT_FOUND)
        s = ReviewInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data

        # The guest's finished stays in THIS room, newest first. Verified stay = no fake reviews.
        stays = (BookingRoom.objects
                 .filter(room_id=room.room_id, booking__guest_id=user.guest_id,
                         booking__status__in=REVIEWABLE_BOOKING_STATUSES)
                 .select_related('booking').order_by('-booking__check_out', '-booking_room_id'))
        if 'booking_id' in d:
            stays = stays.filter(booking_id=d['booking_id'])
        stays = list(stays)
        if not stays:
            return _err('You can review a room only after you have stayed in it '
                        '(your booking must be completed).', status.HTTP_403_FORBIDDEN)
        reviewed = set(RoomReview.objects.filter(booking_room__in=stays).values_list('booking_room_id', flat=True))
        free = [b for b in stays if b.booking_room_id not in reviewed]
        if not free:
            return _err('You have already reviewed this room for that stay. You can edit your review.',
                        status.HTTP_409_CONFLICT)
        try:
            with transaction.atomic():
                # every new review waits for an admin before it appears on the website
                review = RoomReview.objects.create(booking_room=free[0], rating=d['rating'], comment=d['comment'],
                                                   status=PENDING)
        except IntegrityError:                       # two requests at the same moment
            return _err('You have already reviewed this room for that stay.', status.HTTP_409_CONFLICT)
        review = _with_stay(RoomReview.objects).get(pk=review.pk)
        return Response(review_payload(review, user), status=status.HTTP_201_CREATED)


class ReviewDetailView(APIView):
    """PATCH  /api/reviews/<id>/   the author edits rating / comment (not after a moderator hid it)
       DELETE /api/reviews/<id>/   the author removes her own review for good"""
    permission_classes = [IsActiveAccount]
    throttle_classes = [ReviewWriteThrottle]

    def _own(self, request, pk):
        review = _with_stay(RoomReview.objects).filter(pk=pk).first()
        if review is None or review.booking_room.booking.guest_id != request.user.guest_id:
            # the same answer for "not found" and "someone else's": do not reveal other reviews' ids
            return None
        return review

    def patch(self, request, pk):
        review = self._own(request, pk)
        if review is None:
            return _err('Review not found.', status.HTTP_404_NOT_FOUND)
        if review.status == HIDDEN:
            return _err('This review was hidden by a moderator and cannot be edited.', status.HTTP_403_FORBIDDEN)
        s = ReviewInputSerializer(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if 'rating' not in d and 'comment' not in d:
            return _err('Send a rating and/or a comment.')
        fields = []
        for f in ('rating', 'comment'):
            if f in d:
                setattr(review, f, d[f])
                fields.append(f)
        review.updated_at = now()
        if review.status == PUBLISHED:
            # an approved text that changes must be approved again
            review.status = PENDING
            fields.append('status')
        review.save(update_fields=fields + ['updated_at'])
        return Response(review_payload(review, request.user))

    def delete(self, request, pk):
        review = self._own(request, pk)
        if review is None:
            return _err('Review not found.', status.HTTP_404_NOT_FOUND)
        review.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReviewModerateView(APIView):
    """POST /api/reviews/<id>/moderate/ {status: Published|Hidden}  - admin only.
    Published = approve (the review appears on the website), Hidden = reject / remove."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        new = request.data.get('status')
        if new not in (PUBLISHED, HIDDEN):
            return _err('status must be Published or Hidden.')
        n = RoomReview.objects.filter(pk=pk).update(status=new)
        if not n:
            return _err('Review not found.', status.HTTP_404_NOT_FOUND)
        review = _with_stay(RoomReview.objects).get(pk=pk)
        return Response(review_payload(review, request.user, staff=True))


class MyReviewsView(APIView):
    """GET /api/reviews/mine/  my reviews, and the finished stays I have not reviewed yet"""
    permission_classes = [IsActiveAccount]

    def get(self, request):
        mine = _with_stay(RoomReview.objects).filter(booking_room__booking__guest_id=request.user.guest_id)
        stays = (BookingRoom.objects
                 .filter(booking__guest_id=request.user.guest_id,
                         booking__status__in=REVIEWABLE_BOOKING_STATUSES, review__isnull=True)
                 .select_related('room__room_type', 'booking').order_by('-booking__check_out', 'booking_room_id'))
        return Response({
            'reviews': [review_payload(r, request.user) for r in mine],
            'can_review': [{
                'booking_id': b.booking_id, 'room_id': b.room_id, 'room_number': b.room.room_number,
                'type_name': b.room.room_type.type_name,
                'check_in': b.booking.check_in.isoformat(), 'check_out': b.booking.check_out.isoformat(),
            } for b in stays],
        })


class RatingsOverviewView(APIView):
    """GET /api/reviews/summary/  public: average + count for every room and room type in ONE request,
    so the room cards can show stars without one request per room."""

    def get(self, request):
        pub = Q(bookingroom__review__status=PUBLISHED)
        rooms = Room.objects.annotate(avg=Avg('bookingroom__review__rating', filter=pub),
                                      n=Count('bookingroom__review', filter=pub))
        types = RoomType.objects.annotate(
            avg=Avg('room__bookingroom__review__rating', filter=Q(room__bookingroom__review__status=PUBLISHED)),
            n=Count('room__bookingroom__review', filter=Q(room__bookingroom__review__status=PUBLISHED)))

        def row(avg, n):
            return {'average': round(float(avg), 2) if avg is not None else None, 'count': n}
        return Response({
            'rooms': {str(r.room_id): row(r.avg, r.n) for r in rooms},
            'room_types': {str(t.room_type_id): row(t.avg, t.n) for t in types},
        })
