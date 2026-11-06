# Django + MySQL Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend's localStorage-simulated database with a real MySQL database (the user's normalized schema) served through a Django + DRF API, for a local defense demo.

**Architecture:** `backend/db/02_normalized_schema.sql` creates the MySQL schema verbatim; Django models are `managed = False` and map onto those exact tables. Six read-only list endpoints plus four action endpoints (`/api/book/`, `/cancel/`, `/toggle-maintenance/`, `/reset-demo/`) mirror the six tables and four mutating functions `src/db.js` already has. `src/db.js` keeps its exact exported function names — only `loadDb`/`resetDb`/`runBookingTransaction`/`cancelBooking`/`toggleRoomMaintenance` become `async` and talk to the API instead of `localStorage`; every pure helper and every page's rendering logic is untouched.

**Tech Stack:** Django 6.0 + djangorestframework (already installed globally) + django-cors-headers (already installed) + PyMySQL as the MySQL driver (pure-Python, avoids a native build step) + MySQL 8 (already running via `brew services`) + the existing Vite/React frontend.

**Spec:** `docs/superpowers/specs/2026-11-06-django-backend-integration-design.md`

## Global Constraints

- Local demo only — no deployment, no Docker, no hosting (spec: Non-goals).
- No real authentication; the email-only login stays client-side exactly as it is (spec: Non-goals).
- No visual/design changes; no new product features (spec: Non-goals).
- CORS must allow the Vite dev origin(s) actually used by this project (`http://localhost:5173` and the other ports already seen in this session: `5174`, `5175`, `5176`, `5177`) — list every one, since the browser enforces CORS per exact origin and curl does not catch a missing one.
- The six seeded rows per table in `backend/booking/seed.py` must match `src/db.js`'s `seed()` exactly (same ids, names, dates, amounts) so the existing demo script (`amina@example.com`, the `...0000` declined card, etc.) keeps working unchanged.
- Every JSON response the four action endpoints return must keep the exact shape the frontend already renders: success `{ok: true, bookingId, log, total}`, failure `{ok: false, message, log}`, where each `log` entry is `{label, ok, detail?, final?}` — `src/pages/CheckoutPage.jsx`'s `RenderLog` component reads these fields by name.

## Review Focus

- A booking for a room already covered by another active (`Confirmed`/`CheckedIn`) booking on overlapping dates must be rejected with a log entry, not silently double-booked — the whole point of the original `blockedRoomIds` check. Covered by a dedicated curl scenario in Task 5.
- A booking for a room currently in `Maintenance` status must be rejected the same way a closed room is today. Covered by a dedicated curl scenario in Task 5.
- Booking twice with the same email in different case (`Amina@Example.com` vs `amina@example.com`) must reuse the same guest row, not create a duplicate guest — the original JS does `email.toLowerCase()` comparison. Covered by a dedicated curl scenario in Task 5.
- A CORS-misconfigured origin fails silently in the browser (a blocked preflight shows as a vague "Failed to fetch", not an HTTP error code) and curl never catches it, since curl doesn't enforce CORS. Task 3's verification explicitly checks from a real browser `fetch()`, not only curl.
- The backend being unreachable at page load (not yet started, wrong port) must show the user a plain-text instruction instead of a blank page or an unhandled promise rejection. Covered by Task 8's final verification step and by `App.jsx`'s error branch.

---

## Task 1: Backend scaffold and schema import

