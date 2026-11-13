# Hotel Booking System — Test Report, Week 11

**Tester:** 24B032036 (Tester / Backend)
**Date:** 13 Nov 2026
**Tested version:** the team's current project (React website + Django REST API + MySQL, with accounts and roles guest / staff / admin), received as `project.zip` on 13 Nov; database scripts `wwsqpor/Hotel-Booking-System` commit `1e2c4a1`
**Environment:** MySQL 8.0.46 · Django 5.2 for the live system (see note 6.1) and Django 6.1 for the unit tests · Chrome via Playwright · Node 22

## 1. Result

| | Tests | PASS before fixes | PASS after fixes |
|---|---|---|---|
| Website (frontend) | 26 | 25 | **26** |
| Database (backend) | 27 | 24 | **27** |
| **Total planned** | **53** | **49** | **53** |
| API checks (extra) | 5 | 0 | **5** |
| Backend unit tests | 18 team + 9 new | 18 | **27** |

3 problems were found in this version and all 3 are fixed. After every fix **all** tests were run again (regression testing).

## 2. How the tests were run

- **Website, 26 tests** — `run-ui-tests.cjs` opens the site in Chrome and does the steps of `test-cases.md` like a user: searches, signs up, logs in, books, pays, cancels, works as staff and admin. Before every test the demo data is restored, so every test starts the same. Screenshot of every test: `screenshots/`.
- **Database, 27 tests** — `database-tests.sql` in MySQL. DB-01…09 check the migrated data; DB-10…27 try to save bad data inside a transaction: an error from MySQL = PASS. Everything is rolled back.
- **API, 5 checks** — `api-checks.sh` calls the backend directly with `curl`, without the website: as a visitor, as a guest, with bad data.
- **Backend unit tests** — the team's Django tests plus my 9 new tests, `python manage.py test booking`.

Evidence: `evidence/1…6.png` (real outputs of these runs).

## 3. Problems found

| # | Tests | Problem | Severity | Status |
|---|---|---|---|---|
| 1 | API-01, API-02, API-03 | **Personal data open to everyone.** `GET /api/guests/` gave the name, email and phone of **every** guest, including the admin and staff accounts, to anyone — even without login. `GET /api/payments/` gave all payments. A logged-in guest also got everybody. The website hid it, but the data was sent to every browser. | **High** | **Fixed** |
| 2 | UI-12, API-04, API-05 | **Phone without digits accepted.** Sign-up accepted `((((((`; the booking API accepted `abc` and saved it into the account. The website and the backend had different rules, and the booking endpoint had none. | Medium | **Fixed** |
| 3 | DB-25, DB-26, DB-27 | **The database itself did not protect 3 business rules:** double booking of a room, more guests than the capacity, check-in in the past. The backend checks them, but any other program or a manual `INSERT` could break them. | Medium | **Fixed** |

Notes (not changed in code):

| # | Note | Recommendation |
|---|---|---|
| 4 | Django 6 (in `requirements.txt`) needs **MySQL 8.4 or newer**. With MySQL 8.0 the backend stops: *"MySQL 8.4 or later is required (found 8.0.46)"*. | Everybody installs MySQL 8.4 LTS, or the team pins `Django>=5.2,<5.3` (works with 8.0). |
| 5 | `GET /api/bookings/` and `/api/booking-rooms/` stay public: the booking page of a visitor needs them to count free rooms. They show dates and guest numbers (`guest_id`) but no names. | Later: hide `guest_id` for visitors. Low. |

## 4. Fixes

### 4.1 Personal data (problem 1)

| File | Change |
|---|---|
| `backend/booking/views.py` | `GuestListView` and `PaymentListView` return data by role: **staff/admin → all; guest → only herself / her payments; visitor or blocked account → nothing** |
| `src/auth.js` | After login and logout the website reloads the tables, so the browser holds only what this account may see. The data is loaded **before** the account page opens. |

### 4.2 Phone (problem 2)

| File | Change |
|---|---|
| `backend/booking/serializers.py` | One rule `clean_phone()`: optional `+`, digits, spaces, `( ) -`, **at least 6 digits**. Used at sign-up |
| `backend/booking/frontend_api.py` | The same rule for the profile and for the phone sent with a booking |
| `src/auth.js`, `RegisterPage.jsx`, `AccountPage.jsx`, `CheckoutPage.jsx` | The website uses the same rule and message: *"Enter at least 6 digits. Spaces, ( ) - and a + at the start are allowed."* |

### 4.3 Database (problem 3) — `backend/db/05_business_rules.sql`

| Rule | Protection | Why this way |
|---|---|---|
| BR-3 check-in not before the booking day (DB-27) | `CHECK (check_in >= DATE(booking_date))` | Two columns of the same row → CHECK is enough |
| BR-2 guests ≤ capacity (DB-26) | Trigger `BEFORE INSERT/UPDATE ON booking_room` | Capacity is in another table; CHECK cannot read other tables |
| BR-1 no double booking (DB-25) | Same trigger + `BEFORE UPDATE ON booking` | Needs other bookings. Overlap = `other.check_in < this.check_out AND other.check_out > this.check_in` |

Also checked: a free room can be booked; back-to-back stays (leave 12 Dec, next guest arrives 12 Dec) are allowed; a cancelled booking cannot be re-activated if its room is taken; `seed_demo`, cancel, check-in / check-out and admin reset still work.

### 4.4 New backend tests — `backend/booking/test_privacy_and_phone.py`

9 tests: visitor gets no guests and payments; guest gets only herself; staff gets everybody; blocked account gets nothing; rooms and bookings stay public for the search; bad phones refused at sign-up, in the profile and in a booking; good phones accepted.

## 5. Regression testing

After the fixes all 53 tests + 5 API checks + 27 unit tests were run again. The first run after fix 1 found **one side effect of my own fix**: right after login, *My account* showed an empty booking list for a moment (UI-14 FAIL), because the page opened before the new data came. Fixed in `src/auth.js` (data first, then the page); after that every test passed. One team unit test (`test_register_validation`) once got HTTP 429 because my new tests used up the sign-up limit (20 per minute); my tests now clear that counter.

## 6. Compared with last week (prototype)

Last week 9 problems were found in the first prototype. In this version:
- solved by the team's new code and confirmed by this week's tests: login without password (now UI-13, UI-14), staff page open to everyone (UI-22), data only in the browser (UI-19), booking under someone else's email (the email now comes from the account, UI-15). The old *Reset demo data* button with the crash is gone; reset is now an admin function;
- fixed by me now: phone without digits; double booking, capacity and past dates in the database.

## 7. Changed and new files

| File | |
|---|---|
| `backend/booking/views.py` | changed |
| `backend/booking/serializers.py` | changed |
| `backend/booking/frontend_api.py` | changed |
| `backend/booking/test_privacy_and_phone.py` | **new** |
| `backend/db/05_business_rules.sql` | **new** |
| `backend/FRONTEND_API.md` | setup step for `05_business_rules.sql`, number of tests |
| `src/auth.js`, `src/pages/RegisterPage.jsx`, `src/pages/AccountPage.jsx`, `src/pages/CheckoutPage.jsx` | changed |
| `testing/` | **new**: `use-cases.md`, `test-cases.md`, `test-report.md`, `run-ui-tests.cjs`, `database-tests.sql`, `api-checks.sh`, `screenshots/`, `evidence/` |
