"""AI assistant for guests: answers questions about the hotel and picks a room for a request
like "We are two, 10-13 December, we need a work desk".

How it works
------------
The language model (Groq or Claude, see Settings) only understands the question and writes the answer.
Every fact comes from here:
  * HOTEL_FACTS below           - address, front desk, cancellation rules (edit them here);
  * the room_type / room tables  - room types, capacity, prices, descriptions;
  * the booking / booking_room tables - which rooms are taken on which dates
    (the SAME overlap check as CreateBookingView in frontend_api.py).

The model gets three read-only tools (get_hotel_info, list_room_types, search_rooms).
It cannot book, cancel, or see who booked a room: the tools return only counts of free rooms
and prices. The guest books with the normal booking form (the widget shows a "Book" button).

Settings (.env), one provider is enough:
  GROQ_API_KEY=gsk_...                  Groq (free plan, console.groq.com)
  ANTHROPIC_API_KEY=sk-ant-...          Claude (paid, console.anthropic.com)
  ASSISTANT_PROVIDER=groq|anthropic     optional; default: whichever key is set (Groq first)
  ASSISTANT_MODEL=...                   optional; default openai/gpt-oss-120b (Groq) or claude-haiku-5-5
Without a key the endpoint answers 503.
"""
import datetime
import json
import logging
import os

from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import BookingRoom, Room, RoomType

log = logging.getLogger(__name__)

ACTIVE = ('Confirmed', 'CheckedIn')      # same as frontend_api.ACTIVE: these bookings block a room
MAX_NIGHTS = 30
MAX_TOOL_ROUNDS = 5
MAX_HISTORY = 20                         # messages kept from the conversation
MAX_MESSAGE_CHARS = 1000

# ---------------------------------------------------------------- hotel facts (edit here)
# Only what is true for the hotel. The assistant is told to say "I don't know, ask the front desk"
# for anything that is not here or in the database, so add facts here instead of in the prompt.
HOTEL_FACTS = {
    'name': 'Juniper Court Hotel',
    'address': '14 Juniper Court, Almaty 050000, Kazakhstan',
    'front_desk': 'Open 24/7. For anything else, use the "Support" tab of this chat (log in first) '
                  'to write to the front office.',
    'currency': 'USD',
    'about': 'Small independent hotel in the city centre, opened in 2014, six rooms on three floors.',
    'cancellation_policy': (
        'A booking with status Confirmed can be cancelled online at any time before check-in, '
        'from the "My account" page. The payment is refunded in full. '
        'After check-in the booking cannot be cancelled online; talk to the front desk.'
    ),
    'booking_rules': (
        'Book on the website: choose dates and guests, pick rooms, pay by card, cash or bank transfer. '
        'Each room has a maximum number of guests (capacity). A group bigger than one room books several rooms '
        'in the same booking. You need an account to book.'
    ),
}


# ---------------------------------------------------------------- tools (read-only DB queries)

def _parse_date(value, name):
    try:
        return datetime.date.fromisoformat(str(value)), None
    except ValueError:
        return None, '%s must be a date in YYYY-MM-DD format.' % name


def _blocked_room_ids(check_in, check_out):
    """Rooms with an active booking that overlaps [check_in, check_out)."""
    return set(BookingRoom.objects
               .filter(booking__status__in=ACTIVE,
                       booking__check_in__lt=check_out, booking__check_out__gt=check_in)
               .values_list('room_id', flat=True))


def get_hotel_info():
    return HOTEL_FACTS


def list_room_types():
    types = []
    for rt in RoomType.objects.order_by('price_per_night'):
        types.append({
            'room_type_id': rt.room_type_id,
            'type_name': rt.type_name,
            'capacity': rt.capacity,
            'price_per_night': str(rt.price_per_night),
            'description': rt.description or '',
            'rooms_in_hotel': Room.objects.filter(room_type=rt).count(),
        })
    return {'currency': HOTEL_FACTS['currency'], 'room_types': types}


def _matches(description, features):
    text = (description or '').lower()
    return [f for f in features if f and f.lower() in text]


