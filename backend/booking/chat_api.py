"""Chat REST API for the React frontend. See PHOTOS_AND_CHAT_API.md.

The WebSocket (consumers.py) is the fast way; these endpoints give the history, the first load, the
unread badge, the ticket for the socket, and a plain-HTTP way to send (they push to the sockets too).

  Any account    POST /api/chat/ticket/                       one-minute ticket for the WebSocket
                 GET  /api/chat/unread/                       number for the badge
  Customer       GET  /api/chat/conversation/                 my conversation (id is null before the first message)
                 GET  /api/chat/messages/                     history  ?limit= &before=<id> | &after=<id>
                 POST /api/chat/messages/                     {body}
                 POST /api/chat/read/                         I read the admin's messages
  Admin          GET  /api/chat/admin/conversations/          inbox  ?q= &unread=1 &limit= &offset=
                 GET  /api/chat/admin/conversations/<id>/messages/    history, same parameters
                 POST /api/chat/admin/conversations/<id>/messages/    {body}  reply
                 POST /api/chat/admin/conversations/<id>/read/        I read the customer's messages
"""
from django.db.models import Count, F, Max, Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import chat
from .chat import ChatError, ChatMessage, Conversation
from .photos import photo_urls
from .roles import ROLES, IsActiveAccount, _RolePermission, role_info


class IsChatCustomer(_RolePermission):
    """Any active account that is not support (admins answer from the inbox, they have no chat of their own)."""
    allowed = tuple(r for r in ROLES if r not in chat.SUPPORT_ROLES)
    message = 'Support staff answer from the inbox.'


class IsChatSupport(_RolePermission):
    allowed = chat.SUPPORT_ROLES
    message = 'Only support staff can open the inbox.'


def _error(e):
    return Response({'detail': e.message, 'code': e.code}, status=e.status)


def _int_param(request, name, default=None, minimum=0, maximum=None):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ChatError('bad_parameter', '"%s" must be a number.' % name)
    if value < minimum or (maximum is not None and value > maximum):
        raise ChatError('bad_parameter', '"%s" is out of range.' % name)
    return value


def history_params(request):
    """Reads and checks ?limit= &before= &after= (raises ChatError), before any database work."""
    return (_int_param(request, 'limit', chat.PAGE_SIZE, minimum=1, maximum=chat.MAX_PAGE_SIZE),
            _int_param(request, 'before'), _int_param(request, 'after'))


def history(conversation, params):
    """One page of messages, oldest first. `params` comes from history_params().

    default       the newest `limit` messages. has_more says there are older ones; ask again with
                  before=<next_before> to load them (scroll up).
    after=<id>    only messages newer than that id (catch up after the WebSocket was offline).
    """
    limit, before, after = params
    qs = ChatMessage.objects.filter(conversation=conversation).select_related('sender')
    if after is not None:
        rows = list(qs.filter(message_id__gt=after).order_by('message_id')[:limit + 1])
        has_more, rows = len(rows) > limit, rows[:limit]
    else:
        if before is not None:
            qs = qs.filter(message_id__lt=before)
        rows = list(qs.order_by('-message_id')[:limit + 1])
        has_more, rows = len(rows) > limit, rows[:limit][::-1]
    photos = photo_urls({m.sender_id for m in rows})
    results = [chat.message_payload(m, conversation, m.sender, photos.get(m.sender_id)) for m in rows]
    return {'results': results, 'has_more': has_more,
            'next_before': results[0]['message_id'] if results and after is None and has_more else None}


def _send(request, sender, is_support, conversation_id=None):
    payload = chat.save_message(sender, is_support, request.data.get('body'), conversation_id,
                                client_id=request.data.get('client_id'))
    chat.publish_sync(payload['conversation']['guest']['guest_id'], payload)
    return Response(payload['message'], status=status.HTTP_201_CREATED)


def _read(request, conversation, is_support):
    payload = chat.mark_read(conversation, is_support, _int_param(request, 'up_to'))
    if payload:
        chat.publish_sync(conversation.guest_id, payload)
    return Response({'marked': payload['count'] if payload else 0})


# ---------------------------------------------------------------- any account

class TicketView(APIView):
    """A ticket for GET ws(s)://<host>/ws/chat/?ticket=<ticket> (valid for one minute)."""
    permission_classes = [IsActiveAccount]

    def post(self, request):
        return Response({'ticket': chat.make_ticket(request.user), 'expires_in': chat.TICKET_MAX_AGE,
                         'path': '/ws/chat/'})


