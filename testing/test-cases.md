# Hotel Booking System — Test Plan and Test Cases

**Tester:** 24B032036
**Version:** 2.0, 13 Nov 2026 — for the version with accounts, roles and the Django API
**Use cases:** `use-cases.md` · **Results and bugs:** `test-report.md`

## 1. Test plan

| | |
|---|---|
| **What is tested** | The whole system: website (React), backend API (Django REST), database (MySQL) |
| **Types of testing** | Functional website tests (positive and negative), database tests, API checks, backend unit tests, security checks (roles, personal data), regression (everything again after every fix) |
| **Tools** | Playwright + Chrome (`run-ui-tests.cjs`), MySQL (`database-tests.sql`), curl (`api-checks.sh`), Django test runner |
| **Test data** | Demo data: `seed_demo` (guests Amina, Daniel, Mei, password `demo12345`) and `seed_roles` (`staff@junipercourt.example` / `Staff12345`, `admin@junipercourt.example` / `Admin12345`). Database tests use the migrated data of Dmitry's scripts |
| **PASS / FAIL** | PASS = actual result is the same as expected. FAIL = different → bug report → fix → test again |

## 2. How to run

**Backend and database (once)**
```bash
mysql -u root -p < backend/db/02_normalized_schema.sql
mysql -u root -p < backend/db/04_add_guest_role.sql
mysql -u root -p < backend/db/05_business_rules.sql
cd backend
pip install -r requirements.txt
python manage.py seed_demo
python manage.py seed_roles
python manage.py runserver
```
Note: Django 6 needs **MySQL 8.4 or newer**.

**Website** (second window, project folder): `npm install` → `npm run dev` → `http://localhost:5173`

**Tests**
| What | Command | Result |
|---|---|---|
| 26 website tests | `npm install --no-save playwright` → `npx playwright install chromium` → `node testing/run-ui-tests.cjs` | PASS/FAIL list + `testing/screenshots/UI-xx.png` |
| 27 database tests | in MySQL: Dmitry's `01_…` → `backend/db/02_…` → Dmitry's `03_migrate…` → `backend/db/04_…` → `backend/db/05_…` → `testing/database-tests.sql` | table with PASS/FAIL |
| 5 API checks | `bash testing/api-checks.sh` (Windows: Git Bash) | lines API-01…05 |
| 27 backend unit tests | `cd backend` → `USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking` | `Ran 27 tests … OK` |

## 3. Website test cases (26)

Every test starts from the demo data (the runner calls the admin *reset demo data* before each test). "Who" = which account is logged in.

