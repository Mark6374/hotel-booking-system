"""Chat between a customer and the admin: models and the rules shared by the REST API (chat_api.py)
and the WebSocket (consumers.py).

Kept in its own module, like roles.py and reviews.py, so the shared models.py stays as it is.
Tables: db/09_chat.sql.  Docs: PHOTOS_AND_CHAT_API.md.

How it works
 * Every customer has ONE conversation with the hotel (created by the first message). Every admin sees
   all conversations and answers in the customer's conversation.
 * A message is first SAVED in the database; only then it is pushed to the people who are online.
   If the push fails (or somebody is offline) nothing is lost: the message is in the history.
 * Who gets a push: the customer's own sockets (group chat.guest.<id>) and every admin socket
   (group chat.admins).
 * "From the customer?" is derived: message.sender_id == conversation.guest_id.
"""
import datetime
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core import signing
from django.core.cache import cache
from django.db import IntegrityError, models
from django.db.models import Count, F, Q
from django.db.models.functions import Length
from django.db.models.lookups import GreaterThanOrEqual, LessThanOrEqual

logger = logging.getLogger(__name__)

# Who answers the customers: the front desk (staff) and the admins share one inbox.
SUPPORT_ROLES = ('staff', 'admin')

MAX_BODY_LENGTH = 2000
MESSAGES_PER_MINUTE = 30            # per account; REST and WebSocket share the same counter
PAGE_SIZE = 50
MAX_PAGE_SIZE = 100

ADMIN_GROUP = 'chat.admins'


def guest_group(guest_id):
    return 'chat.guest.%d' % guest_id


def now():
    return datetime.datetime.now().replace(microsecond=0)   # MySQL DATETIME has no fractions


class ChatError(Exception):
    """A problem the user should see. `code` is stable for the frontend, `message` is for people."""

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ---------------------------------------------------------------- models

class Conversation(models.Model):
    conversation_id = models.AutoField(primary_key=True)
    guest = models.OneToOneField('booking.Guest', db_column='guest_id', on_delete=models.CASCADE,
                                 related_name='chat_conversation')
    created_at = models.DateTimeField(default=now)

    class Meta:
        managed = False
        db_table = 'chat_conversation'

    def __str__(self):
        return 'Chat with %s' % self.guest


class ChatMessage(models.Model):
    message_id = models.AutoField(primary_key=True)
    conversation = models.ForeignKey(Conversation, db_column='conversation_id', on_delete=models.CASCADE,
                                     related_name='messages')
    sender = models.ForeignKey('booking.Guest', db_column='sender_id', on_delete=models.CASCADE,
                               related_name='+')
    body = models.CharField(max_length=MAX_BODY_LENGTH)
    created_at = models.DateTimeField(default=now)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'chat_message'
        ordering = ('message_id',)
        # Same rule as db/09_chat.sql (the tests build the table from this Meta).
        constraints = [
            models.CheckConstraint(
                condition=Q(GreaterThanOrEqual(Length('body'), 1), LessThanOrEqual(Length('body'), MAX_BODY_LENGTH)),
                name='chk_chat_message_body'),
        ]

    def __str__(self):
        return 'Message #%s' % self.message_id


# ---------------------------------------------------------------- small helpers

def iso(value):
    """ISO time WITH the UTC offset. The database keeps the hotel's local time without a zone, and a browser in
    another country would read a bare '10:05' as its own time."""
    return value.astimezone().isoformat() if value else None


def clean_body(raw):
    """Trim, drop control characters (new lines and tabs stay) and check the length."""
    if not isinstance(raw, str):
        raise ChatError('empty', 'Write a message first.')
    body = ''.join(ch for ch in raw.strip() if ch in '\n\t' or ch.isprintable())
    if not body:
        raise ChatError('empty', 'Write a message first.')
    if len(body) > MAX_BODY_LENGTH:
        raise ChatError('too_long', 'A message can have at most %d characters.' % MAX_BODY_LENGTH)
    return body


def check_rate(guest_id):
    """At most MESSAGES_PER_MINUTE messages per account (stops a script that floods the admins).
    Uses Django's cache; with several server processes use a shared cache (Redis) to count exactly."""
    key = 'chat:rate:%d' % guest_id
    cache.add(key, 0, 60)
    try:
        count = cache.incr(key)
    except ValueError:                    # the key expired between add and incr
        cache.set(key, 1, 60)
        count = 1
    if count > MESSAGES_PER_MINUTE:
        raise ChatError('rate_limited', 'You are sending messages too fast. Wait a minute.', 429)


# ---------------------------------------------------------------- WebSocket tickets
# A browser cannot send an Authorization header when it opens a WebSocket. The page asks the REST API
# (POST /api/chat/ticket/, normal Bearer token) for a ticket that is valid for one minute and opens
# the socket with it. The long-lived login token never appears in a URL or a server log.

TICKET_SALT = 'hotel_api.chat.ticket'
TICKET_MAX_AGE = 60


def make_ticket(guest):
    return signing.dumps({'gid': guest.guest_id}, salt=TICKET_SALT)


def read_ticket(ticket):
    """guest_id from a ticket, or None when it is missing, forged or older than a minute."""
    try:
        return signing.loads(ticket, salt=TICKET_SALT, max_age=TICKET_MAX_AGE)['gid']
    except (signing.BadSignature, KeyError, TypeError):
        return None


# ---------------------------------------------------------------- payloads (what the frontend receives)

def _public_name(guest):
    from .reviews import public_name
    return public_name(guest)


