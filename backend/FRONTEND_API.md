# Frontend API (staff / admin / bookings)

Added on top of the auth API in `AUTH.md`. Nothing in `views.py`, `auth.py` or `models.py` was changed:
the new code lives in `booking/roles.py`, `booking/frontend_api.py`, `booking/frontend_urls.py`
and is wired in with one line in `hotel_api/urls.py`.

## Setup (once)

```bash
mysql -u root -p < db/04_add_guest_role.sql   # new table guest_role (role + blocked flag)
mysql -u root -p < db/05_business_rules.sql   # database refuses double booking, too many guests, past check-in
mysql -u root -p < db/06_room_reviews.sql     # reviews (see REVIEWS_API.md)
mysql -u root -p < db/07_login_lock.sql       # login lock: 5 wrong passwords -> 15 minutes
mysql -u root -p < db/08_profile_photo.sql    # profile photos (PHOTOS_AND_CHAT_API.md)
mysql -u root -p < db/09_chat.sql             # support chat
mysql -u root -p < db/10_review_moderation.sql # reviews wait for admin approval
mysql -u root -p < db/08_profile_photo.sql    # profile photos (PHOTOS_AND_CHAT_API.md)
mysql -u root -p < db/09_chat.sql             # chat customer <-> admin (PHOTOS_AND_CHAT_API.md)
python manage.py seed_demo                      # guests, rooms, bookings (password demo12345)
python manage.py seed_roles                     # admin@junipercourt.example / Admin12345, staff@junipercourt.example / Staff12345
```

## Run

```bash
cd backend && python manage.py runserver        # http://127.0.0.1:8000
npm run dev                                      # from the project root; Vite proxies /api to :8000
```

## Roles

`guest_role(guest_id, role, is_active)`. A guest without a row is an active `guest`.
`staff` and `admin` are guests with a row. Staff can do front-desk work, and admin can do everything.

## Endpoints (all need `Authorization: Bearer <token>`)

| Method | URL | Who | What |
|---|---|---|---|
| GET / PATCH | /api/account/ | any account | current account with `role`; PATCH first_name, last_name, phone |
| POST | /api/account/password/ | any account | old_password, new_password |
| POST | /api/bookings/create/ | any account | check_in, check_out, rooms[{room_id, guests_count}], payment_method, card_number. One transaction; 201 or 409 + step log |
| POST | /api/bookings/{id}/cancel/ | owner or staff | Confirmed → Cancelled, payment → Refunded |
| POST | /api/bookings/{id}/check-in/ | staff | Confirmed → CheckedIn |
| POST | /api/bookings/{id}/check-out/ | staff | CheckedIn → Completed |
| POST | /api/rooms/{id}/maintenance/ | staff | Available ↔ Maintenance |
| PATCH | /api/room-types/{id}/price/ | admin | price_per_night |
| GET | /api/admin/accounts/ | admin | guests that have a password, with role |
| PATCH / DELETE | /api/admin/accounts/{id}/ | admin | role, is_active / remove the login (guest row stays) |
| POST | /api/admin/reset-demo/ | admin | runs seed_demo + seed_roles |

## Forgot password (no login needed)

| Method | URL | What |
|---|---|---|
| POST | /api/auth/password-reset/ | email. Always the same answer. Emails a link `FRONTEND_URL/#reset?token=…` (1 hour, one use). No SMTP set → the email is printed in the runserver console; with DEBUG on the token is also returned as `debug_token` |
| POST | /api/auth/password-reset/confirm/ | token, new_password |

Code: `booking/password_reset.py`. `FRONTEND_URL` defaults to http://localhost:5173.

A blocked account gets 403 everywhere. The demo bank declines a card number that ends in 0000.

## Tests

`USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking` runs 79 tests (8 auth + 11 frontend API + 9 privacy/phone + 19 reviews + 22 admin + 10 login lock).

Profile photos and chat: see `PHOTOS_AND_CHAT_API.md`. Room reviews: see `REVIEWS_API.md`. Staff admin panel: see `ADMIN.md`.

## Login lock (week 12)

`POST /api/auth/login/`: after **5 wrong passwords in a row** the account is locked for **15 minutes** (`booking/login_lock.py`, table `db/07_login_lock.sql`).

| Situation | Answer |
|---|---|
| wrong password, 1st–4th time | 401 `Invalid email or password.` |
| 5th wrong password | 423 `Too many wrong passwords. This account is locked for 15 more minutes. Try again later or reset your password.` + `"locked": true` |
| any password while locked | 423, same message with the minutes left |
| right password (not locked) | 200, counter back to 0 |
| unknown e-mail | 401 `Invalid email or password.`, nothing stored (no account enumeration) |
| password reset by e-mail | lock removed |
| admin: `PATCH /api/admin/accounts/<id>/` `{"unlock": true}` | lock removed; `GET /api/admin/accounts/` shows `locked_minutes` |

This is separate from the Django admin site (`/admin/`), which has its own lock (`admin_site.py`).