class UnreadView(APIView):
    """The number for the chat badge. Customer: admin messages not read yet. Admin: customer messages not read yet."""
    permission_classes = [IsActiveAccount]

    def get(self, request):
        role, _ = role_info(request.user)
        if role in chat.SUPPORT_ROLES:
            return Response({'role': 'admin', 'unread': chat.total_unread_for_admin()})
        return Response({'role': 'customer', 'unread': chat.total_unread_for_customer(request.user.guest_id)})


# ---------------------------------------------------------------- customer

def _own_conversation(request):
    return Conversation.objects.filter(guest_id=request.user.guest_id).first()


class MyConversationView(APIView):
    permission_classes = [IsChatCustomer]

    def get(self, request):
        conversation = _own_conversation(request)
        return Response({'conversation_id': conversation.conversation_id if conversation else None,
                         'unread': chat.total_unread_for_customer(request.user.guest_id)})


class MyMessagesView(APIView):
    permission_classes = [IsChatCustomer]

    def get(self, request):
        try:
            params = history_params(request)
            conversation = _own_conversation(request)
            if conversation is None:
                return Response({'results': [], 'has_more': False, 'next_before': None})
            return Response(history(conversation, params))
        except ChatError as e:
            return _error(e)

    def post(self, request):
        try:
            return _send(request, request.user, is_support=False)
        except ChatError as e:
            return _error(e)


class MyReadView(APIView):
    permission_classes = [IsChatCustomer]

    def post(self, request):
        conversation = _own_conversation(request)
        if conversation is None:
            return Response({'marked': 0})
        try:
            return _read(request, conversation, is_support=False)
        except ChatError as e:
            return _error(e)


# ---------------------------------------------------------------- admin

class InboxView(APIView):
    permission_classes = [IsChatSupport]

    def get(self, request):
        try:
            limit = _int_param(request, 'limit', 50, minimum=1, maximum=200)
            offset = _int_param(request, 'offset', 0)
        except ChatError as e:
            return _error(e)
        qs = (Conversation.objects.select_related('guest')
              .annotate(last_message_id=Max('messages__message_id'),
                        unread=Count('messages', filter=Q(messages__read_at__isnull=True,
                                                          messages__sender_id=F('guest_id'))))
              .filter(last_message_id__isnull=False))
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(guest__first_name__icontains=q) | Q(guest__last_name__icontains=q)
                           | Q(guest__email__icontains=q))
        if request.query_params.get('unread') in ('1', 'true', 'yes'):
            qs = qs.filter(unread__gt=0)
        total = qs.count()
        rows = list(qs.order_by('-last_message_id')[offset:offset + limit])

        last = {m.message_id: m for m in ChatMessage.objects.filter(message_id__in=[c.last_message_id for c in rows])}
        photos = photo_urls(c.guest_id for c in rows)
        results = []
        for c in rows:
            m = last[c.last_message_id]
            results.append({
                'conversation_id': c.conversation_id,
                'guest': chat.guest_payload(c.guest, photos.get(c.guest_id)),
                'unread': c.unread,
                'last_message': {'message_id': m.message_id, 'preview': m.body[:120],
                                 'from_customer': m.sender_id == c.guest_id, 'created_at': chat.iso(m.created_at)},
                'last_message_at': chat.iso(m.created_at),
            })
        return Response({'results': results, 'count': total, 'has_more': offset + limit < total,
                         'unread_total': chat.total_unread_for_admin()})


def _conversation_or_404(pk):
    conversation = Conversation.objects.select_related('guest').filter(pk=pk).first()
    if conversation is None:
        raise ChatError('not_found', 'Conversation not found.', 404)
    return conversation


class AdminMessagesView(APIView):
    permission_classes = [IsChatSupport]

    def get(self, request, pk):
        try:
            params = history_params(request)
            conversation = _conversation_or_404(pk)
            data = history(conversation, params)
            data['guest'] = chat.guest_payload(conversation.guest, photo_urls([conversation.guest_id]).get(conversation.guest_id))
            return Response(data)
        except ChatError as e:
            return _error(e)

    def post(self, request, pk):
        try:
            return _send(request, request.user, is_support=True, conversation_id=pk)
        except ChatError as e:
            return _error(e)


class AdminReadView(APIView):
    permission_classes = [IsChatSupport]

    def post(self, request, pk):
        try:
            return _read(request, _conversation_or_404(pk), is_support=True)
        except ChatError as e:
            return _error(e)