def search_rooms(check_in, check_out, guests, features=None):
    """Free rooms per room type for the dates, using the real bookings."""
    ci, err = _parse_date(check_in, 'check_in')
    if err:
        return {'error': err}
    co, err = _parse_date(check_out, 'check_out')
    if err:
        return {'error': err}
    if co <= ci:
        return {'error': 'check_out must be after check_in.'}
    if ci < datetime.date.today():
        return {'error': 'check_in is in the past (today is %s).' % datetime.date.today().isoformat()}
    nights = (co - ci).days
    if nights > MAX_NIGHTS:
        return {'error': 'At most %d nights can be searched at once.' % MAX_NIGHTS}
    try:
        guests = int(guests)
    except (TypeError, ValueError):
        return {'error': 'guests must be a number.'}
    if not 1 <= guests <= 20:
        return {'error': 'guests must be between 1 and 20.'}
    features = [str(f).strip() for f in (features or []) if str(f).strip()][:5]

    blocked = _blocked_room_ids(ci, co)
    options = []
    for rt in RoomType.objects.order_by('price_per_night'):
        free = list(Room.objects.filter(room_type=rt, status='Available')
                    .exclude(room_id__in=blocked).order_by('room_number')
                    .values_list('room_number', flat=True))
        matched = _matches(rt.description, features)
        options.append({
            'room_type_id': rt.room_type_id,
            'type_name': rt.type_name,
            'capacity': rt.capacity,
            'fits_all_guests_in_one_room': rt.capacity >= guests,
            'price_per_night': str(rt.price_per_night),
            'total_for_stay': str(rt.price_per_night * nights),
            'description': rt.description or '',
            'free_rooms': len(free),
            'matched_features': matched,
            'has_all_features': len(matched) == len(features),
        })
    return {
        'check_in': ci.isoformat(), 'check_out': co.isoformat(), 'nights': nights, 'guests': guests,
        'currency': HOTEL_FACTS['currency'], 'requested_features': features, 'options': options,
        'note': 'Only room types with free_rooms > 0 can be booked. Features are matched against the '
                'English room description.',
    }


TOOLS = [
    {
        'name': 'get_hotel_info',
        'description': 'Hotel name, address, front desk hours, cancellation policy and booking rules.',
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'list_room_types',
        'description': 'All room types from the database: capacity, price per night, description, '
                       'number of rooms. Does not say what is free on given dates; use search_rooms for that.',
        'input_schema': {'type': 'object', 'properties': {}},
    },
    {
        'name': 'search_rooms',
        'description': 'Real availability from the booking database for the dates: for each room type '
                       'the number of free rooms, the price per night and the total for the stay, and '
                       'whether its description contains the requested features.',
        'input_schema': {
            'type': 'object',
            'properties': {
                'check_in': {'type': 'string', 'description': 'YYYY-MM-DD'},
                'check_out': {'type': 'string', 'description': 'YYYY-MM-DD, the day the guests leave'},
                'guests': {'type': 'integer', 'minimum': 1},
                'features': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'What the guest asks for, as short ENGLISH keywords that may appear in '
                                   'a room description, e.g. ["desk"], ["city view"], ["shower"], ["lounge"].',
                },
            },
            'required': ['check_in', 'check_out', 'guests'],
        },
    },
]

TOOL_FUNCS = {
    'get_hotel_info': lambda args: get_hotel_info(),
    'list_room_types': lambda args: list_room_types(),
    'search_rooms': lambda args: search_rooms(args.get('check_in'), args.get('check_out'),
                                              args.get('guests'), args.get('features')),
}


def run_tool(name, args):
    func = TOOL_FUNCS.get(name)
    if func is None:
        return {'error': 'Unknown tool %s.' % name}
    try:
        return func(args if isinstance(args, dict) else {})
    except Exception:  # a broken tool call must not break the whole answer
        log.exception('assistant tool %s failed', name)
        return {'error': 'The tool failed, try again.'}