def _photo_of(guest):
    from .photos import photo_url_for
    return photo_url_for(guest)


def message_payload(message, conversation, sender, sender_photo=None, client_id=None):
    """One message. sender_name is 'Amina S.' (first name + initial) for everybody."""
    data = {
        'message_id': message.message_id,
        'conversation_id': message.conversation_id,
        'sender_id': message.sender_id,
        'from_customer': message.sender_id == conversation.guest_id,
        'sender_name': _public_name(sender),
        'sender_photo_url': sender_photo,
        'body': message.body,
        'created_at': iso(message.created_at),
        'read_at': iso(message.read_at),
    }
    if client_id is not None:
        data['client_id'] = client_id
    return data


def guest_payload(guest, photo=None):
    return {'guest_id': guest.guest_id, 'first_name': guest.first_name, 'last_name': guest.last_name,
            'email': guest.email, 'photo_url': photo}


def unread_counts(conversation_id, guest_id):
    """{'for_admin': customer messages no admin read yet, 'for_customer': admin messages the customer did not read}"""
    row = ChatMessage.objects.filter(conversation_id=conversation_id).aggregate(
        for_admin=Count('message_id', filter=Q(read_at__isnull=True, sender_id=guest_id)),
        for_customer=Count('message_id', filter=Q(read_at__isnull=True) & ~Q(sender_id=guest_id)))
    return {'for_admin': row['for_admin'], 'for_customer': row['for_customer']}


def total_unread_for_admin():
    return ChatMessage.objects.filter(read_at__isnull=True, sender_id=F('conversation__guest_id')).count()


def total_unread_for_customer(guest_id):
    return ChatMessage.objects.filter(conversation__guest_id=guest_id, read_at__isnull=True) \
        .exclude(sender_id=guest_id).count()


# ---------------------------------------------------------------- saving

def get_or_create_conversation(guest):
    conversation = Conversation.objects.filter(guest_id=guest.guest_id).first()
    if conversation is None:
        try:
            conversation = Conversation.objects.create(guest_id=guest.guest_id)
        except IntegrityError:            # two first messages at the same moment: the other one won
            conversation = Conversation.objects.get(guest_id=guest.guest_id)
    return conversation


def save_message(sender, is_support, body, conversation_id=None, client_id=None):
    """Checks the rules, SAVES the message and returns the payload to push.

    customer (is_support False): writes in his own conversation (created if this is the first message).
    support (is_support True): must name an existing conversation (admins reply, they do not start chats).
    Raises ChatError. Does not push anything: see publish()."""
    body = clean_body(body)
    if is_support:
        if conversation_id is None:
            raise ChatError('conversation_required', 'Say which conversation you are answering.')
        conversation = Conversation.objects.select_related('guest').filter(pk=conversation_id).first()
        if conversation is None:
            raise ChatError('not_found', 'Conversation not found.', 404)
        check_rate(sender.guest_id)
    else:
        check_rate(sender.guest_id)       # before the conversation is created, so a flood makes no rows
        conversation = get_or_create_conversation(sender)
    message = ChatMessage.objects.create(conversation=conversation, sender=sender, body=body, created_at=now())
    if client_id is not None:
        client_id = str(client_id)[:64]
    guest = conversation.guest if is_support else sender
    return {
        'type': 'message.new',
        'message': message_payload(message, conversation, sender, _photo_of(sender), client_id),
        'conversation': {'conversation_id': conversation.conversation_id,
                         'guest': guest_payload(guest, _photo_of(guest)),
                         'unread': unread_counts(conversation.conversation_id, conversation.guest_id)},
    }


def mark_read(conversation, reader_is_support, up_to=None):
    """The reader opened the conversation: his unread messages get read_at. Returns the 'messages.read'
    payload to push, or None when nothing changed."""
    # an admin reads what the customer wrote; the customer reads what anybody else wrote
    incoming = Q(sender_id=conversation.guest_id) if reader_is_support else ~Q(sender_id=conversation.guest_id)
    qs = ChatMessage.objects.filter(incoming, conversation=conversation, read_at__isnull=True)
    if up_to is not None:
        qs = qs.filter(message_id__lte=up_to)
    ids = list(qs.values_list('message_id', flat=True))
    if not ids:
        return None
    stamp = now()
    ChatMessage.objects.filter(message_id__in=ids).update(read_at=stamp)
    return {'type': 'messages.read', 'conversation_id': conversation.conversation_id,
            'reader': 'admin' if reader_is_support else 'customer',
            'up_to': max(ids), 'count': len(ids), 'read_at': iso(stamp)}


# ---------------------------------------------------------------- pushing

async def publish(guest_id, payload):
    """Push to the customer's sockets and to every admin socket."""
    layer = get_channel_layer()
    if layer is None:
        return
    event = {'type': 'chat.event', 'payload': payload}
    for group in (guest_group(guest_id), ADMIN_GROUP):
        await layer.group_send(group, event)


def publish_sync(guest_id, payload):
    """For the REST views. The message is already saved, so a push problem (for example Redis is down)
    is logged and does not turn a saved message into an error."""
    try:
        async_to_sync(publish)(guest_id, payload)
    except Exception:
        logger.exception('Chat push failed (the message is saved)')


def kick_sync(guest_id):
    """Close the open chat sockets of an account (its role changed, it was blocked or its login removed),
    so a connection never keeps rights that the account no longer has. They reconnect with a new ticket."""
    try:
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.group_send)('chat.account.%d' % guest_id, {'type': 'chat.kick'})
    except Exception:
        logger.exception('Chat kick failed')
