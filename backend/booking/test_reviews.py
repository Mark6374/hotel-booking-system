"""Room reviews API. Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking
"""
import datetime
from unittest import mock

from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from .auth import make_token
from .login_lock import LoginLock
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .reviews import RoomReview
from .reviews_api import ReviewWriteThrottle
from .roles import GuestRole

MODELS = [Guest, GuestRole, RoomType, Room, Booking, BookingRoom, Payment, RoomReview, LoginLock]
TODAY = datetime.date.today()


class ReviewApiTests(TransactionTestCase):
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
        cache.clear()
        for m in reversed(MODELS):
            m.objects.all()._raw_delete('default')
        self.amina = self._guest('amina@example.com', 'Amina', 'Sadykova')
        self.daniel = self._guest('daniel@example.com', 'Daniel', 'Brooks')
        self.staff = self._guest('staff@example.com', 'Timur', 'A', 'staff')
        t1 = RoomType.objects.create(type_name='Standard', capacity=2, price_per_night=60)
        t2 = RoomType.objects.create(type_name='Suite', capacity=4, price_per_night=150)
        self.r1 = Room.objects.create(room_number='101', floor=1, room_type=t1)
        self.r2 = Room.objects.create(room_number='102', floor=1, room_type=t1)
        self.r3 = Room.objects.create(room_number='301', floor=3, room_type=t2)

    # ---- helpers
    def _guest(self, email, first='F', last='L', role=None):
        g = Guest(first_name=first, last_name=last, email=email, phone='+7 700 000 0000')
        g.set_password('Passw0rd!')
        g.save()
        if role:
            GuestRole.objects.create(guest=g, role=role)
        return g

    def stay(self, guest, room, status='Completed', days_ago=10):
        b = Booking.objects.create(guest=guest, booking_date=datetime.datetime.now(),
                                   check_in=TODAY - datetime.timedelta(days=days_ago),
                                   check_out=TODAY - datetime.timedelta(days=days_ago - 3), status=status)
        return BookingRoom.objects.create(booking=b, room=room, guests_count=1, price_per_night=60)

    def api(self, guest=None):
        c = APIClient()
        if guest:
            c.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(guest))
        return c

    def post(self, guest, room, **body):
        return self.api(guest).post('/api/rooms/%d/reviews/' % room.room_id, body, format='json')

    def reviews(self, room, who=None, query=''):
        return self.api(who).get('/api/rooms/%d/reviews/%s' % (room.room_id, query))

    # ---- reading
    def test_empty_room_has_empty_summary(self):
        r = self.reviews(self.r1)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['count'], 0)
        self.assertEqual(r.data['summary']['count'], 0)
        self.assertIsNone(r.data['summary']['average'])
        self.assertEqual(r.data['summary']['distribution'], {'5': 0, '4': 0, '3': 0, '2': 0, '1': 0})

    def test_unknown_room_is_404(self):
        self.assertEqual(self.api().get('/api/rooms/9999/reviews/').status_code, 404)

    # ---- writing: who may review
    def test_visitor_cannot_review(self):
        self.stay(self.amina, self.r1)
        r = self.api().post('/api/rooms/%d/reviews/' % self.r1.room_id, {'rating': 5}, format='json')
        self.assertEqual(r.status_code, 401)

    def test_needs_a_completed_stay_in_that_room(self):
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 403)           # no stay at all
        self.stay(self.amina, self.r1, status='Confirmed')
        self.stay(self.amina, self.r1, status='CheckedIn')
        self.stay(self.amina, self.r1, status='Cancelled')
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 403)           # not finished
        self.stay(self.amina, self.r2)
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 403)           # other room
        self.stay(self.daniel, self.r1)
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 403)           # other guest's stay
        self.assertEqual(RoomReview.objects.count(), 0)

    def test_blocked_account_cannot_review(self):
        self.stay(self.amina, self.r1)
        GuestRole.objects.create(guest=self.amina, role='guest', is_active=False)
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 403)

    def test_create_review_and_public_view(self):
        self.stay(self.amina, self.r1)
        r = self.post(self.amina, self.r1, rating=5, comment='  Quiet and spotless.  ')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['comment'], 'Quiet and spotless.')
        self.assertTrue(r.data['is_mine'])
        pub = self.reviews(self.r1)                                  # a visitor
        self.assertEqual(pub.data['count'], 1)
        item = pub.data['results'][0]
        self.assertEqual(item['author'], 'Amina S.')
        self.assertFalse(item['is_mine'])
        flat = str(pub.data)
        for secret in ('amina@example.com', 'Sadykova', '+7 700', 'guest_id'):
            self.assertNotIn(secret, flat)
        self.assertNotIn('status', item)                             # moderation state is not public
        self.assertEqual(pub.data['summary']['average'], 5.0)
        self.assertTrue(self.reviews(self.r1, self.amina).data['results'][0]['is_mine'])

    def test_comment_is_optional(self):
        self.stay(self.amina, self.r1)
        r = self.post(self.amina, self.r1, rating=4)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['comment'], '')

    def test_validation(self):
        self.stay(self.amina, self.r1)
        for bad in ({}, {'rating': 0}, {'rating': 6}, {'rating': 'x'}, {'rating': 3.5},
                    {'rating': 5, 'comment': 'x' * 1001}):
            self.assertEqual(self.post(self.amina, self.r1, **bad).status_code, 400, bad)
        self.assertEqual(RoomReview.objects.count(), 0)

    def test_one_review_per_stay_but_new_stay_can_be_reviewed(self):
        first = self.stay(self.amina, self.r1, days_ago=30)
        self.assertEqual(self.post(self.amina, self.r1, rating=4).status_code, 201)
        self.assertEqual(self.post(self.amina, self.r1, rating=1).status_code, 409)           # same stay again
        second = self.stay(self.amina, self.r1, days_ago=5)
        r = self.post(self.amina, self.r1, rating=5)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(RoomReview.objects.get(pk=r.data['review_id']).booking_room_id, second.booking_room_id)
        self.assertEqual(RoomReview.objects.filter(booking_room=first).count(), 1)

    def test_choose_the_stay_with_booking_id(self):
        old = self.stay(self.amina, self.r1, days_ago=30)
        self.stay(self.amina, self.r1, days_ago=5)
        r = self.post(self.amina, self.r1, rating=3, booking_id=old.booking_id)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(RoomReview.objects.get(pk=r.data['review_id']).booking_room_id, old.booking_room_id)
        self.assertEqual(self.post(self.amina, self.r1, rating=3, booking_id=old.booking_id).status_code, 409)
        self.assertEqual(self.post(self.amina, self.r1, rating=3, booking_id=99999).status_code, 403)

    def test_database_refuses_a_second_review_for_a_stay(self):
        br = self.stay(self.amina, self.r1)
        RoomReview.objects.create(booking_room=br, rating=5)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RoomReview.objects.create(booking_room=br, rating=4)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RoomReview.objects.create(booking_room=self.stay(self.amina, self.r2), rating=9)

    def test_write_rate_limit(self):
        self.stay(self.amina, self.r1)
        with mock.patch.object(ReviewWriteThrottle, 'THROTTLE_RATES', {'review_write': '2/hour'}):
            codes = [self.post(self.amina, self.r1, rating=0).status_code for _ in range(3)]
            self.assertEqual(codes, [400, 400, 429])
            self.assertEqual(self.reviews(self.r1).status_code, 200)                           # reading is free

    # ---- editing / deleting
    def test_author_edits_and_deletes_own_review(self):
        self.stay(self.amina, self.r1)
        rid = self.post(self.amina, self.r1, rating=3, comment='ok').data['review_id']
        r = self.api(self.amina).patch('/api/reviews/%d/' % rid, {'rating': 4}, format='json')
        self.assertEqual((r.status_code, r.data['rating'], r.data['comment']), (200, 4, 'ok'))
        self.assertEqual(self.api(self.amina).patch('/api/reviews/%d/' % rid, {}, format='json').status_code, 400)
        self.assertEqual(self.api(self.amina).patch('/api/reviews/%d/' % rid, {'rating': 9}, format='json').status_code, 400)
        self.assertEqual(self.api(self.amina).delete('/api/reviews/%d/' % rid).status_code, 204)
        self.assertEqual(RoomReview.objects.count(), 0)
        self.assertEqual(self.post(self.amina, self.r1, rating=5).status_code, 201)            # may write again

    def test_cannot_touch_someone_elses_review(self):
        self.stay(self.amina, self.r1)
        rid = self.post(self.amina, self.r1, rating=3).data['review_id']
        for method, body in (('patch', {'rating': 1}), ('delete', None)):
            r = getattr(self.api(self.daniel), method)('/api/reviews/%d/' % rid, *([body] if body else []), format='json')
            self.assertEqual(r.status_code, 404)
        self.assertEqual(self.api().delete('/api/reviews/%d/' % rid).status_code, 401)
        self.assertEqual(RoomReview.objects.get(pk=rid).rating, 3)

    def test_edit_marks_review_as_edited(self):
        self.stay(self.amina, self.r1)
        rid = self.post(self.amina, self.r1, rating=3).data['review_id']
        self.assertFalse(self.reviews(self.r1).data['results'][0]['edited'])
        RoomReview.objects.filter(pk=rid).update(created_at=datetime.datetime.now() - datetime.timedelta(days=2))
        self.api(self.amina).patch('/api/reviews/%d/' % rid, {'comment': 'better'}, format='json')
        self.assertTrue(self.reviews(self.r1).data['results'][0]['edited'])

    # ---- moderation
    def test_moderation_hides_review_everywhere_public(self):
        self.stay(self.amina, self.r1)
        rid = self.post(self.amina, self.r1, rating=1, comment='rude text').data['review_id']
        url = '/api/reviews/%d/moderate/' % rid
        self.assertEqual(self.api().post(url, {'status': 'Hidden'}, format='json').status_code, 401)
        self.assertEqual(self.api(self.daniel).post(url, {'status': 'Hidden'}, format='json').status_code, 403)
        self.assertEqual(self.api(self.staff).post(url, {'status': 'Nope'}, format='json').status_code, 400)
        self.assertEqual(self.api(self.staff).post('/api/reviews/999/moderate/', {'status': 'Hidden'}, format='json').status_code, 404)
        self.assertEqual(self.api(self.staff).post(url, {'status': 'Hidden'}, format='json').status_code, 200)

        self.assertEqual(self.reviews(self.r1).data['count'], 0)
        self.assertEqual(self.reviews(self.r1).data['summary']['count'], 0)
        self.assertEqual(self.api().get('/api/reviews/summary/').data['rooms'][str(self.r1.room_id)]['count'], 0)
        self.assertEqual(self.reviews(self.r1, self.daniel, '?status=all').data['count'], 0)      # guests cannot ask for it
        self.assertEqual(self.reviews(self.r1, self.staff, '?status=all').data['count'], 1)
        self.assertEqual(self.reviews(self.r1, self.staff, '?status=Hidden').data['results'][0]['status'], 'Hidden')
        self.assertEqual(self.api(self.amina).get('/api/reviews/mine/').data['reviews'][0]['status'], 'Hidden')
        # the author cannot edit it back into view
        self.assertEqual(self.api(self.amina).patch('/api/reviews/%d/' % rid, {'rating': 5}, format='json').status_code, 403)
        # moderation is not an edit
        self.assertFalse(self.reviews(self.r1, self.staff, '?status=all').data['results'][0]['edited'])
        self.api(self.staff).post(url, {'status': 'Published'}, format='json')
        self.assertEqual(self.reviews(self.r1).data['count'], 1)

    # ---- lists
    def test_ordering_filter_and_pagination(self):
        for i, rating in enumerate([5, 3, 1, 4, 2]):
            br = self.stay(Guest.objects.create(first_name='G%d' % i, last_name='X', email='g%d@e.com' % i, phone='1'),
                           self.r1, days_ago=10 + i)
            RoomReview.objects.create(booking_room=br, rating=rating,
                                      created_at=datetime.datetime.now() - datetime.timedelta(hours=i))
        res = lambda q: [x['rating'] for x in self.reviews(self.r1, query=q).data['results']]
        self.assertEqual(res(''), [5, 3, 1, 4, 2])                              # newest first
        self.assertEqual(res('?ordering=oldest'), [2, 4, 1, 3, 5])
        self.assertEqual(res('?ordering=highest'), [5, 4, 3, 2, 1])
        self.assertEqual(res('?ordering=lowest'), [1, 2, 3, 4, 5])
        self.assertEqual(res('?rating=4'), [4])
        self.assertEqual(res('?rating=banana'), [5, 3, 1, 4, 2])
        page = self.reviews(self.r1, query='?page_size=2&page=2').data
        self.assertEqual((page['count'], [x['rating'] for x in page['results']]), (5, [1, 4]))
        self.assertIsNotNone(page['next'])
        self.assertEqual(len(self.reviews(self.r1, query='?page_size=1000').data['results']), 5)  # capped at 50
        s = self.reviews(self.r1).data['summary']
        self.assertEqual((s['average'], s['count']), (3.0, 5))
        self.assertEqual(s['distribution'], {'5': 1, '4': 1, '3': 1, '2': 1, '1': 1})

    def test_summary_for_all_rooms_and_types(self):
        for guest, room, rating in ((self.amina, self.r1, 5), (self.daniel, self.r1, 4),
                                    (self.amina, self.r2, 2)):
            RoomReview.objects.create(booking_room=self.stay(guest, room), rating=rating)
        data = self.api().get('/api/reviews/summary/').data
        self.assertEqual(data['rooms'][str(self.r1.room_id)], {'average': 4.5, 'count': 2})
        self.assertEqual(data['rooms'][str(self.r2.room_id)], {'average': 2.0, 'count': 1})
        self.assertEqual(data['rooms'][str(self.r3.room_id)], {'average': None, 'count': 0})
        self.assertEqual(data['room_types'][str(self.r1.room_type_id)], {'average': 3.67, 'count': 3})
        self.assertEqual(data['room_types'][str(self.r3.room_type_id)], {'average': None, 'count': 0})

    def test_my_reviews_and_what_i_can_still_review(self):
        self.assertEqual(self.api().get('/api/reviews/mine/').status_code, 401)
        done = self.stay(self.amina, self.r1)
        self.stay(self.amina, self.r2, days_ago=4)
        self.stay(self.amina, self.r3, status='Confirmed')
        self.stay(self.daniel, self.r2)
        self.post(self.amina, self.r1, rating=5)
        data = self.api(self.amina).get('/api/reviews/mine/').data
        self.assertEqual([r['room_number'] for r in data['reviews']], ['101'])
        self.assertEqual([c['room_number'] for c in data['can_review']], ['102'])
        self.assertEqual(data['can_review'][0]['type_name'], 'Standard')
        self.assertNotEqual(data['can_review'][0]['booking_id'], done.booking_id)
