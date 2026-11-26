# Room reviews (rating + comment)

A guest rates a room from 1 to 5 stars and may add a comment (max 1000 characters).
Code: `booking/reviews.py` (model), `booking/reviews_api.py` (views), `booking/reviews_urls.py`.
Table: `db/06_room_reviews.sql`. Wired in with one line in `hotel_api/urls.py`.

## Rules
* **Verified stay.** A guest can review a room only if she has a booking with that room whose status is
  `Completed` (after check-out). No stay, no review (403).
* **One review per room per stay** (database `UNIQUE`). A second review for the same stay gives 409; she can edit
  the first one. A guest who stays again can write a new review.
* The database also checks `rating BETWEEN 1 AND 5` and `status IN ('Published','Hidden')`.
* **Moderation before publishing (week 13).** A new review is `Pending` and is **not** shown on the website or
  counted in the ratings until an **admin** approves it (`Published`) or rejects it (`Hidden`). When the author edits
  a published review it goes back to `Pending`. Only admins moderate (`POST /api/reviews/{id}/moderate/`, 403 for staff).
  Hidden reviews disappear from lists and averages, the row stays for audit, and the author cannot edit it back into view.
  Database: run `db/10_review_moderation.sql` (adds `Pending` to the CHECK and makes it the default).
* **Privacy.** Public data shows the author as `Amina S.` only. No email, phone or guest id.
* Writing is limited to 30 requests per hour per account (`review_write` in settings). Reading is free.

## Setup
```bash
mysql -u root -p < db/06_room_reviews.sql     # new table room_review
mysql -u root -p < db/10_review_moderation.sql # new reviews wait for an admin (Pending)
python manage.py seed_demo                    # also adds one demo review (room 102)
```
To try the write flow: log in as staff, check in and check out Saltanat's booking 1 (room 101), then log in as
`saltanat@gmail.com` / `demo12345` and review room 101.

## Endpoints
| Method | URL | Who | What |
|---|---|---|---|
| GET | /api/rooms/{id}/reviews/ | everyone | `count, next, previous, results[], room, summary`. Query: `page`, `page_size` (max 50, default 10), `ordering` = newest (default) / oldest / highest / lowest, `rating` = 1..5. Staff may add `status=Hidden` or `status=all` |
| POST | /api/rooms/{id}/reviews/ | guest with a finished stay | body `rating` (1-5), `comment` (optional), `booking_id` (optional, which stay; default the newest un-reviewed one). 201 with the review |
| PATCH | /api/reviews/{id}/ | author | `rating` and/or `comment`. 403 if a moderator hid it |
| DELETE | /api/reviews/{id}/ | author | 204. She may write a new one afterwards |
| POST | /api/reviews/{id}/moderate/ | admin | body `status`: `Published` (approve) or `Hidden` (reject / hide) |
| GET | /api/reviews/mine/ | any account | `reviews` (mine, with `status`) and `can_review` (finished stays not reviewed yet, with `booking_id`, `room_id`, dates) |
| GET | /api/reviews/summary/ | everyone | `rooms{room_id: {average, count}}` and `room_types{id: {average, count}}` in ONE request, for stars on room cards |

`summary` of a room: `{"average": 4.5, "count": 12, "distribution": {"5": 7, "4": 4, "3": 1, "2": 0, "1": 0}}`
(`average` is `null` when there are no reviews).

A review looks like:
```json
{"review_id": 1, "room_id": 2, "room_number": "102", "rating": 5, "comment": "...", "author": "Amina S.",
 "stay_check_in": "2026-12-01", "stay_check_out": "2026-12-05", "created_at": "2026-11-13T08:50:51",
 "updated_at": "2026-11-13T08:50:51", "edited": false, "is_mine": false}
```
`status` is added for the author and for staff only. Errors use `{"detail": "..."}` or `{field: [messages]}`,
like the rest of the API.

## Tests
`booking/test_reviews.py` (19 tests). Run all backend tests (68) without MySQL:
`USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking`
