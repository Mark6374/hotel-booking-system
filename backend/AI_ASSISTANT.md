# AI assistant in the chat widget

The chat button now has two tabs: **AI assistant** (works without login) and **Support** (live chat with the front office, as before).

The assistant answers guest questions about the hotel (address, rooms, prices, cancellation and booking rules)
and picks a room for a request like *"We are two, 10–13 December, we need a work desk"*, using the real bookings in MySQL.

## Setup

```
pip install -r requirements.txt          # adds the groq and anthropic packages
```

In `backend/.env` – **one** of the two keys:

```
GROQ_API_KEY=gsk_...                      # Groq, free plan: console.groq.com -> API Keys
# ANTHROPIC_API_KEY=sk-ant-...            # or Claude (paid): console.anthropic.com
# ASSISTANT_PROVIDER=groq                 # optional, when both keys are set
# ASSISTANT_MODEL=openai/gpt-oss-120b     # optional; e.g. llama-3.3-70b-versatile on Groq, claude-haiku-5-5 on Claude
```

Without a key the endpoint answers `503` and the widget says the assistant is unavailable; the rest of the site works.

**Groq free plan limits** are per account (see console.groq.com -> Settings -> Limits), roughly 30 requests and
8,000 tokens per minute. One guest question takes 2–3 model calls of about 1,000 tokens each, so a few questions per
minute work; more return 429 and the widget shows "not available right now" – wait a minute.

## How it works (`booking/assistant.py`)

```
guest question ──► POST /api/assistant/ ──► model (Groq/Claude) ──► tool call ──► Django ORM (MySQL) ──► tool result ──► model ──► answer
                                                    get_hotel_info / list_room_types / search_rooms
```

* **The model only understands the question and writes the answer.** Every fact comes from the tools:
  * `get_hotel_info` – `HOTEL_FACTS` in `assistant.py` (address, front desk, cancellation policy, booking rules). **Edit hotel facts there**;
  * `list_room_types` – `room_type` + `room` tables;
  * `search_rooms(check_in, check_out, guests, features)` – free rooms per type for the dates. It uses the same overlap
    rule as `CreateBookingView`: a room is taken if an active booking (`Confirmed` / `CheckedIn`) has
    `check_in < our check_out` and `check_out > our check_in`; rooms in `Maintenance` are never offered.
    `features` (e.g. `["desk"]`) are matched against the room type description.
* **Read-only and private.** The tools return counts and prices only – no guest names, no room numbers that are taken.
  The assistant cannot book or cancel; the guest presses **Book** under the answer, which fills in the booking form
  (dates, guests, one room of that type) and continues with the normal, transactional booking.
* **Stateless.** The browser keeps the conversation and sends the last 20 messages with each question; nothing is stored.
* **Limits.** 20 questions per minute per IP (`assistant` throttle in settings), 1000 characters per message, at most 5 tool rounds per answer.

## API

`POST /api/assistant/` (no login needed)

```json
{"messages": [{"role": "user", "content": "Мы вдвоём, 10-13 декабря, нужен рабочий стол"}]}
```

```json
{
  "reply": "Deluxe with a work desk is free: $90 per night, $270 for 3 nights.",
  "suggestions": [{"room_type_id": 2, "type_name": "Deluxe", "check_in": "2026-12-14", "check_out": "2026-12-17",
                   "guests": 2, "nights": 3, "price_per_night": "90.00", "total": "270.00", "free_rooms": 2}]
}
```

`suggestions` are the free room types that fit all guests and have every requested feature (from the last search).
Errors: `400` bad input, `429` too many questions, `502` the model did not answer, `503` no API key.

## Tests

```
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking.test_assistant
```

The model is replaced by a fake that calls the tools, so the tests need no key and no internet.