| ID | UC | Who | Title | Steps | Expected result | Actual result (13 Nov) | Status |
|---|---|---|---|---|---|---|---|
| UI-01 | UC-01 | — | Booking page opens | Open **Book a room** | Check-in 10 Dec 2026, check-out 13 Dec 2026, guests 2 | check-in 2026-12-10, check-out 2026-12-13, guests 2 | PASS |
| UI-02 | UC-01 | — | Free rooms are counted correctly | Keep 10–13 Dec 2026, 2 guests | Standard **2 of 3 left**, Deluxe **Sold out** (its **+** disabled), Suite **1 of 1 left** (same as DB-09) | Standard: 2 of 3 left / Deluxe: Sold out for these dates / Suite: 1 of 1 left (Deluxe + disabled) | PASS |
| UI-03 | UC-01 | — | Check-out before check-in | Check-in 20 Dec, check-out 18 Dec → **Show available rooms** | *"Check-out must be after check-in."* | Check-out must be after check-in. | PASS |
| UI-04 | UC-01 | — | Check-in in the past | Check-in 10 Jan 2026 → **Show available rooms** | *"Check-in cannot be in the past."* | Check-in cannot be in the past. | PASS |
| UI-05 | UC-01 | — | Too many guests | Guests = 11 → **Show available rooms** | *"Guests must be between 1 and 10."* | Guests must be between 1 and 10. | PASS |
| UI-06 | UC-02 | — | Room details window | **See photos and details** on Suite → **Close** | Description, *Sleeps 4*, *$150*; Close closes the window | Suite×Bedroom and separate lounge with corner windows, 55 m².Sleeps 4Price $150  / closed | PASS |
| UI-07 | UC-01 | — | Price is calculated | **+** on Standard | Total **$180** (3 nights × $60), button active | Total $180, button "Log in to continue" active | PASS |
| UI-08 | UC-01 | — | Rooms too small for the group | Guests = 4 → **+** on Standard | *"These rooms sleep 2, but you are booking for 4…"*, button disabled | These rooms sleep 2, but you are booking for 4. Add another … / button disabled | PASS |
| UI-09 | UC-04 | — | Sign up with valid data | **Sign up**: Aru Test, `aru@example.com`, `+7 701 123 4567`, password `Hotel2026a` twice, accept terms | Account created, logged in, page *"Aru Test"* (My account) | page "Aru Test", header: logged in | PASS |
| UI-10 | UC-04 | — | Sign up with an email that already exists | Same as UI-09, email `AMINA@EXAMPLE.COM` | *"An account with this email already exists."* | "An account with this email already exists." | PASS |
| UI-11 | UC-04 | — | Sign up with a password of only digits | Same as UI-09, password `12345678` | Error under the password, no account | Use at least one letter and one digit. | PASS |
| UI-12 | UC-04 | — | Sign up with a phone without digits | Same as UI-09, phone `((((((` | Error under the phone, no account (BR-7) | **Before:** account created with phone `((((((`. **After fix:** *"Enter at least 6 digits…"*, no account | FAIL → **PASS** (fixed) |
| UI-13 | UC-04 | — | Log in with a wrong password | **Log in**: `amina@example.com` / `wrongpass1` | *"Invalid email or password."* | Invalid email or password. | PASS |
| UI-14 | UC-04, UC-05 | — | Log in and see my bookings | **Log in**: `amina@example.com` / `demo12345` | My account *"Amina Sadykova"* with HB-0001 and HB-0003 | page "Amina Sadykova", bookings HB-0001,HB-0003 | PASS |
| UI-15 | UC-03, UC-04 | visitor | Booking needs an account, rooms are kept | **+** Standard → **Log in to continue** → log in as Amina | Note *"Log in or create an account to finish your booking. Your rooms are kept."*; after login the checkout shows 1 × Standard | "Log in or create an account to finish your booking. Your rooms are kept." → after login: Guest details and payment, … | PASS |
| UI-16 | UC-03 | Amina | Short card number | 1 Standard → checkout → card `4242 4242 4242 424` | *"Enter a 16-digit card number."* | Enter a 16-digit card number. | PASS |
| UI-17 | UC-03 | Amina | Successful booking (main process) | 1 Standard → checkout → card `4242 4242 4242 4242` → **Confirm and pay** | *Booking confirmed* **HB-0006**, room 102, $180, log ends with COMMIT; search shows Standard **1 of 3 left** | HB-0006ConfirmedGuest Amina SadykovaDates 10 Dec 2026 to 13 Dec 2026Ro… / then Standard: 1 of 3 left | PASS |
| UI-18 | UC-03 | Amina | Card declined → rollback | Same as UI-17, card `4242 4242 4242 0000` | *"The bank declined this card."*, ROLLBACK; Standard still **2 of 3 left** | "The bank declined this card.", ROLLBACK: yes / then Standard: 2 of 3 left | PASS |
| UI-19 | UC-03 | Amina + visitor | A booking is visible in another browser | Book as in UI-17 → open the site in another browser without login | The other browser shows Standard **1 of 3 left** (data is in the shared database) | second browser (no login): Standard: 1 of 3 left | PASS |
| UI-20 | UC-06 | Amina | Cancel my booking | My account → **Cancel booking HB-0001** | *"Booking HB-0001 cancelled. The payment is marked as refunded."*; Standard **3 of 3 left** | Booking HB-0001 cancelled. The payment is marked as refunded. / then Standard: 3 of 3 left | PASS |
| UI-21 | UC-05 | Daniel | A guest sees only her own bookings | Log in as `daniel@example.com` → My account | Only HB-0002 and HB-0005, none of Amina's | Daniel sees HB-0002,HB-0005 | PASS |
| UI-22 | UC-07 | Amina + visitor | Front desk is closed to visitors and guests | Open **#staff** as Amina, then without login | Guest: *"This page is not for your account"* (403); visitor: login form *"The front desk is for hotel staff…"* | guest: "This page is not for your account"; visitor: "The front desk is for hotel staff. Log in with a staff account." | PASS |
| UI-23 | UC-07 | Staff | Staff sees which room is booked by whom | Log in as staff → Front desk, 10–13 Dec 2026 | 101 *Booked by Amina Sadykova (HB-0001)*, 201 / 202 *Booked by Daniel Brooks*, 102, 103, 301 *Free* | 101 Booked by Amina Sadykova (HB-0001); 102 Free for these dates; 103 Free for these dates; 201 Booked by Daniel Broo… | PASS |
| UI-24 | UC-08 | Staff + visitor | Staff closes a room for maintenance | Room 103 **Close for maintenance** → visitor searches → **Reopen room** → visitor searches | Visitor sees **1 of 3 left**, after reopening **2 of 3 left** | guests see after closing: Standard: 1 of 3 left; after reopening: Standard: 2 of 3 left | PASS |
| UI-25 | UC-09 | Amina + staff | Staff checks a guest in and out | Amina books 1 Standard from today to tomorrow → staff: **Check in** → **Check out** on HB-0006 | Confirmed → *Checked in* → *Completed* | HB-0006 today: Confirmed → Checked in → Completed | PASS |
| UI-26 | UC-10 | Admin | Admin changes a room price | Admin → Room prices → Standard = 70 → **Save** | *"Standard now costs $70 per night. Existing bookings keep their old price."*; visitors see $70; Amina's HB-0001 stays $180 (BR-4) | Standard now costs $70 per night. Existing bookings keep their old price. / guests see "Sleeps 2. $70 per night, $210… | PASS |

