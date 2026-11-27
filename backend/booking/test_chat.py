"""Chat REST API (customer <-> admin). Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_chat
The WebSocket part is in test_chat_socket.py.
"""
from unittest import mock

from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from . import chat
from .auth import make_token
from .chat import ChatMessage, Conversation
from .login_lock import LoginLock
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType
from .photos import GuestPhoto
from .reviews import RoomReview
from .roles import GuestRole

# the booking tables are needed too: Django checks them when a guest is deleted
MODELS = [Guest, GuestRole, GuestPhoto, Conversation, ChatMessage, LoginLock,
          RoomType, Room, Booking, BookingRoom, Payment, RoomReview]
MESSAGES = '/api/chat/messages/'
INBOX = '/api/chat/admin/conversations/'


def admin_messages(cid):
    return '/api/chat/admin/conversations/%d/messages/' % cid


class ChatTestBase(TransactionTestCase):
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
        self.amina = self.guest('amina@example.com', 'Amina', 'Sadykova')
        self.daniel = self.guest('daniel@example.com', 'Daniel', 'Brooks')
        self.admin = self.guest('admin@example.com', 'Mark', 'Yeriskin', 'admin')
        self.staff = self.guest('staff@example.com', 'Dmitriy', 'Cherepkov', 'staff')
        self.a, self.d = self.client_for(self.amina), self.client_for(self.daniel)
        self.adm, self.stf = self.client_for(self.admin), self.client_for(self.staff)

    def guest(self, email, first='F', last='L', role=None, active=True):
        g = Guest.objects.create(first_name=first, last_name=last, email=email, phone='+7 700 000 0000')
        if role or not active:
            GuestRole.objects.create(guest=g, role=role or 'guest', is_active=active)
        return g

    def client_for(self, guest):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Bearer ' + make_token(guest))
        return c


