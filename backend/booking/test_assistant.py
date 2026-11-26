"""AI assistant (assistant.py), Groq and Claude. Run (no MySQL and no API key needed, the model is faked):
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_assistant
"""
import datetime
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from . import assistant
from .models import Booking, BookingRoom, Guest, Payment, Room, RoomType

MODELS = [Guest, RoomType, Room, Booking, BookingRoom, Payment]
URL = '/api/assistant/'


def day(n):
    return datetime.date.today() + datetime.timedelta(days=n)


def text(t):
    return SimpleNamespace(type='text', text=t)


def tool(name, args, id='t1'):
    return SimpleNamespace(type='tool_use', name=name, input=args, id=id)


class FakeClient:
    """Plays the model: returns the prepared responses one by one and records every request."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kw):
        self.calls.append(kw)
        content, stop = self.responses.pop(0)
        return SimpleNamespace(content=content, stop_reason=stop)


class FakeGroq:
    """Plays a Groq (OpenAI-style) model."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append({**kw, 'messages': list(kw['messages'])})
        content, calls = self.responses.pop(0)
        tool_calls = [SimpleNamespace(id='c%d' % i, function=SimpleNamespace(name=n, arguments=a))
                      for i, (n, a) in enumerate(calls)] or None
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))])


ANTHROPIC_ENV = {'ASSISTANT_PROVIDER': 'anthropic', 'ANTHROPIC_API_KEY': 'test', 'GROQ_API_KEY': ''}
GROQ_ENV = {'ASSISTANT_PROVIDER': '', 'GROQ_API_KEY': 'test', 'ANTHROPIC_API_KEY': ''}