## 4. Database test cases (27, `database-tests.sql`)

| ID | What is checked | Expected | Before fix | After fix |
|---|---|---|---|---|
| DB-01 | Row counts after migration | guest 3, room_type 3, room 6, booking 6, booking_room 7, payment 7 | PASS | PASS |
| DB-02 | Old stored `total_price` = calculated total | 0 differences | PASS | PASS |
| DB-03 | Guest with two phone numbers → one phone (newest) | Amina: `+7 700 111 2233` | PASS | PASS |
| DB-04 | Full name split into first and last name | Amina / Sadykova | PASS | PASS |
| DB-05 | List `102;103` → two rows in `booking_room` | 102, 103 | PASS | PASS |
| DB-06 | `payment1_*` / `payment2_*` → two payment rows | Failed, Paid | PASS | PASS |
| DB-07 | Every booking has a room | 0 without a room | PASS | PASS |
| DB-08 | Room type price stored once | 1 Standard row, 3 rooms | PASS | PASS |
| DB-09 | Availability 10–13 Dec 2026 | Deluxe 0, Standard 2, Suite 1 | PASS | PASS |
| DB-10 … DB-24 | Bad data is refused: wrong dates, wrong status, unknown guest, duplicate email (also in capitals), email without @, empty name, price 0, wrong room status, wrong payment method, negative amount, same room twice, 0 guests, delete guest with bookings, delete room type with rooms | Refused with an error | PASS (15/15) | PASS (15/15) |
| DB-25 | Double booking of room 101 (BR-1) | Refused | **FAIL** | **PASS** (trigger) |
| DB-26 | 5 guests in a Standard room, capacity 2 (BR-2) | Refused | **FAIL** | **PASS** (trigger) |
| DB-27 | Check-in in the past (BR-3) | Refused | **FAIL** | **PASS** (CHECK) |

## 5. API checks (5, `api-checks.sh`)

| ID | Request | Expected | Before fix | After fix |
|---|---|---|---|---|
| API-01 | Visitor without login: `GET /api/guests/` | No personal data | **FAIL**: 5 guests with email and phone, incl. admin and staff | PASS: 0 |
| API-02 | Visitor without login: `GET /api/payments/` | No payments | **FAIL**: all 5 payments | PASS: 0 |
| API-03 | Guest Amina: `GET /api/guests/` | Only herself | **FAIL**: all 5 guests | PASS: 1 (Amina) |
| API-04 | `POST /api/auth/register/` with phone `((((((` | 400 | **FAIL**: 201, account created | PASS: 400 |
| API-05 | `POST /api/bookings/create/` with phone `abc` | 400, phone not changed | **FAIL**: 201, Amina's phone became `abc` | PASS: 400, phone unchanged |

## 6. Backend unit tests (Django)

18 tests of the team (`tests.py`, `test_frontend_api.py`) + **9 new tests** (`test_privacy_and_phone.py`) for the bugs above: **27 of 27 OK**.

## 7. Bug report template (GitHub → Issues → New issue)

```
Title: [BUG] <short: what is wrong>
Test case: UI-xx / DB-xx / API-xx      Severity: High / Medium / Low
Steps to reproduce: 1. ... 2. ...
Expected result: ...
Actual result: ...
Screenshot: (drag the image here)
```

## 8. Summary

| | Tests | PASS before fixes | PASS after fixes |
|---|---|---|---|
| Website (frontend) | 26 | 25 | **26** |
| Database (backend) | 27 | 24 | **27** |
| API checks (extra) | 5 | 0 | **5** |
| Backend unit tests | 27 (18 + 9 new) | 18 of 18 team tests | **27** |
