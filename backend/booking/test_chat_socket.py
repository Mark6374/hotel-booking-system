"""Chat WebSocket (real-time delivery). Run (no MySQL needed):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_chat_socket
"""
import asyncio

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from channels.testing import WebsocketCommunicator

from . import chat
from .chat import ChatMessage, Conversation
from .roles import GuestRole
from .routing import websocket_urlpatterns
from .test_chat import MESSAGES, ChatTestBase, admin_messages

ORIGIN = (b'origin', b'http://localhost:5173')


def _app():
    from hotel_api.asgi import application
    return application


class SocketTests(ChatTestBase):
    def setUp(self):
        super().setUp()
        self.open = []

    # ------------------------------------------------------------ helpers

    async def connect(self, guest, expect_ready=True, ticket=None):
        ticket = ticket if ticket is not None else chat.make_ticket(guest)
        comm = WebsocketCommunicator(_app(), '/ws/chat/?ticket=' + ticket, headers=[ORIGIN])
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        self.open.append(comm)
        if expect_ready:
            ready = await comm.receive_json_from(timeout=3)
            self.assertEqual(ready['type'], 'ready')
            comm.ready = ready
        return comm

    async def close_all(self):
        for comm in self.open:
            await comm.disconnect()
        self.open = []

    async def quiet(self, comm):
        self.assertTrue(await comm.receive_nothing(timeout=0.3), 'received a frame that was not expected')

    # ------------------------------------------------------------ connecting

    async def test_bad_tickets_are_closed_with_4401(self):
        for ticket in ('', 'garbage', chat.make_ticket(self.amina)[:-2] + 'xx'):
            comm = WebsocketCommunicator(_app(), '/ws/chat/?ticket=' + ticket, headers=[ORIGIN])
            await comm.connect()
            out = await comm.receive_output(timeout=3)
            self.assertEqual((out['type'], out['code']), ('websocket.close', 4401), ticket)
        no_query = WebsocketCommunicator(_app(), '/ws/chat/', headers=[ORIGIN])
        await no_query.connect()
        self.assertEqual((await no_query.receive_output(timeout=3))['code'], 4401)

    async def test_login_token_cannot_be_used_as_ticket(self):
        from .auth import make_token
        comm = WebsocketCommunicator(_app(), '/ws/chat/?ticket=' + make_token(self.amina), headers=[ORIGIN])
        await comm.connect()
        self.assertEqual((await comm.receive_output(timeout=3))['code'], 4401)

    async def test_blocked_account_is_closed_with_4403(self):
        blocked = await sync_to_async(self.guest)('blocked@example.com', active=False)
        comm = WebsocketCommunicator(_app(), '/ws/chat/?ticket=' + chat.make_ticket(blocked), headers=[ORIGIN])
        await comm.connect()
        self.assertEqual((await comm.receive_output(timeout=3))['code'], 4403)

    async def test_ready_for_customer_and_admin(self):
        c = await self.connect(self.amina)
        self.assertEqual(c.ready, {'type': 'ready', 'role': 'customer', 'guest_id': self.amina.guest_id,
                                   'conversation_id': None, 'unread': 0})
        a = await self.connect(self.admin)
        self.assertEqual(a.ready, {'type': 'ready', 'role': 'admin', 'guest_id': self.admin.guest_id, 'unread': 0})
        await self.close_all()

    async def test_origin_of_another_site_is_refused(self):
        app = OriginValidator(URLRouter(websocket_urlpatterns), ['http://localhost:5173', 'hotel.example.com'])
        ticket = chat.make_ticket(self.amina)
        for origin, ok in ((b'http://localhost:5173', True), (b'https://hotel.example.com', True),
                           (b'https://evil.example', False), (b'http://localhost:9999', False)):
            comm = WebsocketCommunicator(app, '/ws/chat/?ticket=' + ticket, headers=[(b'origin', origin)])
            connected, _ = await comm.connect()
            self.assertEqual(connected, ok, origin)
            if ok:
                await comm.disconnect()

    async def test_ping(self):
        c = await self.connect(self.amina)
        await c.send_json_to({'type': 'ping'})
        self.assertEqual(await c.receive_json_from(timeout=3), {'type': 'pong'})
        await self.close_all()

    # ------------------------------------------------------------ real-time delivery

    async def test_customer_message_reaches_the_admin_instantly_and_is_stored(self):
        admin = await self.connect(self.admin)
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'Is late check-in possible?', 'client_id': 'tmp-1'})

        at_admin = await admin.receive_json_from(timeout=3)
        self.assertEqual(at_admin['type'], 'message.new')
        self.assertEqual(at_admin['message']['body'], 'Is late check-in possible?')
        self.assertTrue(at_admin['message']['from_customer'])
        self.assertEqual(at_admin['conversation']['guest']['email'], 'amina@example.com')
        self.assertEqual(at_admin['conversation']['unread'], {'for_admin': 1, 'for_customer': 0})

        echo = await cust.receive_json_from(timeout=3)                     # the sender gets the saved message back
        self.assertEqual(echo['message']['message_id'], at_admin['message']['message_id'])
        self.assertEqual(echo['message']['client_id'], 'tmp-1')

        row = await ChatMessage.objects.aget(message_id=at_admin['message']['message_id'])
        self.assertEqual((row.body, row.sender_id), ('Is late check-in possible?', self.amina.guest_id))
        await self.close_all()

    async def test_admin_reply_reaches_the_customer_instantly_and_is_stored(self):
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'Hello'})
        first = await cust.receive_json_from(timeout=3)
        cid = first['message']['conversation_id']

        admin = await self.connect(self.admin)
        await admin.send_json_to({'type': 'message.send', 'conversation_id': cid, 'body': 'Welcome, Amina!'})

        got = await cust.receive_json_from(timeout=3)
        self.assertEqual(got['type'], 'message.new')
        self.assertEqual((got['message']['body'], got['message']['from_customer']), ('Welcome, Amina!', False))
        self.assertEqual(got['message']['sender_name'], 'Mark Y.')
        self.assertEqual(got['conversation']['unread']['for_customer'], 1)
        echo = await admin.receive_json_from(timeout=3)
        self.assertEqual(echo['message']['message_id'], got['message']['message_id'])
        row = await ChatMessage.objects.aget(message_id=got['message']['message_id'])
        self.assertEqual((row.sender_id, row.conversation_id), (self.admin.guest_id, cid))
        await self.close_all()

    async def test_a_conversation_between_two_people_in_both_directions(self):
        admin, cust = await self.connect(self.admin), await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'one'})
        cid = (await cust.receive_json_from(timeout=3))['message']['conversation_id']
        await admin.receive_json_from(timeout=3)
        for i, text in enumerate(('two', 'three', 'four')):
            sender, conv = (admin, cid) if i % 2 == 0 else (cust, None)
            await sender.send_json_to({'type': 'message.send', 'body': text, 'conversation_id': conv})
            await admin.receive_json_from(timeout=3)
            await cust.receive_json_from(timeout=3)
        bodies = [m.body async for m in ChatMessage.objects.order_by('message_id')]
        self.assertEqual(bodies, ['one', 'two', 'three', 'four'])
        await self.close_all()

    async def test_a_customer_only_gets_his_own_conversation(self):
        amina, daniel = await self.connect(self.amina), await self.connect(self.daniel)
        await amina.send_json_to({'type': 'message.send', 'body': 'Amina private'})
        await amina.receive_json_from(timeout=3)
        await self.quiet(daniel)                                            # Daniel hears nothing
        await daniel.send_json_to({'type': 'message.send', 'body': 'Daniel private'})
        await daniel.receive_json_from(timeout=3)
        await self.quiet(amina)
        await self.close_all()

    async def test_every_admin_sees_every_conversation(self):
        admin2 = await sync_to_async(self.guest)('admin2@example.com', 'Second', 'Admin', 'admin')
        a1, a2 = await self.connect(self.admin), await self.connect(admin2)
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'hi'})
        for admin in (a1, a2):
            self.assertEqual((await admin.receive_json_from(timeout=3))['message']['body'], 'hi')
        await self.close_all()

    async def test_same_account_on_two_devices_stays_in_sync(self):
        phone, laptop = await self.connect(self.amina), await self.connect(self.amina)
        await phone.send_json_to({'type': 'message.send', 'body': 'from my phone'})
        for comm in (phone, laptop):
            self.assertEqual((await comm.receive_json_from(timeout=3))['message']['body'], 'from my phone')
        await self.close_all()

    async def test_rest_post_is_pushed_to_open_sockets(self):
        admin = await self.connect(self.admin)
        r = await sync_to_async(self.a.post)(MESSAGES, {'body': 'sent over HTTP'}, format='json')
        self.assertEqual(r.status_code, 201)
        got = await admin.receive_json_from(timeout=3)
        self.assertEqual(got['message']['body'], 'sent over HTTP')
        cid = got['message']['conversation_id']
        cust = await self.connect(self.amina)
        r = await sync_to_async(self.adm.post)(admin_messages(cid), {'body': 'answer over HTTP'}, format='json')
        self.assertEqual(r.status_code, 201)
        await admin.receive_json_from(timeout=3)
        self.assertEqual((await cust.receive_json_from(timeout=3))['message']['body'], 'answer over HTTP')
        await self.close_all()

    async def test_offline_customer_finds_the_reply_in_the_history(self):
        await sync_to_async(self.a.post)(MESSAGES, {'body': 'question'}, format='json')
        cid = (await Conversation.objects.aget()).conversation_id
        await sync_to_async(self.adm.post)(admin_messages(cid), {'body': 'answer while you were away'}, format='json')
        cust = await self.connect(self.amina)
        self.assertEqual(cust.ready['unread'], 1)
        history = (await sync_to_async(self.a.get)(MESSAGES)).data['results']
        self.assertEqual([m['body'] for m in history], ['question', 'answer while you were away'])
        await self.close_all()

    # ------------------------------------------------------------ read receipts

    async def test_admin_reading_tells_the_customer(self):
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'hello'})
        sent = await cust.receive_json_from(timeout=3)
        admin = await self.connect(self.admin)
        await admin.send_json_to({'type': 'read', 'conversation_id': sent['message']['conversation_id']})
        for comm in (cust, admin):
            ev = await comm.receive_json_from(timeout=3)
            self.assertEqual((ev['type'], ev['reader'], ev['count'], ev['up_to']),
                             ('messages.read', 'admin', 1, sent['message']['message_id']))
        self.assertIsNotNone((await ChatMessage.objects.aget()).read_at)
        await admin.send_json_to({'type': 'read', 'conversation_id': sent['message']['conversation_id']})
        await self.quiet(cust)                                              # nothing new to read: no event
        await self.close_all()

    async def test_customer_reading_tells_the_admin(self):
        await sync_to_async(self.a.post)(MESSAGES, {'body': 'q'}, format='json')
        cid = (await Conversation.objects.aget()).conversation_id
        await sync_to_async(self.adm.post)(admin_messages(cid), {'body': 'a'}, format='json')
        admin, cust = await self.connect(self.admin), await self.connect(self.amina)
        await cust.send_json_to({'type': 'read'})
        ev = await admin.receive_json_from(timeout=3)
        self.assertEqual((ev['type'], ev['reader'], ev['conversation_id']), ('messages.read', 'customer', cid))
        self.assertEqual((await ChatMessage.objects.aget(sender=self.admin)).read_at is not None, True)
        self.assertIsNone((await ChatMessage.objects.aget(sender=self.amina)).read_at)
        await self.close_all()

    # ------------------------------------------------------------ rules over the socket

    async def test_errors_are_answered_on_the_same_socket(self):
        cust, admin = await self.connect(self.amina), await self.connect(self.admin)
        cases = [
            (cust, {'type': 'message.send', 'body': '   ', 'client_id': 'x1'}, 'empty'),
            (cust, {'type': 'message.send', 'body': 'x' * 2001}, 'too_long'),
            (cust, {'type': 'message.send'}, 'empty'),
            (cust, {'type': 'nope'}, 'unknown_type'),
            (admin, {'type': 'message.send', 'body': 'hi'}, 'conversation_required'),
            (admin, {'type': 'message.send', 'body': 'hi', 'conversation_id': 999}, 'not_found'),
            (admin, {'type': 'message.send', 'body': 'hi', 'conversation_id': 'abc'}, 'conversation_required'),
            (admin, {'type': 'read', 'conversation_id': 999}, 'not_found'),
        ]
        for comm, frame, code in cases:
            await comm.send_json_to(frame)
            err = await comm.receive_json_from(timeout=3)
            self.assertEqual((err['type'], err['code']), ('error', code), frame)
        await cust.send_to(text_data='this is not json')
        self.assertEqual((await cust.receive_json_from(timeout=3))['code'], 'bad_message')
        await cust.send_to(text_data='[1, 2]')
        self.assertEqual((await cust.receive_json_from(timeout=3))['code'], 'bad_message')
        self.assertEqual(await ChatMessage.objects.acount(), 0)
        await self.close_all()

    async def test_error_echoes_the_client_id(self):
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': '', 'client_id': 'tmp-9'})
        self.assertEqual((await cust.receive_json_from(timeout=3))['client_id'], 'tmp-9')
        await self.close_all()

    async def test_customer_cannot_write_into_another_conversation(self):
        await sync_to_async(self.d.post)(MESSAGES, {'body': 'Daniel'}, format='json')
        daniels = (await Conversation.objects.aget(guest=self.daniel)).conversation_id
        cust = await self.connect(self.amina)
        await cust.send_json_to({'type': 'message.send', 'body': 'sneaky', 'conversation_id': daniels})
        got = await cust.receive_json_from(timeout=3)
        self.assertNotEqual(got['message']['conversation_id'], daniels)     # the field is ignored for customers
        self.assertEqual(await ChatMessage.objects.filter(conversation_id=daniels).acount(), 1)
        await cust.send_json_to({'type': 'read', 'conversation_id': daniels})   # nor mark Daniel's messages read
        await self.quiet(cust)
        await self.close_all()

    async def test_rate_limit_over_the_socket(self):
        from unittest import mock
        cust = await self.connect(self.amina)
        with mock.patch.object(chat, 'MESSAGES_PER_MINUTE', 2):
            codes = []
            for i in range(3):
                await cust.send_json_to({'type': 'message.send', 'body': 'm%d' % i})
                codes.append((await cust.receive_json_from(timeout=3)).get('code', 'ok'))
        self.assertEqual(codes, ['ok', 'ok', 'rate_limited'])
        await self.close_all()

    async def test_blocking_an_account_stops_its_open_socket(self):
        cust = await self.connect(self.amina)
        await GuestRole.objects.aupdate_or_create(guest_id=self.amina.guest_id,
                                                  defaults={'role': 'guest', 'is_active': False})
        await cust.send_json_to({'type': 'message.send', 'body': 'still here?'})
        out = await cust.receive_output(timeout=3)
        self.assertEqual((out['type'], out['code']), ('websocket.close', 4403))
        self.assertEqual(await ChatMessage.objects.acount(), 0)

    async def test_an_admin_who_loses_the_role_is_disconnected_at_once(self):
        admin = await self.connect(self.admin)
        boss = await sync_to_async(self.guest)('boss@example.com', 'Big', 'Boss', 'admin')
        boss_client = self.client_for(boss)
        r = await sync_to_async(boss_client.patch)('/api/admin/accounts/%d/' % self.admin.guest_id,
                                                   {'role': 'guest'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        out = await admin.receive_output(timeout=3)
        self.assertEqual((out['type'], out['code']), ('websocket.close', 4403))

    async def test_demoted_admin_cannot_send_even_before_the_kick_arrives(self):
        admin = await self.connect(self.admin)
        await GuestRole.objects.filter(guest_id=self.admin.guest_id).aupdate(role='guest')
        await admin.send_json_to({'type': 'message.send', 'conversation_id': 1, 'body': 'x'})
        out = await admin.receive_output(timeout=3)
        self.assertEqual(out['code'], 4403)

    async def test_the_socket_survives_an_unrelated_disconnect(self):
        a, b = await self.connect(self.admin), await self.connect(self.admin)
        await b.disconnect()
        self.open.remove(b)
        await sync_to_async(self.a.post)(MESSAGES, {'body': 'still delivered'}, format='json')
        self.assertEqual((await a.receive_json_from(timeout=3))['message']['body'], 'still delivered')
        await self.close_all()
