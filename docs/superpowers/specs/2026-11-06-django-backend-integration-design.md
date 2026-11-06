# Django + MySQL backend for Hotel Booking System

Status: approved by user, ready for implementation planning
Date: 2026-11-06
Scope owner: frontend (this repo, Mark's part)

## Goal

Replace the current fake "database" (an in-memory object mirrored to
`localStorage`) with a real one: the normalized MySQL schema the user
provided (`guest`, `room_type`, `room`, `booking`, `booking_room`, `payment`),
served through a small Django + Django REST Framework API, consumed by the
existing React frontend. This is for a **local defense demo only** — no
deployment, no hosting, no auth hardening. The person runs
`python manage.py runserver` and `npm run dev` side by side on their own
machine.

## Non-goals

- No deployment/hosting of any kind.
- No real authentication (the prototype's "log in with just an email" stays
  exactly as it is — Django does not gatekeep anything).
- No changes to the visual design, CSS, or page structure.
- No new features — this is a swap of the storage layer, not a product change.
- No Docker. Two processes, started manually, is enough for a demo.

## Architecture

```
┌─────────────────────┐        fetch()         ┌──────────────────────┐        SQL         ┌──────────────┐
│  React (Vite)        │ ─────────────────────▶ │  Django + DRF         │ ─────────────────▶ │  MySQL        │
│  src/db.js            │ ◀───────────────────── │  backend/              │ ◀───────────────── │  hotel_booking │
│  (same public API)    │        JSON             │  (views, serializers)  │                     │  (exact schema │
└─────────────────────┘                         └──────────────────────┘                     │  from the SQL  │
                                                                                               │  file)         │
                                                                                               └──────────────┘
```

The MySQL schema is created by running the user's SQL file verbatim —
Django does **not** generate it via migrations. Django's models are declared
`managed = False` and mapped onto the exact table/column names from that
file, so the `.sql` file stays the single source of truth for the schema
(important for defense: "this is literally the schema from the SQL file,
Django just reads and writes it").

## Repository layout

```
project/                      (existing, untouched structure below src/)
  backend/
    manage.py
    requirements.txt
    hotel_api/                 Django project package (settings, urls, wsgi)
      settings.py
      urls.py
    booking/                   the one Django app
      models.py                 managed=False models: Guest, RoomType, Room, Booking, BookingRoom, Payment
      serializers.py
      views.py                  list endpoints + the 4 action endpoints
      urls.py
      seed.py                   the same demo dataset db.js seeds today
    db/
      02_normalized_schema.sql   <- the file the user pasted, saved verbatim
    .env.example                DB_NAME / DB_USER / DB_PASSWORD / DB_HOST
  src/                        (existing frontend, unchanged except db.js + 4 call sites)
```

## API surface

Base URL in dev: `http://localhost:8000/api/`. CORS opened for
`http://localhost:5173` (and the other Vite ports already used in this
project) via `django-cors-headers`, which is already installed.

Read endpoints (plain DRF `ListAPIView`, no pagination — the dataset is tiny):

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/guests/` | all guest rows |
| GET | `/api/room-types/` | all room_type rows |
| GET | `/api/rooms/` | all room rows |
| GET | `/api/bookings/` | all booking rows |
| GET | `/api/booking-rooms/` | all booking_room rows |
| GET | `/api/payments/` | all payment rows |

One call on app load (`Promise.all` of the six) replaces today's
`localStorage.getItem` + seed fallback.

Action endpoints (mirror the four mutating functions in `db.js` 1:1):

| Method | Path | Body | Mirrors |
| --- | --- | --- | --- |
| POST | `/api/book/` | `{guest, ci, co, rooms, total, method, cardDigits}` | `runBookingTransaction` |
| POST | `/api/bookings/<id>/cancel/` | — | `cancelBooking` |
| POST | `/api/rooms/<id>/toggle-maintenance/` | — | `toggleRoomMaintenance` |
| POST | `/api/reset-demo/` | — | `resetDb` |

`/api/book/` is the one with real logic. It reimplements the exact step
sequence `runBookingTransaction` already has, inside
`transaction.atomic()`, and returns the same shape the frontend already
renders (`{ok, bookingId, log, total}` / `{ok:false, message, log}`):

1. Lock the chosen rooms and check they're `Available` (`SELECT ... FOR
   UPDATE` inside the atomic block).
2. Check no active (`Confirmed`/`CheckedIn`) booking overlaps the dates for
   any of those rooms.
3. Find or create the guest by email.
4. Insert the booking row.
5. Insert one `booking_room` row per room.
6. Insert the payment row — a card number ending in `0000` raises on
   purpose, same as today, to demonstrate the rollback.
7. On any failure, the exception propagates out of `transaction.atomic()`,
   MySQL rolls back, and the view catches it to build the `ROLLBACK` log
   entry and return `ok: false`.

`/api/reset-demo/` truncates all six tables and re-inserts the same seed
rows `db.js`'s `seed()` has today (same guests, rooms, bookings, payments),
so the existing demo script ("try amina@example.com", the declined-card
scenario, etc.) behaves identically.

## Frontend changes

`src/db.js` keeps its exact public API (same exported function names) so
pages barely change. Internally:

- `loadDb()` becomes `async`: fetches the six list endpoints in parallel,
  assembles the same `{guest, room_type, room, booking, booking_room,
  payment}` shape the in-memory `db` already has, and is called once from a
  new top-level `initDb()` that `App.jsx` awaits before first render (a
  small "Loading…" state, matching the project's existing plain style).
- `getDb()` stays synchronous — it returns the last-fetched in-memory
  snapshot, exactly as it returns the last-loaded `localStorage` snapshot
  today. All the pure helpers (`blockedRoomIds`, `freeRooms`, `getSelection`,
  `bookingDetails`, etc.) are untouched — they only ever read that snapshot.
- `runBookingTransaction`, `cancelBooking`, `toggleRoomMaintenance`,
  `resetDb` become `async`: each does one `fetch` to its endpoint, then
  re-runs `loadDb()` to resync the in-memory snapshot before resolving
  (simplest possible cache strategy — always refetch everything after a
  write; the dataset is tiny, this is cheap).
- `subscribe`/`notify` stay as they are; `notify()` fires after the resync
  so React re-renders with fresh data.
- `loadSession`/`saveSession` (the guest's logged-in email) stay exactly as
  they are, in `localStorage` — that's client-only UI state, not part of the
  schema, and out of scope here.

Four call sites need `await` added (identified by grep, confirmed minimal):

- `src/pages/CheckoutPage.jsx` — `runBookingTransaction(...)` in the submit
  handler becomes `await runBookingTransaction(...)`, handler becomes
  `async`, submit button disables while in flight.
- `src/pages/MinePage.jsx` — `cancelBooking(id)` becomes `await
  cancelBooking(id)` in its click handler.
- `src/pages/StaffPage.jsx` — `toggleRoomMaintenance(r.room_id)` becomes
  `await toggleRoomMaintenance(r.room_id)`.
- `src/App.jsx` — the "Reset demo data" footer button's `resetDb()` becomes
  `await resetDb()`.

Each of these four gets a minimal inline "working…" disabled state on its
button while the request is in flight, consistent with the project's
existing plain button styling — no new design system.

## Error handling

- Network/server error on initial load (`initDb()` fails) → the app shows a
  one-line plain-text error in place of the page ("Couldn't reach the
  backend. Is `python manage.py runserver` running?") instead of a blank
  screen or a crash — this is a local demo, so a clear "start the backend"
  message is more useful than a polished error boundary.
- Network/server error on a mutating call → caught in the four call sites
  above and shown via the same `tx-fail` / `status` UI patterns already used
  for the declined-card case, so no new error UI is introduced.
- Django side: the `/api/book/` view catches the deliberate decline
  exception and any DB error the same way, always returning JSON (never a
  raw 500 traceback) so the frontend's existing log-rendering code keeps
  working unchanged.

## Testing

Given this is a demo for a defense, not production code, testing is manual
and scenario-based, re-running the exact scenarios already verified earlier
in this project against the old `localStorage` version:

1. `mysql` import of `backend/db/02_normalized_schema.sql`, confirm the six
   tables exist with `SHOW TABLES`.
2. `python manage.py runserver` + `npm run dev`; load the site; confirm
   Standard/Deluxe/Suite rooms show with the seeded availability.
3. Full booking flow with a normal card → confirmation screen shows the
   same COMMIT log as before, and `SELECT * FROM booking` in MySQL shows the
   new row.
4. Booking with a card ending `0000` → confirmation shows ROLLBACK, and MySQL
   confirms no new `booking`/`payment` row was left behind.
5. Cancel a booking from My bookings → `booking.status` and
   `payment.payment_status` update in MySQL, UI reflects it.
6. Toggle a room to Maintenance in Staff view → `room.status` updates in
   MySQL, the room stops showing as bookable.
7. "Reset demo data" → all six tables are back to the seed rows.
8. Stop the Django server, reload the frontend → confirm the plain-text
   "can't reach backend" message appears instead of a blank page.

## Out of scope / explicitly deferred

- `v_booking_total` (the SQL view) is not wired into Django at all — the
  frontend already computes totals in JS from `booking_room` rows, so the
  view would be redundant for this demo. Worth mentioning at the defense as
  "the view exists in the schema for direct SQL querying; the app computes
  the same total in the data layer" — not a gap, a deliberate choice.
- No pagination, filtering, or search on the API — the dataset is small
  (a handful of rows per table) and the frontend already loads everything at
  once today.
- No automated test suite for the Django side, matching the "manual,
  scenario-based" testing already used for the rest of this project.