def system_prompt():
    today = datetime.date.today()
    return (
        'You are the online assistant of %(name)s, a hotel in Almaty. Today is %(today)s (%(weekday)s).\n'
        'You help guests on the hotel website: you answer questions about the hotel (address, rooms, prices, '
        'cancellation and booking rules) and pick a room for their dates.\n\n'
        'Rules:\n'
        '- Answer in the language the guest writes in (Russian, Kazakh or English).\n'
        '- Take every fact from the tools. Never invent prices, rooms, availability, times, services or rules. '
        'If the tools do not have the answer, say you do not know and suggest the front desk.\n'
        '- When the guest gives dates, ALWAYS call search_rooms before saying what is free. Dates without a '
        'year mean the next such date that is not in the past. "10-13 December" means check-in 10 December, '
        'check-out 13 December (3 nights). "We are two" / "вдвоём" means 2 guests.\n'
        '- Pass what the guest wants in the room (desk, view, shower, separate room...) as English keywords '
        'in features.\n'
        '- Recommend a room type with free_rooms > 0, fits_all_guests_in_one_room and all requested features; '
        'say the price per night and the total for the stay. If nothing matches everything, say what is '
        'missing and offer the closest free option. If the group does not fit in one room, suggest several '
        'rooms. If key details are missing (dates or number of guests), ask for them in one short question.\n'
        '- You cannot make, change or cancel bookings and you never see other guests\' data. The guest books '
        'with the "Book" button under your answer or on the Book page.\n'
        '- Politely decline topics that have nothing to do with the hotel or the stay.\n'
        '- Keep answers short: 2-5 sentences, plain text, no Markdown tables.'
        % {'name': HOTEL_FACTS['name'], 'today': today.isoformat(), 'weekday': today.strftime('%A')}
    )


# ---------------------------------------------------------------- the model call

class AssistantUnavailable(Exception):
    pass


DEFAULT_MODELS = {'groq': 'openai/gpt-oss-120b', 'anthropic': 'claude-haiku-5-5'}


def _provider():
    chosen = os.environ.get('ASSISTANT_PROVIDER', '').strip().lower()
    if chosen in DEFAULT_MODELS:
        return chosen
    if os.environ.get('GROQ_API_KEY'):
        return 'groq'
    if os.environ.get('ANTHROPIC_API_KEY'):
        return 'anthropic'
    raise AssistantUnavailable('not configured')


def _client(provider):
    """The SDK client; packages are imported here so the rest of the backend works without them."""
    if provider == 'groq':
        key = os.environ.get('GROQ_API_KEY', '')
        if not key:
            raise AssistantUnavailable('not configured')
        from groq import Groq
        return Groq(api_key=key, timeout=30, max_retries=1)
    key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not key:
        raise AssistantUnavailable('not configured')
    import anthropic
    return anthropic.Anthropic(api_key=key, timeout=30, max_retries=1)


def _suggestions(result):
    """Room types the widget can offer a "Book" button for, from the last search_rooms result."""
    if not isinstance(result, dict) or 'options' not in result:
        return []
    free = [o for o in result['options'] if o['free_rooms'] > 0 and o['fits_all_guests_in_one_room']]
    best = [o for o in free if o['has_all_features']]
    picked = best or ([] if result['requested_features'] else free)
    return [{
        'room_type_id': o['room_type_id'], 'type_name': o['type_name'],
        'check_in': result['check_in'], 'check_out': result['check_out'],
        'guests': result['guests'], 'nights': result['nights'],
        'price_per_night': o['price_per_night'], 'total': o['total_for_stay'],
        'free_rooms': o['free_rooms'],
    } for o in picked[:3]]


class _Searches:
    """Runs the tools and remembers the last successful search_rooms result (for the Book buttons)."""

    def __init__(self):
        self.last = None

    def run(self, name, args):
        out = run_tool(name, args)
        if name == 'search_rooms' and 'options' in out:
            self.last = out
        return json.dumps(out, ensure_ascii=False, default=str)


def _call(fn, **kw):
    try:
        return fn(**kw)
    except Exception as e:
        log.warning('assistant model call failed: %s', e)
        raise AssistantUnavailable(str(e))