class CustomerChatTests(ChatTestBase):
    def test_first_message_creates_the_conversation_and_is_stored(self):
        r = self.a.post(MESSAGES, {'body': 'Is late check-in possible?'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['body'], 'Is late check-in possible?')
        self.assertTrue(r.data['from_customer'])
        self.assertEqual(r.data['sender_name'], 'Amina S.')
        self.assertIsNone(r.data['read_at'])
        self.assertRegex(r.data['created_at'], r'[+-]\d\d:\d\d$')            # explicit UTC offset
        row = ChatMessage.objects.get()                                       # really in the database
        self.assertEqual((row.sender_id, row.body), (self.amina.guest_id, 'Is late check-in possible?'))
        self.assertEqual(Conversation.objects.get().guest_id, self.amina.guest_id)

    def test_every_customer_has_exactly_one_conversation(self):
        for text in ('one', 'two', 'three'):
            self.a.post(MESSAGES, {'body': text}, format='json')
        self.d.post(MESSAGES, {'body': 'hello'}, format='json')
        self.assertEqual(Conversation.objects.count(), 2)
        self.assertEqual(ChatMessage.objects.filter(conversation__guest=self.amina).count(), 3)

    def test_conversation_endpoint(self):
        self.assertEqual(self.a.get('/api/chat/conversation/').data, {'conversation_id': None, 'unread': 0})
        self.a.post(MESSAGES, {'body': 'hi'}, format='json')
        data = self.a.get('/api/chat/conversation/').data
        self.assertEqual(data['conversation_id'], Conversation.objects.get().conversation_id)

    def test_history_is_oldest_first_and_pages_backwards(self):
        for i in range(1, 8):
            self.a.post(MESSAGES, {'body': 'm%d' % i}, format='json')
        page = self.a.get(MESSAGES, {'limit': 3}).data
        self.assertEqual([m['body'] for m in page['results']], ['m5', 'm6', 'm7'])
        self.assertTrue(page['has_more'])
        older = self.a.get(MESSAGES, {'limit': 3, 'before': page['next_before']}).data
        self.assertEqual([m['body'] for m in older['results']], ['m2', 'm3', 'm4'])
        oldest = self.a.get(MESSAGES, {'limit': 3, 'before': older['next_before']}).data
        self.assertEqual([m['body'] for m in oldest['results']], ['m1'])
        self.assertFalse(oldest['has_more'])
        self.assertIsNone(oldest['next_before'])

    def test_history_after_catches_up(self):
        first = self.a.post(MESSAGES, {'body': 'm1'}, format='json').data['message_id']
        for t in ('m2', 'm3'):
            self.a.post(MESSAGES, {'body': t}, format='json')
        data = self.a.get(MESSAGES, {'after': first}).data
        self.assertEqual([m['body'] for m in data['results']], ['m2', 'm3'])
        self.assertEqual(self.a.get(MESSAGES, {'after': data['results'][-1]['message_id']}).data['results'], [])

    def test_empty_history_before_any_message(self):
        self.assertEqual(self.a.get(MESSAGES).data['results'], [])

    def test_customer_never_sees_another_customers_messages(self):
        self.a.post(MESSAGES, {'body': 'Amina secret'}, format='json')
        self.d.post(MESSAGES, {'body': 'Daniel hello'}, format='json')
        bodies = [m['body'] for m in self.d.get(MESSAGES).data['results']]
        self.assertEqual(bodies, ['Daniel hello'])
        # a customer cannot ask for another conversation: the admin endpoints are closed to him
        cid = Conversation.objects.get(guest=self.amina).conversation_id
        self.assertEqual(self.d.get(admin_messages(cid)).status_code, 403)
        self.assertEqual(self.d.post(admin_messages(cid), {'body': 'x'}, format='json').status_code, 403)

    def test_body_validation(self):
        for bad in ('', '   ', '\n\t', None, 5, ['x']):
            r = self.a.post(MESSAGES, {'body': bad}, format='json')
            self.assertEqual(r.status_code, 400, repr(bad))
            self.assertEqual(r.data['code'], 'empty')
        r = self.a.post(MESSAGES, {'body': 'x' * (chat.MAX_BODY_LENGTH + 1)}, format='json')
        self.assertEqual((r.status_code, r.data['code']), (400, 'too_long'))
        self.assertEqual(self.a.post(MESSAGES, {'body': 'x' * chat.MAX_BODY_LENGTH}, format='json').status_code, 201)
        self.assertEqual(self.a.post(MESSAGES, {}, format='json').status_code, 400)

    def test_body_is_trimmed_and_control_characters_removed_but_new_lines_stay(self):
        r = self.a.post(MESSAGES, {'body': '  hello\x00 \x07there\nsecond line\u202e!  '}, format='json')
        self.assertEqual(r.data['body'], 'hello there\nsecond line!')

    def test_emoji_and_non_latin_text_are_kept(self):
        text = 'Сәлем! 你好 🏨 — late check-in?'
        r = self.a.post(MESSAGES, {'body': text}, format='json')
        self.assertEqual(r.data['body'], text)
        self.assertEqual(ChatMessage.objects.get().body, text)

    def test_html_is_stored_as_text(self):
        r = self.a.post(MESSAGES, {'body': '<script>alert(1)</script>'}, format='json')
        self.assertEqual(r.data['body'], '<script>alert(1)</script>')      # the frontend must show it as text

    def test_rate_limit(self):
        with mock.patch.object(chat, 'MESSAGES_PER_MINUTE', 3):
            codes = [self.a.post(MESSAGES, {'body': 'm%d' % i}, format='json').status_code for i in range(5)]
            self.assertEqual(codes, [201, 201, 201, 429, 429])
            self.assertEqual(self.d.post(MESSAGES, {'body': 'other person'}, format='json').status_code, 201)
        self.assertEqual(ChatMessage.objects.filter(sender=self.amina).count(), 3)

    def test_rate_limited_first_message_creates_no_conversation(self):
        with mock.patch.object(chat, 'MESSAGES_PER_MINUTE', 0):
            self.assertEqual(self.a.post(MESSAGES, {'body': 'hi'}, format='json').status_code, 429)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_staff_answers_from_the_inbox_and_has_no_customer_chat(self):
        self.assertEqual(self.stf.post(MESSAGES, {'body': 'hello'}, format='json').status_code, 403)
        self.assertEqual(self.stf.get(INBOX).status_code, 200)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_staff_replies_to_a_customer(self):
        self.a.post(MESSAGES, {'body': 'is breakfast included?'}, format='json')
        cid = Conversation.objects.get().conversation_id
        r = self.stf.post(admin_messages(cid), {'body': 'Yes, 7:00-10:30.'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.stf.post('/api/chat/admin/conversations/%d/read/' % cid).data, {'marked': 1})
        bodies = [m['body'] for m in self.a.get(MESSAGES).data['results']]
        self.assertIn('Yes, 7:00-10:30.', bodies)
        self.assertEqual(self.stf.get('/api/chat/unread/').data, {'role': 'admin', 'unread': 0})

    def test_admin_has_no_customer_chat(self):
        self.assertEqual(self.adm.post(MESSAGES, {'body': 'hi'}, format='json').status_code, 403)
        self.assertEqual(self.adm.get(MESSAGES).status_code, 403)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_visitor_and_blocked_account_are_refused(self):
        visitor = APIClient()
        for call in (lambda c: c.get(MESSAGES), lambda c: c.post(MESSAGES, {'body': 'x'}, format='json'),
                     lambda c: c.get(INBOX), lambda c: c.post('/api/chat/ticket/'), lambda c: c.get('/api/chat/unread/')):
            self.assertEqual(call(visitor).status_code, 401)
        blocked = self.client_for(self.guest('blocked@example.com', active=False))
        self.assertEqual(blocked.post(MESSAGES, {'body': 'x'}, format='json').status_code, 403)
        self.assertEqual(blocked.post('/api/chat/ticket/').status_code, 403)

    def test_bad_query_parameters(self):
        for params in ({'limit': 'abc'}, {'limit': 0}, {'limit': 101}, {'before': 'x'}, {'after': -1}):
            self.assertEqual(self.a.get(MESSAGES, params).status_code, 400, params)


class AdminChatTests(ChatTestBase):
    def start(self, client, text):
        return client.post(MESSAGES, {'body': text}, format='json').data

    def test_admin_replies_and_customer_sees_it(self):
        self.start(self.a, 'Is late check-in possible?')
        cid = Conversation.objects.get().conversation_id
        r = self.adm.post(admin_messages(cid), {'body': 'Yes, until 2 am.'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(r.data['from_customer'])
        self.assertEqual((r.data['sender_id'], r.data['sender_name']), (self.admin.guest_id, 'Mark Y.'))
        row = ChatMessage.objects.get(message_id=r.data['message_id'])
        self.assertEqual((row.sender_id, row.conversation_id, row.body), (self.admin.guest_id, cid, 'Yes, until 2 am.'))
        seen = self.a.get(MESSAGES).data['results']
        self.assertEqual([(m['body'], m['from_customer']) for m in seen],
                         [('Is late check-in possible?', True), ('Yes, until 2 am.', False)])

    def test_any_admin_can_answer_the_same_conversation(self):
        admin2 = self.guest('admin2@example.com', 'Second', 'Admin', 'admin')
        self.start(self.a, 'hi')
        cid = Conversation.objects.get().conversation_id
        self.adm.post(admin_messages(cid), {'body': 'from first'}, format='json')
        self.client_for(admin2).post(admin_messages(cid), {'body': 'from second'}, format='json')
        names = [m['sender_name'] for m in self.a.get(MESSAGES).data['results']]
        self.assertEqual(names, ['Amina S.', 'Mark Y.', 'Second A.'])

    def test_admin_cannot_start_a_chat_or_answer_an_unknown_one(self):
        r = self.adm.post(admin_messages(999), {'body': 'hello?'}, format='json')
        self.assertEqual((r.status_code, r.data['code']), (404, 'not_found'))
        self.assertEqual(self.adm.get(admin_messages(999)).status_code, 404)
        self.assertEqual(self.adm.post('/api/chat/admin/conversations/999/read/').status_code, 404)
        self.assertEqual(ChatMessage.objects.count(), 0)

    def test_admin_history_has_the_guest_and_pages(self):
        for i in range(1, 5):
            self.start(self.a, 'm%d' % i)
        cid = Conversation.objects.get().conversation_id
        data = self.adm.get(admin_messages(cid), {'limit': 2}).data
        self.assertEqual([m['body'] for m in data['results']], ['m3', 'm4'])
        self.assertTrue(data['has_more'])
        self.assertEqual(data['guest']['email'], 'amina@example.com')
        self.assertNotIn('password', data['guest'])

    def test_inbox_lists_conversations_newest_first_with_unread_and_preview(self):
        self.start(self.a, 'Amina first')
        self.start(self.d, 'Daniel asks about parking' + ' ...' * 60)
        self.start(self.a, 'Amina second')
        rows = self.adm.get(INBOX).data
        self.assertEqual(rows['count'], 2)
        self.assertEqual([r['guest']['first_name'] for r in rows['results']], ['Amina', 'Daniel'])
        amina, daniel = rows['results']
        self.assertEqual(amina['unread'], 2)
        self.assertEqual(amina['last_message']['preview'], 'Amina second')
        self.assertTrue(amina['last_message']['from_customer'])
        self.assertEqual(len(daniel['last_message']['preview']), 120)
        self.assertEqual(rows['unread_total'], 3)
        self.assertNotIn('password', amina['guest'])
        self.assertNotIn('phone', amina['guest'])

    def test_a_reply_moves_the_conversation_to_the_top_and_is_not_unread_for_the_admin(self):
        self.start(self.a, 'Amina')
        self.start(self.d, 'Daniel')
        cid = Conversation.objects.get(guest=self.amina).conversation_id
        self.adm.post(admin_messages(cid), {'body': 'Reply to Amina'}, format='json')
        rows = self.adm.get(INBOX).data['results']
        self.assertEqual([r['guest']['first_name'] for r in rows], ['Amina', 'Daniel'])
        self.assertEqual(rows[0]['unread'], 1)                                # her own question still unread
        self.assertFalse(rows[0]['last_message']['from_customer'])

    def test_inbox_search_and_unread_filter(self):
        self.start(self.a, 'Amina')
        self.start(self.d, 'Daniel')
        cid = Conversation.objects.get(guest=self.daniel).conversation_id
        self.adm.post(admin_messages(cid), {'body': 'ok'}, format='json')
        self.adm.post('/api/chat/admin/conversations/%d/read/' % cid)
        self.assertEqual([r['guest']['first_name'] for r in self.adm.get(INBOX, {'q': 'brooks'}).data['results']], ['Daniel'])
        self.assertEqual([r['guest']['first_name'] for r in self.adm.get(INBOX, {'q': 'AMINA@'}).data['results']], ['Amina'])
        self.assertEqual(self.adm.get(INBOX, {'q': 'nobody'}).data['results'], [])
        self.assertEqual([r['guest']['first_name'] for r in self.adm.get(INBOX, {'unread': 1}).data['results']], ['Amina'])

    def test_inbox_paging(self):
        for g in (self.amina, self.daniel):
            self.start(self.client_for(g), 'hi')
        page = self.adm.get(INBOX, {'limit': 1}).data
        self.assertEqual((len(page['results']), page['count'], page['has_more']), (1, 2, True))
        page2 = self.adm.get(INBOX, {'limit': 1, 'offset': 1}).data
        self.assertEqual((len(page2['results']), page2['has_more']), (1, False))

    def test_conversation_without_messages_is_not_listed(self):
        Conversation.objects.create(guest=self.amina)
        self.assertEqual(self.adm.get(INBOX).data['results'], [])

    def test_only_support_roles_may_use_the_inbox(self):
        self.start(self.a, 'hi')
        cid = Conversation.objects.get().conversation_id
        for c in (self.a,):
            self.assertEqual(c.get(INBOX).status_code, 403)
            self.assertEqual(c.get(admin_messages(cid)).status_code, 403)
            self.assertEqual(c.post('/api/chat/admin/conversations/%d/read/' % cid).status_code, 403)
        self.assertEqual(APIClient().get(INBOX).status_code, 401)

    def test_support_roles_setting_can_be_admin_only(self):
        self.start(self.a, 'hi')
        with mock.patch.object(chat, 'SUPPORT_ROLES', ('admin',)):
            from . import chat_api
            with mock.patch.object(chat_api.IsChatSupport, 'allowed', ('admin',)):
                self.assertEqual(self.stf.get(INBOX).status_code, 403)

    # ------------------------------------------------------------ read marks and badges

    def test_admin_marks_customer_messages_read(self):
        self.start(self.a, 'm1')
        self.start(self.a, 'm2')
        cid = Conversation.objects.get().conversation_id
        self.adm.post(admin_messages(cid), {'body': 'admin reply'}, format='json')
        r = self.adm.post('/api/chat/admin/conversations/%d/read/' % cid)
        self.assertEqual(r.data, {'marked': 2})
        self.assertEqual(ChatMessage.objects.filter(sender=self.amina, read_at__isnull=True).count(), 0)
        self.assertEqual(ChatMessage.objects.get(sender=self.admin).read_at, None)   # the customer has not read it
        self.assertEqual(self.adm.post('/api/chat/admin/conversations/%d/read/' % cid).data, {'marked': 0})
        self.assertEqual(self.adm.get('/api/chat/unread/').data, {'role': 'admin', 'unread': 0})

    def test_customer_marks_admin_messages_read(self):
        self.start(self.a, 'question')
        cid = Conversation.objects.get().conversation_id
        for t in ('a1', 'a2'):
            self.adm.post(admin_messages(cid), {'body': t}, format='json')
        self.assertEqual(self.a.get('/api/chat/unread/').data, {'role': 'customer', 'unread': 2})
        self.assertEqual(self.a.get('/api/chat/conversation/').data['unread'], 2)
        self.assertEqual(self.a.post('/api/chat/read/').data, {'marked': 2})
        self.assertEqual(self.a.get('/api/chat/unread/').data['unread'], 0)
        # reading does not touch the customer's own message
        self.assertIsNone(ChatMessage.objects.get(sender=self.amina).read_at)

    def test_read_up_to_a_message(self):
        ids = [self.start(self.a, 'm%d' % i)['message_id'] for i in range(3)]
        cid = Conversation.objects.get().conversation_id
        self.assertEqual(self.adm.post('/api/chat/admin/conversations/%d/read/?up_to=%d' % (cid, ids[1])).data, {'marked': 2})
        self.assertEqual(ChatMessage.objects.filter(read_at__isnull=True).count(), 1)

    def test_unread_is_counted_per_customer(self):
        self.start(self.a, 'hi')
        cid = Conversation.objects.get().conversation_id
        self.adm.post(admin_messages(cid), {'body': 'to Amina'}, format='json')
        self.assertEqual(self.d.get('/api/chat/unread/').data['unread'], 0)
        self.assertEqual(self.d.post('/api/chat/read/').data, {'marked': 0})       # no conversation yet: no error

    def test_read_of_a_message_hides_nothing_and_history_shows_read_at(self):
        self.start(self.a, 'hi')
        cid = Conversation.objects.get().conversation_id
        self.adm.post('/api/chat/admin/conversations/%d/read/' % cid)
        self.assertIsNotNone(self.a.get(MESSAGES).data['results'][0]['read_at'])


class TicketTests(ChatTestBase):
    def test_ticket_belongs_to_the_account_and_expires(self):
        data = self.a.post('/api/chat/ticket/').data
        self.assertEqual(data['expires_in'], 60)
        self.assertEqual(chat.read_ticket(data['ticket']), self.amina.guest_id)
        self.assertEqual(chat.read_ticket(self.adm.post('/api/chat/ticket/').data['ticket']), self.admin.guest_id)
        with mock.patch.object(chat, 'TICKET_MAX_AGE', -1):
            self.assertIsNone(chat.read_ticket(data['ticket']))

    def test_forged_tickets_and_login_tokens_are_not_tickets(self):
        self.assertIsNone(chat.read_ticket(''))
        self.assertIsNone(chat.read_ticket('garbage'))
        self.assertIsNone(chat.read_ticket(make_token(self.amina)))          # the 7-day login token is not a ticket
        good = chat.make_ticket(self.amina)
        self.assertIsNone(chat.read_ticket(good[:-3] + 'abc'))


class DatabaseRulesTests(ChatTestBase):
    def test_the_database_refuses_an_empty_or_too_long_body(self):
        conv = Conversation.objects.create(guest=self.amina)
        for body in ('', 'x' * (chat.MAX_BODY_LENGTH + 1)):
            with self.assertRaises(IntegrityError), transaction.atomic():
                ChatMessage.objects.create(conversation=conv, sender=self.amina, body=body)

    def test_one_conversation_per_customer(self):
        Conversation.objects.create(guest=self.amina)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Conversation.objects.create(guest=self.amina)

    def test_deleting_a_guest_deletes_the_conversation_and_messages(self):
        self.a.post(MESSAGES, {'body': 'bye'}, format='json')
        self.assertEqual(ChatMessage.objects.count(), 1)
        self.amina.delete()
        self.assertEqual((Conversation.objects.count(), ChatMessage.objects.count()), (0, 0))