class AssistantTest(TransactionTestCase):
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
        self.std = RoomType.objects.create(type_name='Standard', capacity=2, price_per_night=60,
                                           description='Queen bed, quiet courtyard view, 24 m².')
        self.dlx = RoomType.objects.create(type_name='Deluxe', capacity=3, price_per_night=90,
                                           description='King bed, city view, work desk and rain shower, 32 m².')
        self.r101 = Room.objects.create(room_number='101', floor=1, room_type=self.std)
        self.r201 = Room.objects.create(room_number='201', floor=2, room_type=self.dlx)
        self.r202 = Room.objects.create(room_number='202', floor=2, room_type=self.dlx)
        self.guest = Guest.objects.create(first_name='A', last_name='B', email='a@example.com', phone='+77000000000')

    def book(self, room, ci, co, status='Confirmed'):
        b = Booking.objects.create(guest=self.guest, booking_date=datetime.datetime.now(),
                                   check_in=day(ci), check_out=day(co), status=status)
        BookingRoom.objects.create(booking=b, room=room, guests_count=2, price_per_night=90)

    def option(self, result, name):
        return next(o for o in result['options'] if o['type_name'] == name)

    # ------------------------------------------------ the availability tool

    def test_search_uses_real_bookings(self):
        self.book(self.r201, 10, 13)                        # overlaps
        self.book(self.r202, 13, 15)                        # starts on our check-out day: no overlap
        self.book(self.r101, 10, 13, status='Cancelled')    # cancelled bookings do not block
        r = assistant.search_rooms(day(10).isoformat(), day(13).isoformat(), 2, ['desk'])
        self.assertEqual(r['nights'], 3)
        dlx = self.option(r, 'Deluxe')
        self.assertEqual(dlx['free_rooms'], 1)
        self.assertEqual(dlx['total_for_stay'], '270.00')
        self.assertEqual(dlx['matched_features'], ['desk'])
        self.assertTrue(dlx['has_all_features'])
        std = self.option(r, 'Standard')
        self.assertEqual(std['free_rooms'], 1)
        self.assertFalse(std['has_all_features'])

    def test_search_skips_maintenance_and_checks_capacity(self):
        Room.objects.filter(pk=self.r101.pk).update(status='Maintenance')
        r = assistant.search_rooms(day(5).isoformat(), day(6).isoformat(), 3)
        self.assertEqual(self.option(r, 'Standard')['free_rooms'], 0)
        self.assertFalse(self.option(r, 'Standard')['fits_all_guests_in_one_room'])
        self.assertTrue(self.option(r, 'Deluxe')['fits_all_guests_in_one_room'])

    def test_search_rejects_bad_dates(self):
        self.assertIn('error', assistant.search_rooms('2020-01-01', '2020-01-03', 2))
        self.assertIn('error', assistant.search_rooms(day(5).isoformat(), day(5).isoformat(), 2))
        self.assertIn('error', assistant.search_rooms('10 December', day(5).isoformat(), 2))
        self.assertIn('error', assistant.search_rooms(day(1).isoformat(), day(60).isoformat(), 2))
        self.assertIn('error', assistant.run_tool('drop_tables', {}))

    def test_tools_never_return_guest_data(self):
        self.book(self.r201, 10, 13)
        out = str(assistant.search_rooms(day(10).isoformat(), day(13).isoformat(), 2)) + str(assistant.list_room_types())
        self.assertNotIn('a@example.com', out)
        self.assertNotIn('201', out)          # not even which room is taken

    # ------------------------------------------------ the endpoint with a fake model

    def ask(self, client, text_, env=ANTHROPIC_ENV):
        with mock.patch.dict('os.environ', env), mock.patch.object(assistant, '_client', return_value=client):
            return APIClient().post(URL, {'messages': [{'role': 'user', 'content': text_}]}, format='json')

    def test_picks_room_with_desk(self):
        self.book(self.r201, 10, 13)
        fake = FakeClient([
            ([tool('search_rooms', {'check_in': day(10).isoformat(), 'check_out': day(13).isoformat(),
                                    'guests': 2, 'features': ['desk']})], 'tool_use'),
            ([text('Номер Deluxe свободен: 90 $ за ночь, 270 $ за 3 ночи.')], 'end_turn'),
        ])
        r = self.ask(fake, 'Мы вдвоём, на 3 ночи, нужен рабочий стол')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn('Deluxe', r.data['reply'])
        self.assertEqual([s['type_name'] for s in r.data['suggestions']], ['Deluxe'])
        self.assertEqual(r.data['suggestions'][0]['free_rooms'], 1)
        self.assertEqual(r.data['suggestions'][0]['total'], '270.00')
        # the tool result really went back to the model
        sent = fake.calls[1]['messages'][-1]['content'][0]
        self.assertEqual(sent['type'], 'tool_result')
        self.assertIn('"free_rooms": 1', sent['content'])

    def test_no_suggestion_when_feature_room_is_full(self):
        self.book(self.r201, 10, 13)
        self.book(self.r202, 10, 13)
        fake = FakeClient([
            ([tool('search_rooms', {'check_in': day(10).isoformat(), 'check_out': day(13).isoformat(),
                                    'guests': 2, 'features': ['desk']})], 'tool_use'),
            ([text('Rooms with a desk are booked.')], 'end_turn'),
        ])
        self.assertEqual(self.ask(fake, 'two of us, need a desk').data['suggestions'], [])

    def test_plain_question_and_prompt(self):
        fake = FakeClient([([tool('get_hotel_info', {})], 'tool_use'), ([text('14 Juniper Court.')], 'end_turn')])
        r = self.ask(fake, 'Где вы находитесь?')
        self.assertEqual(r.data, {'reply': '14 Juniper Court.', 'suggestions': []})
        self.assertIn(datetime.date.today().isoformat(), fake.calls[0]['system'])
        self.assertIn('Juniper Court', fake.calls[1]['messages'][-1]['content'][0]['content'])

    def test_stops_after_too_many_tool_rounds(self):
        fake = FakeClient([([tool('list_room_types', {})], 'tool_use')] * (assistant.MAX_TOOL_ROUNDS + 1))
        r = self.ask(fake, 'loop')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(fake.calls), assistant.MAX_TOOL_ROUNDS + 1)

    def test_not_configured_and_model_error(self):
        with mock.patch.dict('os.environ', {'ANTHROPIC_API_KEY': '', 'GROQ_API_KEY': '', 'ASSISTANT_PROVIDER': ''}):
            r = APIClient().post(URL, {'messages': [{'role': 'user', 'content': 'hi'}]}, format='json')
        self.assertEqual(r.status_code, 503)

        class Broken:
            messages = SimpleNamespace(create=mock.Mock(side_effect=RuntimeError('timeout')))
        self.assertEqual(self.ask(Broken(), 'hi').status_code, 502)

    def test_validation(self):
        c = APIClient()
        self.assertEqual(c.post(URL, {'messages': []}, format='json').status_code, 400)
        self.assertEqual(c.post(URL, {'messages': [{'role': 'system', 'content': 'x'}]}, format='json').status_code, 400)
        self.assertEqual(c.post(URL, {'messages': [{'role': 'user', 'content': 'x' * 1001}]}, format='json').status_code, 400)
        last_is_bot = [{'role': 'user', 'content': 'a'}, {'role': 'assistant', 'content': 'b'}]
        self.assertEqual(c.post(URL, {'messages': last_is_bot}, format='json').status_code, 400)

    def test_history_starts_with_user(self):
        fake = FakeClient([([text('ok')], 'end_turn')])
        msgs = [{'role': 'assistant', 'content': 'Hello!'}, {'role': 'user', 'content': 'hi'}]
        with mock.patch.dict('os.environ', ANTHROPIC_ENV), mock.patch.object(assistant, '_client', return_value=fake):
            r = APIClient().post(URL, {'messages': msgs}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(fake.calls[0]['messages'], [{'role': 'user', 'content': 'hi'}])

    def test_throttled(self):
        fake = FakeClient([([text('ok')], 'end_turn')] * 25)
        codes = [self.ask(fake, 'hi').status_code for _ in range(21)]
        self.assertEqual(codes[-1], 429)

    # ------------------------------------------------ Groq

    def test_groq_is_chosen_by_its_key(self):
        with mock.patch.dict('os.environ', GROQ_ENV):
            self.assertEqual(assistant._provider(), 'groq')
        with mock.patch.dict('os.environ', {**GROQ_ENV, 'ANTHROPIC_API_KEY': 'k', 'ASSISTANT_PROVIDER': 'anthropic'}):
            self.assertEqual(assistant._provider(), 'anthropic')

    def test_groq_picks_room_with_desk(self):
        self.book(self.r201, 10, 13)
        args = '{"check_in": "%s", "check_out": "%s", "guests": 2, "features": ["desk"]}' % (
            day(10).isoformat(), day(13).isoformat())
        fake = FakeGroq([(None, [('search_rooms', args)]), ('Свободен Deluxe: 270 $ за 3 ночи.', [])])
        r = self.ask(fake, 'Мы вдвоём, нужен рабочий стол', env=GROQ_ENV)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['reply'], 'Свободен Deluxe: 270 $ за 3 ночи.')
        self.assertEqual([s['type_name'] for s in r.data['suggestions']], ['Deluxe'])
        first, second = fake.calls
        self.assertEqual(first['model'], 'openai/gpt-oss-120b')
        self.assertEqual(first['messages'][0]['role'], 'system')
        self.assertEqual(first['tools'][2]['function']['name'], 'search_rooms')
        tool_msg = second['messages'][-1]
        self.assertEqual((tool_msg['role'], tool_msg['tool_call_id']), ('tool', 'c0'))
        self.assertIn('"free_rooms": 1', tool_msg['content'])
        self.assertEqual(second['messages'][-2]['tool_calls'][0]['function']['name'], 'search_rooms')

    def test_groq_bad_tool_arguments_do_not_crash(self):
        fake = FakeGroq([(None, [('search_rooms', 'not json')]), ('Уточните даты.', [])])
        r = self.ask(fake, 'номер', env=GROQ_ENV)
        self.assertEqual(r.data, {'reply': 'Уточните даты.', 'suggestions': []})
        self.assertIn('error', fake.calls[1]['messages'][-1]['content'])

    def test_groq_model_from_env(self):
        fake = FakeGroq([('ok', [])])
        self.ask(fake, 'hi', env={**GROQ_ENV, 'ASSISTANT_MODEL': 'llama-3.3-70b-versatile'})
        self.assertEqual(fake.calls[0]['model'], 'llama-3.3-70b-versatile')