def _ask_anthropic(client, model, history, searches):
    messages = [{'role': m['role'], 'content': m['content']} for m in history]
    for _ in range(MAX_TOOL_ROUNDS + 1):
        resp = _call(client.messages.create, model=model, max_tokens=700, system=system_prompt(),
                     tools=TOOLS, messages=messages)
        if resp.stop_reason != 'tool_use':
            return ''.join(b.text for b in resp.content if getattr(b, 'type', '') == 'text').strip()
        messages.append({'role': 'assistant', 'content': resp.content})
        messages.append({'role': 'user', 'content': [
            {'type': 'tool_result', 'tool_use_id': b.id, 'content': searches.run(b.name, b.input)}
            for b in resp.content if getattr(b, 'type', '') == 'tool_use']})
    return None


# The same tools in the OpenAI-style format that Groq uses.
OPENAI_TOOLS = [{'type': 'function', 'function': {
    'name': t['name'], 'description': t['description'], 'parameters': t['input_schema']}} for t in TOOLS]


def _ask_groq(client, model, history, searches):
    messages = [{'role': 'system', 'content': system_prompt()}]
    messages += [{'role': m['role'], 'content': m['content']} for m in history]
    for _ in range(MAX_TOOL_ROUNDS + 1):
        resp = _call(client.chat.completions.create, model=model, max_tokens=700, temperature=0.2,
                     tools=OPENAI_TOOLS, tool_choice='auto', messages=messages)
        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        if not calls:
            return (msg.content or '').strip()
        messages.append({'role': 'assistant', 'content': msg.content or '', 'tool_calls': [
            {'id': c.id, 'type': 'function', 'function': {'name': c.function.name, 'arguments': c.function.arguments}}
            for c in calls]})
        for c in calls:
            try:
                args = json.loads(c.function.arguments or '{}')
            except ValueError:
                args = {}
            messages.append({'role': 'tool', 'tool_call_id': c.id, 'content': searches.run(c.function.name, args)})
    return None


def ask(history):
    """history: [{'role': 'user'|'assistant', 'content': str}, ...], last one from the user.
    Returns {'reply': str, 'suggestions': [...]}."""
    provider = _provider()
    client = _client(provider)
    model = os.environ.get('ASSISTANT_MODEL') or DEFAULT_MODELS[provider]
    searches = _Searches()
    run = _ask_groq if provider == 'groq' else _ask_anthropic
    reply = run(client, model, history, searches)
    if reply is None:
        reply = 'Sorry, I could not finish the search. Please try again or ask the front desk.'
    return {'reply': reply or '…', 'suggestions': _suggestions(searches.last)}


# ---------------------------------------------------------------- API endpoint

class MessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['user', 'assistant'])
    content = serializers.CharField(max_length=4000, allow_blank=False, trim_whitespace=True)


class AskSerializer(serializers.Serializer):
    messages = MessageSerializer(many=True, allow_empty=False)

    def validate_messages(self, value):
        value = value[-MAX_HISTORY:]
        while value and value[0]['role'] != 'user':     # the API needs the user to speak first
            value = value[1:]
        if not value or value[-1]['role'] != 'user':
            raise serializers.ValidationError('The last message must be from the guest.')
        if len(value[-1]['content']) > MAX_MESSAGE_CHARS:
            raise serializers.ValidationError('The message is too long (at most %d characters).' % MAX_MESSAGE_CHARS)
        return [{'role': m['role'], 'content': m['content'][:MAX_MESSAGE_CHARS]} for m in value]


class AssistantThrottle(SimpleRateThrottle):
    """Per IP, for visitors and logged-in guests alike: every question costs an API call."""
    scope = 'assistant'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class AssistantView(APIView):
    """POST {"messages": [{"role": "user", "content": "..."}, ...]}
    -> {"reply": "...", "suggestions": [{room_type_id, type_name, check_in, check_out, guests, ...}]}
    Open to visitors (no login): it only reads public information."""
    throttle_classes = [AssistantThrottle]

    def post(self, request):
        s = AskSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            return Response(ask(s.validated_data['messages']))
        except AssistantUnavailable as e:
            code = (status.HTTP_503_SERVICE_UNAVAILABLE if str(e) == 'not configured'
                    else status.HTTP_502_BAD_GATEWAY)
            return Response({'detail': 'The AI assistant is not available right now.'}, status=code)