**Files:**
- Create: `backend/db/02_normalized_schema.sql`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/manage.py`
- Create: `backend/hotel_api/__init__.py`
- Create: `backend/hotel_api/settings.py`
- Create: `backend/hotel_api/urls.py`
- Create: `backend/hotel_api/wsgi.py`
- Create: `backend/booking/__init__.py`
- Create: `backend/booking/apps.py`
- Modify: `.gitignore` (project root) — add `backend/.env`, `backend/__pycache__/`, `backend/**/__pycache__/`, `backend/*.sqlite3`

**Interfaces:**
- Produces: a MySQL database named `hotel_booking` with the six tables from the schema, reachable from Django via `DATABASES['default']` read from `backend/.env` (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`).

- [ ] **Step 1: Save the schema file**

Create `backend/db/02_normalized_schema.sql` with exactly the SQL the user provided in this conversation (the `DROP DATABASE IF EXISTS hotel_booking` ... through the `v_booking_total` view, unchanged).

- [ ] **Step 2: Create the database**

Run: `mysql -u root < backend/db/02_normalized_schema.sql`
Expected: no error output.

- [ ] **Step 3: Verify the schema landed**

Run: `mysql -u root -e "USE hotel_booking; SHOW TABLES;"`
Expected: `booking`, `booking_room`, `guest`, `payment`, `room`, `room_type`, `v_booking_total` listed.

- [ ] **Step 4: Write `backend/requirements.txt`**

```
Django>=6.0,<7.0
djangorestframework>=3.17,<4.0
django-cors-headers>=4.9,<5.0
PyMySQL>=1.1,<2.0
python-dotenv>=1.0,<2.0
```

- [ ] **Step 5: Write `backend/.env.example`**

```
DB_NAME=hotel_booking
DB_USER=root
DB_PASSWORD=
DB_HOST=127.0.0.1
DB_PORT=3306
```

Copy it to `backend/.env` (not committed) with the same values — matches the local brew MySQL's passwordless root.

- [ ] **Step 6: Django project scaffold**

`backend/manage.py` — standard Django entrypoint, `DJANGO_SETTINGS_MODULE=hotel_api.settings`.
`backend/hotel_api/__init__.py` — at its top:
```python
import pymysql
pymysql.install_as_MySQLdb()
```
(this lets Django's `django.db.backends.mysql` engine run on PyMySQL instead of `mysqlclient`, no native build needed).

`backend/hotel_api/settings.py` — a minimal Django settings module:
- `BASE_DIR`, `SECRET_KEY` (any local dev string), `DEBUG = True`, `ALLOWED_HOSTS = ['*']`
- loads `backend/.env` via `python-dotenv` at the top (`from dotenv import load_dotenv; load_dotenv()`)
- `INSTALLED_APPS` includes `django.contrib.contenttypes`, `django.contrib.staticfiles`, `rest_framework`, `corsheaders`, `booking`
- `MIDDLEWARE` includes `corsheaders.middleware.CorsMiddleware` first, then Django's defaults it needs (`SecurityMiddleware`, `CommonMiddleware`)
- `CORS_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177']`
- `DATABASES['default']` = `{'ENGINE': 'django.db.backends.mysql', 'NAME': os.environ['DB_NAME'], 'USER': os.environ['DB_USER'], 'PASSWORD': os.environ.get('DB_PASSWORD', ''), 'HOST': os.environ['DB_HOST'], 'PORT': os.environ['DB_PORT'], 'OPTIONS': {'charset': 'utf8mb4'}}`
- `ROOT_URLCONF = 'hotel_api.urls'`
- `DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'`

`backend/hotel_api/urls.py` — `urlpatterns = [path('api/', include('booking.urls'))]` (the `booking.urls` module is created in Task 3; leave this import in place, Task 3 adds the file it points to).

`backend/hotel_api/wsgi.py` — standard Django WSGI boilerplate.

`backend/booking/__init__.py` — empty.
`backend/booking/apps.py` — standard `AppConfig` named `booking`.

- [ ] **Step 7: `.gitignore` additions**

Add to the project root `.gitignore`:
```
backend/.env
backend/__pycache__/
backend/**/__pycache__/
backend/*.sqlite3
```

- [ ] **Step 8: Verify the project boots**

Run: `cd backend && pip install -r requirements.txt && python manage.py check`
Expected: `System check identified no issues (0 silenced).` (The `booking` app has no models yet, so this just confirms settings/URLconf load cleanly.)

- [ ] **Step 9: Commit**

```bash
git add backend/db/02_normalized_schema.sql backend/requirements.txt backend/.env.example backend/manage.py backend/hotel_api backend/booking .gitignore
git commit -m "backend: Django project scaffold and real MySQL schema import"
```

---

## Task 2: Models mapped onto the existing schema

**Files:**
- Create: `backend/booking/models.py`

**Interfaces:**
- Consumes: the table/column names fixed by `backend/db/02_normalized_schema.sql` (Task 1).
- Produces: `Guest`, `RoomType`, `Room`, `Booking`, `BookingRoom`, `Payment` model classes, each `managed = False`, usable by the ORM for both reads and writes (DRF serializers and views in later tasks import these by name).

- [ ] **Step 1: Write the six models**

In `backend/booking/models.py`, one class per table, each with `class Meta: managed = False; db_table = '<table name>'`, fields matching the SQL column-for-column (name, type, null/blank, `max_length` from the `VARCHAR` sizes, `decimal_places`/`max_digits` from the `DECIMAL` sizes):

```python
class Guest(models.Model):
    guest_id = models.AutoField(primary_key=True)
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50)
    email = models.CharField(max_length=100, unique=True)
    phone = models.CharField(max_length=20)

    class Meta:
        managed = False
        db_table = 'guest'
```

Repeat for `RoomType` (`room_type`: `room_type_id`, `type_name` unique `CharField(50)`, `capacity` `IntegerField`, `price_per_night` `DecimalField(8,2)`, `description` `CharField(255, null=True, blank=True)`), `Room` (`room`: `room_id`, `room_number` unique `CharField(10)`, `floor` `IntegerField`, `status` `CharField(15, default='Available')`, `room_type` `ForeignKey(RoomType, db_column='room_type_id', on_delete=models.PROTECT)`), `Booking` (`booking`: `booking_id`, `guest` `ForeignKey(Guest, db_column='guest_id', on_delete=models.PROTECT)`, `booking_date` `DateTimeField`, `check_in`/`check_out` `DateField`, `status` `CharField(15, default='Confirmed')`), `BookingRoom` (`booking_room`: `booking_room_id`, `booking` `ForeignKey(Booking, db_column='booking_id', on_delete=models.PROTECT, related_name='bookingroom')`, `room` `ForeignKey(Room, db_column='room_id', on_delete=models.PROTECT)`, `guests_count` `IntegerField`, `price_per_night` `DecimalField(8,2)`), `Payment` (`payment`: `payment_id`, `booking` `ForeignKey(Booking, db_column='booking_id', on_delete=models.PROTECT)`, `amount` `DecimalField(10,2)`, `payment_method` `CharField(15)`, `payment_status` `CharField(10)`, `payment_date` `DateTimeField`).

- [ ] **Step 2: Verify the models match the live schema**

Run: `cd backend && python manage.py shell -c "from booking.models import Guest, RoomType, Room, Booking, BookingRoom, Payment; print([m.objects.count() for m in (Guest, RoomType, Room, Booking, BookingRoom, Payment)])"`
Expected: `[0, 0, 0, 0, 0, 0]` (the schema exists and is empty; no `OperationalError`/`ProgrammingError` about unknown tables or columns).

- [ ] **Step 3: Commit**

```bash
git add backend/booking/models.py
git commit -m "backend: models mapped onto the normalized schema"
```

---

## Task 3: Read endpoints for the six tables

**Files:**
- Create: `backend/booking/serializers.py`
- Create: `backend/booking/views.py`
- Create: `backend/booking/urls.py`

**Interfaces:**
- Consumes: the six models from Task 2.
- Produces: `GET /api/guests/`, `GET /api/room-types/`, `GET /api/rooms/`, `GET /api/bookings/`, `GET /api/booking-rooms/`, `GET /api/payments/`, each returning a JSON array of plain objects whose keys are the model's field names (so the frontend can treat them exactly like the rows `src/db.js`'s old `seed()` produced).

- [ ] **Step 1: Write the serializers**

In `backend/booking/serializers.py`, one `ModelSerializer` per model, `fields = '__all__'`:

```python
class GuestSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guest
        fields = '__all__'
```

Repeat for `RoomTypeSerializer`, `RoomSerializer`, `BookingSerializer`, `BookingRoomSerializer`, `PaymentSerializer`.

- [ ] **Step 2: Write the list views**

In `backend/booking/views.py`, one `generics.ListAPIView` per model:

```python
class GuestListView(generics.ListAPIView):
    queryset = Guest.objects.all()
    serializer_class = GuestSerializer
```

Repeat for the other five (`RoomTypeListView`, `RoomListView`, `BookingListView`, `BookingRoomListView`, `PaymentListView`).

- [ ] **Step 3: Wire the URLs**

`backend/booking/urls.py`:

```python
urlpatterns = [
    path('guests/', GuestListView.as_view()),
    path('room-types/', RoomTypeListView.as_view()),
    path('rooms/', RoomListView.as_view()),
    path('bookings/', BookingListView.as_view()),
    path('booking-rooms/', BookingRoomListView.as_view()),
    path('payments/', PaymentListView.as_view()),
]
```

- [ ] **Step 4: Run the server and verify with curl**

Run: `cd backend && python manage.py runserver` (leave running), then in another shell: `curl -s http://localhost:8000/api/room-types/`
Expected: HTTP 200, body `[]` (schema is empty until Task 4 seeds it).
Repeat for the other five paths — all `200` + `[]`.

- [ ] **Step 5: Verify CORS from a real browser, not curl**

With the Django server still running, open a browser tab on any `http://localhost:517x` page (the Vite dev server from this project, or any page served from that origin) and in its devtools console run:
```js
fetch('http://localhost:8000/api/room-types/').then(r => r.json()).then(console.log)
```
Expected: the request succeeds and logs `[]` — no CORS error in the console. If it fails, the failing origin's exact `http://host:port` must be added to `CORS_ALLOWED_ORIGINS` in `backend/hotel_api/settings.py` and the server restarted.

- [ ] **Step 6: Commit**

```bash
git add backend/booking/serializers.py backend/booking/views.py backend/booking/urls.py
git commit -m "backend: read-only list endpoints for the six tables"
```

---

## Task 4: Seed data and the reset-demo endpoint

**Files:**
- Create: `backend/booking/seed.py`
- Modify: `backend/booking/views.py` — add `reset_demo` view
- Modify: `backend/booking/urls.py` — add its route

**Interfaces:**
- Consumes: the six models (Task 2).
- Produces: `run_seed()` (importable, used again by Task 5/6's tests and by `reset_demo`); `POST /api/reset-demo/` returning `{"ok": true}`.

- [ ] **Step 1: Write `backend/booking/seed.py`**

A `SEED` dict holding the exact same rows as `src/db.js`'s `seed()` (3 guests — Amina Sadykova/amina@example.com, Daniel Brooks/daniel@example.com, Mei Tanaka/mei@example.com; 3 room types — Standard/Deluxe/Suite with the same capacity/price/description; 6 rooms — 101/102/103/201/202/301; 5 bookings and their 5 booking_room lines and 5 payments, same ids/dates/amounts/statuses as the JS `seed()` function). Then:

```python
def run_seed():
    with connection.cursor() as cur:
        cur.execute('SET FOREIGN_KEY_CHECKS=0')
        for table in ('payment', 'booking_room', 'booking', 'room', 'room_type', 'guest'):
            cur.execute(f'TRUNCATE TABLE {table}')
        cur.execute('SET FOREIGN_KEY_CHECKS=1')
    Guest.objects.bulk_create([Guest(**row) for row in SEED['guest']])
    RoomType.objects.bulk_create([RoomType(**row) for row in SEED['room_type']])
    Room.objects.bulk_create([Room(room_id=r['room_id'], room_number=r['room_number'], floor=r['floor'], status=r['status'], room_type_id=r['room_type_id']) for r in SEED['room']])
    Booking.objects.bulk_create([Booking(booking_id=b['booking_id'], guest_id=b['guest_id'], booking_date=b['booking_date'], check_in=b['check_in'], check_out=b['check_out'], status=b['status']) for b in SEED['booking']])
    BookingRoom.objects.bulk_create([BookingRoom(booking_room_id=l['booking_room_id'], booking_id=l['booking_id'], room_id=l['room_id'], guests_count=l['guests_count'], price_per_night=l['price_per_night']) for l in SEED['booking_room']])
    Payment.objects.bulk_create([Payment(payment_id=p['payment_id'], booking_id=p['booking_id'], amount=p['amount'], payment_method=p['payment_method'], payment_status=p['payment_status'], payment_date=p['payment_date']) for p in SEED['payment']])
```

(`bulk_create` with explicit `*_id` primary keys given — MySQL accepts explicit `AUTO_INCREMENT` values; order matters because of the foreign keys.)

- [ ] **Step 2: Add the `reset_demo` view**

In `backend/booking/views.py`:

```python
@api_view(['POST'])
def reset_demo(request):
    run_seed()
    return Response({'ok': True})
```

- [ ] **Step 3: Wire the URL**

In `backend/booking/urls.py`, add: `path('reset-demo/', reset_demo),`

- [ ] **Step 4: Verify**

Run: `curl -s -X POST http://localhost:8000/api/reset-demo/`
Expected: `{"ok":true}`.
Then: `curl -s http://localhost:8000/api/guests/ | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"`
Expected: `3`. Repeat the count check for `room-types` (3), `rooms` (6), `bookings` (5), `booking-rooms` (5), `payments` (5).

- [ ] **Step 5: Commit**

```bash
git add backend/booking/seed.py backend/booking/views.py backend/booking/urls.py
git commit -m "backend: seed data and reset-demo endpoint"
```

---

## Task 5: The booking transaction endpoint

**Files:**
- Modify: `backend/booking/views.py` — add `book` view

**Interfaces:**
- Consumes: `Guest`, `RoomType`, `Room`, `Booking`, `BookingRoom`, `Payment` (Task 2).
- Produces: `POST /api/book/`, body `{"guest": {"first_name","last_name","email","phone"}, "ci", "co", "rooms": [{"room_id","room_number","price","guests_count"}], "total", "method", "cardDigits"}`, returning on success `{"ok": true, "bookingId": <int>, "log": [...], "total": <number>}` and on failure `{"ok": false, "message": <str>, "log": [...]}` — the exact shape `CheckoutPage.jsx` already renders.

- [ ] **Step 1: Write the `book` view**

In `backend/booking/views.py`:

```python
@api_view(['POST'])
def book(request):
    req = request.data
    log = []

    def step(label, fn):
        try:
            out = fn()
            log.append({'label': label, 'ok': True})
            return out
        except Exception as err:
            log.append({'label': label, 'ok': False, 'detail': str(err)})
            raise

    try:
        with transaction.atomic():
            def check_rooms_open():
                for r in req['rooms']:
                    row = Room.objects.select_for_update().get(room_id=r['room_id'])
                    if row.status != 'Available':
                        raise ValueError(f"Room {r['room_number']} is closed for maintenance.")
            step('Lock the chosen rooms and check they are open', check_rooms_open)

            def check_no_overlap():
                room_ids = [r['room_id'] for r in req['rooms']]
                active = Booking.objects.filter(
                    status__in=['Confirmed', 'CheckedIn'],
                    check_in__lt=req['co'], check_out__gt=req['ci'],
                    bookingroom__room_id__in=room_ids,
                )
                if active.exists():
                    blocked_room = BookingRoom.objects.filter(booking__in=active, room_id__in=room_ids).first()
                    number = next(r['room_number'] for r in req['rooms'] if r['room_id'] == blocked_room.room_id)
                    raise ValueError(f"Room {number} was just booked by someone else for overlapping dates.")
            step('Check that no active booking overlaps these dates', check_no_overlap)

            def find_or_create_guest():
                g = Guest.objects.filter(email__iexact=req['guest']['email']).first()
                if g:
                    g.first_name = req['guest']['first_name']
                    g.last_name = req['guest']['last_name']
                    g.phone = req['guest']['phone']
                    g.save()
                else:
                    g = Guest.objects.create(**req['guest'])
                return g.guest_id
            guest_id = step('Find or create the guest', find_or_create_guest)

            def insert_booking():
                b = Booking.objects.create(guest_id=guest_id, check_in=req['ci'], check_out=req['co'], status='Confirmed')
                return b.booking_id
            booking_id = step('Insert the booking', insert_booking)

            def insert_room_lines():
                for r in req['rooms']:
                    BookingRoom.objects.create(booking_id=booking_id, room_id=r['room_id'], guests_count=r['guests_count'], price_per_night=r['price'])
            step('Insert one room line for each room', insert_room_lines)

            def insert_payment():
                if req['method'] == 'Card' and str(req['cardDigits']).endswith('0000'):
                    raise ValueError('The bank declined this card.')
                Payment.objects.create(booking_id=booking_id, amount=req['total'], payment_method=req['method'], payment_status='Paid')
            step('Insert the payment', insert_payment)

            log.append({'label': 'COMMIT', 'ok': True, 'final': True, 'detail': 'Booking, rooms, and payment saved together.'})
        return Response({'ok': True, 'bookingId': booking_id, 'log': log, 'total': req['total']})
    except Exception as err:
        log.append({'label': 'ROLLBACK', 'ok': False, 'final': True, 'detail': 'Nothing was saved, so no room is blocked without payment.'})
        return Response({'ok': False, 'message': str(err), 'log': log})
```

`check_no_overlap`'s `bookingroom__room_id__in` lookup relies on `related_name='bookingroom'` set on `BookingRoom.booking` in Task 2.

- [ ] **Step 2: Wire the URL**

In `backend/booking/urls.py`, add: `path('book/', book),`

- [ ] **Step 3: Verify — happy path**

Run: `curl -s -X POST http://localhost:8000/api/book/ -H 'Content-Type: application/json' -d '{"guest":{"first_name":"Test","last_name":"User","email":"test@example.com","phone":"+1 555 123 4567"},"ci":"2026-12-20","co":"2026-12-22","rooms":[{"room_id":2,"room_number":"102","price":60,"guests_count":2}],"total":120,"method":"Card","cardDigits":"4242424242424242"}'`
Expected: `"ok":true` with a `"bookingId"` and a `log` ending in `"COMMIT"`.
Then: `curl -s http://localhost:8000/api/bookings/ | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"` → `6` (one more than the seeded 5).

- [ ] **Step 4: Verify — declined card rolls back**

Run the same curl as Step 3 but with `"cardDigits":"4242424242420000"` and a still-available room/date combination.
Expected: `"ok":false,"message":"The bank declined this card."`, log ends in `"ROLLBACK"`.
Then: confirm `GET /api/bookings/` count is unchanged from before this request (no new row left behind).

- [ ] **Step 5: Verify — overlapping booking is rejected (Review Focus)**

Run the Step 3 curl once (succeeds, books room 2 for 2026-12-20..22), then run it again with the same room/dates.
Expected second call: `"ok":false`, message mentions "booked by someone else", log's second step is `"ok":false`.

- [ ] **Step 6: Verify — a room in Maintenance is rejected (Review Focus)**

`curl -s -X POST http://localhost:8000/api/rooms/3/toggle-maintenance/` (this endpoint is added in Task 6 — do this verification after Task 6 instead, or temporarily flip the row with `mysql -u root -e "USE hotel_booking; UPDATE room SET status='Maintenance' WHERE room_id=3;"`), then book room 3.
Expected: `"ok":false`, message mentions "closed for maintenance". Restore the row afterward (`UPDATE room SET status='Available' WHERE room_id=3;` or re-run `reset-demo`).

- [ ] **Step 7: Verify — same email, different case reuses the guest (Review Focus)**

Book once with `"email":"Case@Example.com"`, note the returned guest's booking shows under that guest; book again with `"email":"case@example.com"` (different room/dates). Then: `curl -s http://localhost:8000/api/guests/ | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for g in d if g['email'].lower()=='case@example.com'))"`
Expected: `1` (not 2 — the second booking reused the same guest row).

- [ ] **Step 8: Commit**

```bash
git add backend/booking/views.py backend/booking/urls.py
git commit -m "backend: transactional booking endpoint with rollback"
```

---

## Task 6: Cancel and toggle-maintenance endpoints

**Files:**
- Modify: `backend/booking/views.py` — add `cancel_booking`, `toggle_maintenance`
- Modify: `backend/booking/urls.py` — add their routes

**Interfaces:**
- Consumes: `Booking`, `Payment`, `Room` (Task 2).
- Produces: `POST /api/bookings/<int:booking_id>/cancel/` → `{"refunded": <bool>}`; `POST /api/rooms/<int:room_id>/toggle-maintenance/` → `{"status": "Available"|"Maintenance"}`.

- [ ] **Step 1: Write `cancel_booking`**

```python
@api_view(['POST'])
def cancel_booking(request, booking_id):
    b = Booking.objects.filter(booking_id=booking_id, status='Confirmed').first()
    if not b:
        return Response({'refunded': False})
    b.status = 'Cancelled'
    b.save()
    refunded = False
    for p in Payment.objects.filter(booking_id=booking_id, payment_status='Paid'):
        p.payment_status = 'Refunded'
        p.save()
        refunded = True
    return Response({'refunded': refunded})
```

- [ ] **Step 2: Write `toggle_maintenance`**

```python
@api_view(['POST'])
def toggle_maintenance(request, room_id):
    r = Room.objects.get(room_id=room_id)
    r.status = 'Maintenance' if r.status == 'Available' else 'Available'
    r.save()
    return Response({'status': r.status})
```

- [ ] **Step 3: Wire the URLs**

In `backend/booking/urls.py`, add:
```python
path('bookings/<int:booking_id>/cancel/', cancel_booking),
path('rooms/<int:room_id>/toggle-maintenance/', toggle_maintenance),
```

- [ ] **Step 4: Verify `cancel_booking`**

Run: `curl -s -X POST http://localhost:8000/api/bookings/1/cancel/`
Expected: `{"refunded":true}` (booking 1 was seeded `Confirmed` with a `Paid` payment).
Then: `curl -s http://localhost:8000/api/bookings/ | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(b['status'] for b in d if b['booking_id']==1))"` → `Cancelled`.

- [ ] **Step 5: Verify `toggle_maintenance`**

Run: `curl -s -X POST http://localhost:8000/api/rooms/1/toggle-maintenance/`
Expected: `{"status":"Maintenance"}`. Run it again, expect `{"status":"Available"}`.

- [ ] **Step 6: Reset the demo data back to clean**

Run: `curl -s -X POST http://localhost:8000/api/reset-demo/` (undoes the cancel/toggle/booking calls made across Tasks 4-6's verification steps).

- [ ] **Step 7: Commit**

```bash
git add backend/booking/views.py backend/booking/urls.py
git commit -m "backend: cancel-booking and toggle-maintenance endpoints"
```

---

## Task 7: `src/db.js` — swap localStorage for the API

**Files:**
- Modify: `src/db.js`

**Interfaces:**
- Consumes: the backend's six read endpoints and four action endpoints (Tasks 3-6), reachable at `http://localhost:8000/api/`.
- Produces: `getDb()` stays synchronous, same return shape as before. `initDb(): Promise<void>` is new — must resolve (or reject) once before any page reads `getDb()`. `resetDb`, `runBookingTransaction`, `cancelBooking`, `toggleRoomMaintenance` keep their exact names and parameters but now return a `Promise` of what they returned before. Every other export (`subscribe`, `blockedRoomIds`, `roomsOfType`, `freeRooms`, `typeOf`, `validateSearch`, `getSelection`, `bookingDetails`, `todayISO`, `addDays`, `nights`, `fmtDate`, `money`, `plural`, `ref`, `TABLES`, `loadSession`, `saveSession`) is unchanged.

- [ ] **Step 1: Add the API base and a small fetch helper**

At the top of `src/db.js`, after the existing constants:
```js
const API_BASE = 'http://localhost:8000/api';

async function apiGet(path) {
  const res = await fetch(`${API_BASE}/${path}/`);
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}/${path}/`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status})`);
  return res.json();
}
```

- [ ] **Step 2: Replace `loadDb`/`persist`/the module-load line with an async `loadDb` and a new `initDb`**

Delete `persist`, `isValidDb`, the `seed()` function's use as a local fallback, and the `let db = loadDb();` top-level call (it can no longer run synchronously at module load). Replace with:

```js
let db = { guest: [], room_type: [], room: [], booking: [], booking_room: [], payment: [] };

async function loadDb() {
  const [guest, room_type, room, booking, booking_room, payment] = await Promise.all(
    ['guests', 'room-types', 'rooms', 'bookings', 'booking-rooms', 'payments'].map(apiGet)
  );
  db = { guest, room_type, room, booking, booking_room, payment };
  return db;
}

export async function initDb() {
  await loadDb();
  notify();
}
```

(`seed()` and its exact data can stay in the file unused, or be deleted — it now lives in `backend/booking/seed.py` as the source of truth; prefer deleting it here to avoid two copies drifting apart.)

- [ ] **Step 3: Rewrite `resetDb`**

```js
export async function resetDb() {
  await apiPost('reset-demo');
  await loadDb();
  notify();
}
```

- [ ] **Step 4: Rewrite `runBookingTransaction`**

```js
export async function runBookingTransaction(req) {
  const result = await apiPost('book', {
    guest: req.guest, ci: req.ci, co: req.co, rooms: req.rooms,
    total: req.total, method: req.method, cardDigits: req.cardDigits
  });
  await loadDb();
  notify();
  return result;
}
```

(The local `step`/`nextId`/`nowStamp` helpers and the whole hand-rolled transaction body are deleted — that logic now lives in `backend/booking/views.py`'s `book` view from Task 5.)

- [ ] **Step 5: Rewrite `cancelBooking` and `toggleRoomMaintenance`**

```js
export async function cancelBooking(id) {
  const { refunded } = await apiPost(`bookings/${id}/cancel`);
  await loadDb();
  notify();
  return refunded;
}

export async function toggleRoomMaintenance(roomId) {
  await apiPost(`rooms/${roomId}/toggle-maintenance`);
  await loadDb();
  notify();
}
```

- [ ] **Step 6: Verify the file is syntactically sound**

Run: `npm run build`
Expected: builds successfully with no errors (this does not exercise the network calls, only confirms the rewritten module is valid JS/ESM and nothing still references a deleted helper — `grep -n "persist\|isValidDb\|nextId\|nowStamp\|STORAGE_KEY" src/db.js` should show no remaining uses outside intentional deletions).

- [ ] **Step 7: Commit**

```bash
git add src/db.js
git commit -m "frontend: db.js talks to the Django API instead of localStorage"
```

---

## Task 8: Page call sites, loading/error state, and full end-to-end verification

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/CheckoutPage.jsx`
- Modify: `src/pages/MinePage.jsx`
- Modify: `src/pages/StaffPage.jsx`

**Interfaces:**
- Consumes: `initDb()` (new, Task 7), `resetDb()`/`runBookingTransaction()`/`cancelBooking()`/`toggleRoomMaintenance()` (now `Promise`-returning, Task 7).

- [ ] **Step 1: `App.jsx` — gate rendering on `initDb()`**

Add `import { initDb } from './db.js';` alongside the existing `db.js` import. Add two pieces of state right after the existing ones: `const [ready, setReady] = useState(false);` and `const [loadError, setLoadError] = useState('');`. Add an effect that runs once:

```js
useEffect(() => {
  initDb().then(() => setReady(true)).catch((err) => setLoadError(err.message));
}, []);
```

At the top of the returned JSX (before the `<header>`), branch:
```jsx
if (loadError) {
  return <p style={{ padding: 24 }}>Couldn't reach the backend ({loadError}). Is `python manage.py runserver` running on port 8000?</p>;
}
if (!ready) {
  return <p style={{ padding: 24 }}>Loading…</p>;
}
```
(Plain inline style, matching the spec's "no new design system" constraint — this project has no existing loading-state class to reuse.)

- [ ] **Step 2: `App.jsx` — await the reset button, with a visible error on network failure**

Add `const [resetError, setResetError] = useState('');` near the other state. Change the footer's `onClick` from a sync arrow function to:
```jsx
onClick={async () => {
  setResetError('');
  try {
    await resetDb();
    setSel({});
    setLastEmail('');
  } catch (err) {
    setResetError(err.message);
  }
}}
```
Add `<p className="status" role="status">{resetError}</p>` right after the "Reset demo data" button in the footer — reuses the `.status` class already used elsewhere (e.g. `MinePage.jsx`), no new CSS.

- [ ] **Step 3: `CheckoutPage.jsx` — await the booking call, with the existing failure UI on a network error**

Add `const [submitting, setSubmitting] = useState(false);` near the other `useState` calls. Change `function submit(e) {` to `async function submit(e) {`. Where `const result = runBookingTransaction({...})` is called, wrap it:
```js
setSubmitting(true);
let result;
try {
  result = await runBookingTransaction({ ... });
} catch (err) {
  setSubmitting(false);
  setFailure({ message: err.message, log: [] });
  return;
}
setSubmitting(false);
```
(reuses the existing `failure`/`tx-fail` rendering already in this file — no new error UI). On the submit `<button type="submit" className="btn btn-primary">Confirm and pay</button>`, add `disabled={submitting}` and change its label to `{submitting ? 'Processing…' : 'Confirm and pay'}`.

- [ ] **Step 4: `MinePage.jsx` — await the cancel call, with the existing status line on a network error**

Change `function onCancel(id) {` to `async function onCancel(id) {`:
```js
async function onCancel(id) {
  try {
    const refunded = await cancelBooking(id);
    setStatus('Booking ' + ref(id) + ' cancelled.' + (refunded ? ' The payment is marked as refunded.' : ''));
  } catch (err) {
    setStatus('Could not reach the backend: ' + err.message);
  }
}
```
(reuses the existing `status` paragraph already rendered in this file).

- [ ] **Step 5: `StaffPage.jsx` — await the maintenance toggle, with a visible error on network failure**

Add `const [error, setError] = useState('');` near the top of the component, alongside `s`/`datesOk`/`blocked`. Change the button's handler:
```jsx
onClick={async () => {
  setError('');
  try {
    await toggleRoomMaintenance(r.room_id);
  } catch (err) {
    setError(err.message);
  }
}}
```
Add `{error && <p className="form-error dark" role="alert">{error}</p>}` right after the existing `<p className="form-error dark" ...>` line that shows the date-range validation error — reuses that class, no new CSS.

- [ ] **Step 6: Full end-to-end verification — backend up**

Ensure the backend is seeded and running: `curl -s -X POST http://localhost:8000/api/reset-demo/` then `cd backend && python manage.py runserver` (leave running). In a second terminal: `npm run dev` (leave running). Open the printed `localhost:51xx` URL in a browser.

Run through, confirming each against the live site AND a `mysql -u root -e "USE hotel_booking; SELECT ...;"` check where noted:

1. Book a room end to end with a normal card → confirmation screen shows COMMIT log; `SELECT * FROM booking ORDER BY booking_id DESC LIMIT 1;` shows the new row.
2. Book again with a card ending `0000` → confirmation/failure screen shows ROLLBACK; the booking count in MySQL is unchanged from before this attempt.
3. Cancel a booking from My bookings → UI shows it Cancelled/Refunded; `SELECT status FROM booking WHERE booking_id=<id>;` confirms.
4. Toggle a room to Maintenance in Staff view → it stops appearing bookable in Book a room; `SELECT status FROM room WHERE room_id=<id>;` confirms, then toggle it back.
5. Click "Reset demo data" → Staff view's six tables and Book a room's availability match the original seed again.

- [ ] **Step 7: Full end-to-end verification — backend down**

Stop the Django server (Ctrl-C). Reload the frontend page.
Expected: the plain-text "Couldn't reach the backend…" message from Step 1 appears — no blank page, no unhandled error in the console beyond the fetch failure itself.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/pages/CheckoutPage.jsx src/pages/MinePage.jsx src/pages/StaffPage.jsx
git commit -m "frontend: await the now-async db.js calls, add a load/error gate"
```
