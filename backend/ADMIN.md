# Django admin panel (hotel staff)

Open `http://127.0.0.1:8000/admin/` (path set by `DJANGO_ADMIN_URL`). It is for hotel employees. It uses its own
Django users, separate from the website's guest accounts (`guest` table).

## First-time setup
```bash
pip install -r requirements.txt
mysql -u root -p < db/02_normalized_schema.sql      # then 04, 05, 06 (in this order)
python manage.py migrate                            # admin users, sessions, audit log tables
python manage.py createsuperuser
python manage.py setup_admin_groups                 # Front desk, Review moderators, Managers (safe to repeat)
python manage.py seed_demo && python manage.py seed_roles    # optional demo data
```
Note: `02_normalized_schema.sql` drops the database, so run `migrate` and `createsuperuser` again after it.
Give people their rights in Admin -> Users -> Groups (tick *Staff status*, pick a group).

## What is in it
* **Dashboard**: arrivals / departures today, bookings in house, occupancy tonight, rooms in maintenance,
  30-day paid and refunded money, review average and counts, next arrivals, latest reviews.
* **Bookings** (read-only): filters, search by guest / room / id, totals and payment state. Actions: *Check in*,
  *Check out*, *Cancel and refund*. They follow the same rules as the API and write to the audit log.
* **Payments**: view only. **Rooms**: filters, rating per room, actions *Close for maintenance* (warns about active
  bookings) / *Reopen*. **Room types**: edit price (applies to new bookings only).
* **Room reviews** (moderation): read, filter by status / stars / room / type, *Hide* and *Publish*. Guest words are
  never edited. **Guests**: name, phone, role; the password hash is never shown. **Guest roles**: staff / admin /
  blocked accounts of the website.
* **Log entries** (superuser): who changed what and when.
* Nothing with history can be deleted from the admin.

| Group | Can do |
|---|---|
| Front desk | view bookings and payments, check in / out / cancel, open / close rooms, add and edit guests |
| Review moderators | hide / publish reviews, view rooms and guests |
| Managers | Front desk + moderation + edit room types and prices |
| superuser | everything, including roles, users and the audit log |

## Production checklist
Set these environment variables (see `.env.example`):
`DJANGO_DEBUG=0`, `DJANGO_SECRET_KEY` (50+ random chars), `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`
(`https://your-domain`), `CORS_ALLOWED_ORIGINS` (the React site), `FRONTEND_URL`, `DJANGO_TIME_ZONE` (the hotel's zone),
`DJANGO_BEHIND_PROXY=1` when nginx terminates HTTPS, and a different `DJANGO_ADMIN_URL`. With `DJANGO_DEBUG=0` the app
refuses to start without a secret key and allowed hosts, cookies become Secure, HTTP redirects to HTTPS and HSTS is on.
```bash
python manage.py collectstatic --noinput          # WhiteNoise serves the admin CSS/JS
python manage.py check --deploy                   # only "HSTS preload" remains (optional)
gunicorn hotel_api.wsgi --workers 3 --bind 127.0.0.1:8000    # pip install gunicorn
```
* Wrong passwords: 5 failures for one username (25 per address) lock the login for 15 minutes. The counters use
  Django's cache; with several workers configure a shared cache (Redis / Memcached) in `CACHES`.
* Use a normal database account for `DB_USER` (not root) and back up the database, including `auth_*` tables.
* Django 6.x needs **MySQL 8.4+** (or MariaDB 10.11+). MySQL 8.0 is refused by Django 6.1.

## Tests
`booking/test_admin.py` (22 tests: pages, read-only rules, actions, groups, login lock). All 68 tests:
`USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking`
