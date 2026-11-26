"""The chat WebSocket: ws(s)://<host>/ws/chat/?ticket=<ticket from POST /api/chat/ticket/>

Messages are JSON text frames. Full description: PHOTOS_AND_CHAT_API.md.

  client -> server   {"type": "message.send", "body": "...", "conversation_id": 7, "client_id": "abc"}
                         (conversation_id: admins only; the customer always writes in his own conversation)
                     {"type": "read", "conversation_id": 7, "up_to": 123}      (conversation_id: admins only; up_to optional)
                     {"type": "ping"}
  server -> client   {"type": "ready", ...}            right after the connection is accepted
                     {"type": "message.new", ...}      a saved message (also the echo of your own)
                     {"type": "messages.read", ...}    the other side has read messages
                     {"type": "error", "code", "detail"}
                     {"type": "pong"}
  close codes        4401 missing, wrong or expired ticket    4403 account blocked or removed
"""
import json
import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from . import chat
from .chat import ChatError, Conversation
from .models import Guest
from .roles import role_info

logger = logging.getLogger(__name__)

CLOSE_BAD_TICKET = 4401
CLOSE_FORBIDDEN = 4403


def account_group(guest_id):
    return 'chat.account.%d' % guest_id


@database_sync_to_async
def _load_account(guest_id):
    """(guest, is_support, is_active) or None when the account does not exist."""
    guest = Guest.objects.filter(pk=guest_id).first()
    if guest is None:
        return None
    role, active = role_info(guest)
    return guest, role in chat.SUPPORT_ROLES, active


@database_sync_to_async
def _ready_payload(guest, is_support):
    if is_support:
        return {'type': 'ready', 'role': 'admin', 'guest_id': guest.guest_id,
                'unread': chat.total_unread_for_admin()}
    conversation = Conversation.objects.filter(guest_id=guest.guest_id).first()
    return {'type': 'ready', 'role': 'customer', 'guest_id': guest.guest_id,
            'conversation_id': conversation.conversation_id if conversation else None,
            'unread': chat.total_unread_for_customer(guest.guest_id)}


@database_sync_to_async
def _mark_read(guest, is_support, conversation_id, up_to):
    """Returns (guest_id of the conversation, payload or None)."""
    if is_support:
        conversation = Conversation.objects.filter(pk=conversation_id).first()
    else:
        conversation = Conversation.objects.filter(guest_id=guest.guest_id).first()
    if conversation is None:
        raise ChatError('not_found', 'Conversation not found.', 404)
    return conversation.guest_id, chat.mark_read(conversation, is_support, up_to)


def _int_or_none(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class ChatConsumer(AsyncWebsocketConsumer):
    guest = None
    is_support = False
    joined = ()

    # ------------------------------------------------------------ connection

    async def connect(self):
        # Accept first, so a bad ticket can be answered with our own close code (4401) that the frontend
        # can tell apart from "the network is down". Nothing is sent or joined before the ticket is checked.
        await self.accept()
        ticket = parse_qs(self.scope.get('query_string', b'').decode()).get('ticket', [''])[0]
        guest_id = chat.read_ticket(ticket)
        account = await _load_account(guest_id) if guest_id is not None else None
        if account is None:
            await self.close(code=CLOSE_BAD_TICKET)
            return
        guest, is_support, active = account
        if not active:
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.guest, self.is_support = guest, is_support
        self.joined = (account_group(guest.guest_id),
                       chat.ADMIN_GROUP if is_support else chat.guest_group(guest.guest_id))
        for group in self.joined:
            await self.channel_layer.group_add(group, self.channel_name)
        await self._send(await _ready_payload(guest, is_support))

    async def disconnect(self, code):
        for group in self.joined:
            await self.channel_layer.group_discard(group, self.channel_name)

    # ------------------------------------------------------------ frames from the browser

    async def receive(self, text_data=None, bytes_data=None):
        if self.guest is None:
            return
        try:
            data = json.loads(text_data or '')
        except ValueError:
            data = None
        if not isinstance(data, dict):
            await self._error('bad_message', 'Send a JSON object with a "type".')
            return
        kind = data.get('type')
        if kind == 'ping':
            await self._send({'type': 'pong'})
        elif kind == 'message.send':
            await self._on_send(data)
        elif kind == 'read':
            await self._on_read(data)
        else:
            await self._error('unknown_type', 'Unknown message type.')

    async def _still_allowed(self):
        """Blocked or removed while connected: end the connection."""
        account = await _load_account(self.guest.guest_id)
        if account is None or not account[2] or account[1] != self.is_support:
            await self.close(code=CLOSE_FORBIDDEN)
            return False
        return True

    async def _on_send(self, data):
        if not await self._still_allowed():
            return
        conversation_id = _int_or_none(data.get('conversation_id'))
        try:
            payload = await database_sync_to_async(chat.save_message)(
                self.guest, self.is_support, data.get('body'), conversation_id, data.get('client_id'))
        except ChatError as e:
            await self._error(e.code, e.message, client_id=data.get('client_id'))
            return
        try:
            await chat.publish(payload['conversation']['guest']['guest_id'], payload)
        except Exception:
            logger.exception('Chat push failed (the message is saved)')
            await self._error('push_failed', 'Your message was saved but could not be delivered live.',
                              client_id=data.get('client_id'))

    async def _on_read(self, data):
        if not await self._still_allowed():
            return
        try:
            guest_id, payload = await _mark_read(self.guest, self.is_support,
                                                 _int_or_none(data.get('conversation_id')),
                                                 _int_or_none(data.get('up_to')))
        except ChatError as e:
            await self._error(e.code, e.message)
            return
        if payload:
            await chat.publish(guest_id, payload)

    # ------------------------------------------------------------ events from the channel layer

    async def chat_event(self, event):
        await self._send(event['payload'])

    async def chat_kick(self, event):
        """Role changed, account blocked or login removed: the connection must not keep old rights."""
        await self.close(code=CLOSE_FORBIDDEN)

    # ------------------------------------------------------------ helpers

    async def _send(self, payload):
        await self.send(text_data=json.dumps(payload))

    async def _error(self, code, detail, **extra):
        await self._send({'type': 'error', 'code': code, 'detail': detail,
                          **{k: v for k, v in extra.items() if v is not None}})
