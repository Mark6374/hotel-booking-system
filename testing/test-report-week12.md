# Hotel Booking System — Test Report, Week 12

**Tester:** 24B032036 (Tester / Backend)
**Date:** 20 Nov 2026
**Promised for this week:** *test: 20 report / limited attempts* — lock the login after 5 wrong passwords for 15 minutes, 20 tests, full check of the current code
**Tested version:** team project of 20 Nov 2026 (commit `ffdcb9c` "Add room reviews, availability calendar, dark theme and notifications" + local changes)

## 1. Result

| | Tests | PASS |
|---|---|---|
| **New: login lock — backend** (`backend/booking/test_login_lock.py`) | 10 | **10** |
| **New: login lock — website** (UI-27 … UI-36) | 10 | **10** |
| **20 new tests in total** | **20** | **20** |
| Regression: website (UI-01 … UI-26) | 26 | 26 |
| Regression: database (`database-tests.sql`) | 27 | 27 |
| Regression: API checks (`api-checks.sh`) | 5 | 5 |
| Regression: team backend tests | 69 | 69 |

Evidence: `evidence/week12/` · screenshots of every website test: `screenshots/UI-01…UI-36.png`.

## 2. What was built: login lock

Before: the **website** login (`POST /api/auth/login/`) had no lock — only the general limit of 20 requests per minute per address, so a password could be guessed slowly. (The separate Django admin page `/admin/` already had its own lock.)

Now:

| Situation | What happens |
|---|---|
| 1st–4th wrong password | *"Invalid email or password."* |
| **5th wrong password in a row** | account **locked for 15 minutes**: *"Too many wrong passwords. This account is locked for 15 more minutes. Try again later or reset your password."* |
| right password while locked | refused, same message with the minutes left |
| right password (not locked) | logged in, counter back to 0 |
| e-mail in other letter case | counts for the same account |
| unknown e-mail | usual message, nothing stored (nobody can find out which e-mails exist) |
| password reset by e-mail | lock removed at once |
| admin → *Users and roles* | sees **"Locked N min"** and can press **"Unlock login"** |

| File | |
|---|---|
| `backend/db/07_login_lock.sql` | **new** table `login_lock` (counter, `locked_until`); kept apart from `guest`, like `guest_role` |
| `backend/booking/login_lock.py` | **new**: the rules above |
| `backend/booking/views.py` | login uses the lock |
| `backend/booking/password_reset.py` | password reset removes the lock |
| `backend/booking/frontend_api.py` | admin accounts list shows `locked_minutes`; `PATCH {"unlock": true}` |
| `backend/booking/models.py`, `seed_demo.py` | model registered; *reset demo data* also clears the locks |
| `src/auth.js`, `src/pages/AdminPage.jsx` | "Locked N min" badge and "Unlock login" button |
| `backend/booking/test_login_lock.py` | **new**: 10 backend tests |
| `tests.py`, `test_*.py` (team) | the test tables now include `login_lock` (login reads it) |
| `testing/run-ui-tests.cjs` | 10 new website tests, new demo account, new notifications |
| `backend/FRONTEND_API.md` | setup step for `07_login_lock.sql`, description of the lock |

## 3. The 20 new tests

| # | Backend test (`test_login_lock.py`) | Website test |
|---|---|---|
| 1 | 4 wrong passwords do not lock | UI-27 4 wrong passwords do not lock |
| 2 | 5th wrong password locks for 15 minutes | UI-28 5th wrong password shows the lock message |
| 3 | right password refused while locked | UI-29 right password refused while locked |
| 4 | still locked after 14 minutes ("1 more minute") | UI-30 lock is only for that account |
| 5 | lock ends after 15 minutes | UI-31 unknown e-mail: usual message, no lock |
| 6 | successful login resets the counter | UI-32 e-mail in capitals counts for the same account |
| 7 | e-mail letter case = same account | UI-33 admin sees "Locked 15 min" |
| 8 | unknown e-mail is not stored | UI-34 admin unlocks the account |
| 9 | lock is per account | UI-35 after unlock the guest logs in at once |
| 10 | password reset and admin unlock remove the lock; a guest cannot unlock | UI-36 a guest cannot open the admin page |

The time tests (14 and 16 minutes) do not wait: the test "moves the clock" forward.

## 4. Found during the full check

| # | Finding | Status |
|---|---|---|
| 1 | Website login had no lock (only `/admin/` had one) | **Done** — this week's task |
| 2 | My own first version said *"16 more minutes"* right after locking: MySQL rounds fractions of a second up. Found in the live test | **Fixed** (whole seconds, at most 15) |
| 3 | `testing/database-tests.sql` was changed by a team-wide search-and-replace *amina → saltanat*. The database tests use Dmitry's **migrated** data (Amina), so DB-14 and DB-23 started to FAIL for a wrong reason | **Fixed**, note added in the file: do not replace there |
| 4 | Admin → *Users and roles*: on a normal screen the **Status** and **Actions** columns (Block, Delete, Unlock) are hidden behind a horizontal scroll of the table | Open → frontend (suggestion: smaller columns or buttons under the name) |
| 5 | *Reset demo data* keeps accounts registered on the site (by design). The sign-up test now uses a new e-mail every run | Test updated |
| 6 | Django 6 needs **MySQL 8.4+**; with MySQL 8.0 the backend does not start | Note for the team (unchanged) |

The new team features of this week (reviews, availability calendar, dark theme, notifications) did not break the old tests. Four website tests were updated only for changed texts: messages are now pop-up notifications, *"See photos, details and reviews"*, demo guest Saltanat instead of Amina.

## 5. How to run

```bash
mysql -u root -p < backend/db/07_login_lock.sql            # once, on an existing database
cd backend
USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking   # 79 tests
python manage.py runserver
# second window: npm run dev, then
node testing/run-ui-tests.cjs                              # 36 website tests (about 10 min: login limit pauses)
ONLY=UI-27,UI-28,UI-29 node testing/run-ui-tests.cjs       # only some tests
```

Done with AI help (Claude): code and tests were generated by AI; every result above comes from real test runs.
