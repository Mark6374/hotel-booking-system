# Registration & Login API

Setup (existing database): run `db/03_add_guest_password.sql`. Fresh install: `db/02_normalized_schema.sql` already has the column.
Then `python manage.py seed_demo` — demo guests (saltanat@gmail.com, daniel@example.com, mei@example.com) log in with password `demo12345`.

| Method | URL | Body | Result |
|---|---|---|---|
| POST | /api/auth/register/ | first_name, last_name, email, phone, password (min 8, not all digits) | 201 `{token, guest}` / 400 field errors |
| POST | /api/auth/login/ | email, password | 200 `{token, guest}` / 401 `{detail}` |
| GET | /api/auth/me/ | header `Authorization: Bearer <token>` | 200 guest / 401 |

Notes: passwords are stored hashed (PBKDF2); tokens are signed, valid 7 days, stateless (logout = frontend discards the token); auth endpoints are rate-limited to 20/min per IP; emails are case-insensitive.

Tests (no MySQL needed): `USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking`
