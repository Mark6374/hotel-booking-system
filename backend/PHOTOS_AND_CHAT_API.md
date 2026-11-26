# Profile photos and chat (customer ↔ admin)

Same style as the other APIs: Bearer token in `Authorization`, JSON errors `{detail}`. Code: `booking/photos*.py`, `booking/chat*.py`, `booking/consumers.py`, `hotel_api/asgi.py`.

## Setup (once)

```bash
pip install -r requirements.txt                 # new: Pillow, channels, daphne
mysql -u root -p < db/08_profile_photo.sql      # table guest_photo
mysql -u root -p < db/09_chat.sql               # tables chat_conversation, chat_message
python manage.py runserver                      # now ASGI (daphne), the chat socket works here too
```

`vite.config.js` got a `/ws` proxy entry (with `ws: true`) so the socket works through `npm run dev`.

Production: run `daphne -b 0.0.0.0 -p 8000 hotel_api.asgi:application` (WSGI cannot serve a WebSocket). With **more than one process or server** set `REDIS_URL` and `pip install channels-redis`, otherwise a message reaches only the sockets of the same process. Keep the folder `MEDIA_ROOT` (default `backend/media`, holds the photos) between deploys. Behind nginx proxy `/ws/` with `Upgrade`/`Connection` headers and set `client_max_body_size 6m`.

---

## 1. Profile photo

| Method | URL | Who | What |
|---|---|---|---|
| POST or PUT | `/api/account/photo/` | any account | multipart form, field **`photo`**. Adds or changes the photo. Returns the account (as `GET /api/account/`) |
| DELETE | `/api/account/photo/` | any account | removes the photo, returns the account |
| GET | `/api/account/` | any account | now has **`photo_url`** (`null` = no photo) |
| GET | `/api/admin/accounts/` | admin | every row has `photo_url` |
| GET | `/api/photos/<name>.jpg` | public | the picture (see below) |

`photo_url` is a path like `/api/photos/3f26….jpg`. Use it as `<img src>`; if `VITE_API_URL` is an absolute address, put it in front. If the image fails to load, show initials.

```js
async function uploadPhoto(file) {                // <input type="file" accept="image/*">
  const form = new FormData();
  form.append('photo', file);                      // do NOT set Content-Type yourself
  const res = await fetch(BASE + '/account/photo/', {
    method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: form });
  if (!res.ok) throw new Error((await res.json()).detail);
  return res.json();                               // { …, photo_url }
}
```
The existing `api()` helper in `src/api.js` always sends JSON, so use `fetch` for this call (or let `api()` skip the header when `body instanceof FormData`).

**Rules** (all checked on the server, the message is in `detail`): JPEG, PNG or WebP; at most 5 MB (413 for a much bigger request); at most 25 megapixels; 20 uploads per hour per account.
**What is stored:** every upload is re-encoded to a **square JPEG, at most 512×512** (centre crop, never enlarged), all metadata (GPS, camera) removed, transparency turned white. The file name is random and **changes on every upload**, so the picture can be cached for ever and an old URL stops working (404) after a change.
The picture URL needs no login (an `<img>` tag cannot send a token); the name has 128 random bits and only the account itself, the admin inbox and the chat show it.

---

## 2. Chat

One conversation per customer (created by the first message). Every admin sees all conversations and any admin can reply. Messages are **saved first, then pushed**, so nothing is lost if someone is offline. Only the role **admin** has the inbox (to let the front desk answer too, change `SUPPORT_ROLES = ('admin',)` to `('admin', 'staff')` in `booking/chat.py`; that is the only place). Admin accounts do not have a customer chat of their own (403 on the customer endpoints).

Limits: message 1–2000 characters (trimmed, control characters removed; **show it as text, never as HTML**), 30 messages per minute per account (`429`, code `rate_limited`).

### 2.1 Real time: WebSocket

1. `POST /api/chat/ticket/` (normal Bearer token) → `{ticket, expires_in: 60, path: "/ws/chat/"}`
2. Open `ws(s)://<host>/ws/chat/?ticket=<ticket>` (the ticket lives one minute and is only used for the handshake; the login token never goes into a URL). Ask for a new ticket on every (re)connect.
3. The server answers `ready` first.

| Client → server | |
|---|---|
| `{"type":"message.send","body":"…","client_id":"tmp-1"}` | customer. `client_id` is optional and is echoed back |
| `{"type":"message.send","conversation_id":7,"body":"…"}` | admin reply (`conversation_id` required) |
| `{"type":"read"}` / `{"type":"read","conversation_id":7,"up_to":123}` | "I opened the chat": marks the other side's messages read. Customer: no id. `up_to` optional |
| `{"type":"ping"}` | answered with `{"type":"pong"}` |

| Server → client | |
|---|---|
| `{"type":"ready","role":"customer","guest_id":1,"conversation_id":3,"unread":2}` | customer (`conversation_id` is `null` before the first message) |
| `{"type":"ready","role":"admin","guest_id":4,"unread":5}` | admin (`unread` = all customer messages not read yet) |
| `{"type":"message.new","message":{…},"conversation":{…}}` | a saved message. **Also sent to the sender**: draw your own message when this echo arrives (match `client_id` if you showed it as "sending…") |
| `{"type":"messages.read","conversation_id":3,"reader":"admin","up_to":42,"count":2,"read_at":"…"}` | the other side read: show "Seen" on your messages with `message_id <= up_to` |
| `{"type":"error","code":"empty","detail":"…","client_id":"tmp-1"}` | codes: `empty`, `too_long`, `rate_limited`, `conversation_required`, `not_found`, `bad_message`, `unknown_type`, `push_failed` |

Message object (same everywhere):
```json
{"message_id":42,"conversation_id":3,"sender_id":4,"from_customer":false,"sender_name":"Mark Y.",
 "sender_photo_url":"/api/photos/….jpg","body":"Yes, until 2 am.",
 "created_at":"2026-11-20T08:53:16+00:00","read_at":null}
```
`conversation` in `message.new`: `{conversation_id, guest:{guest_id, first_name, last_name, email, photo_url}, unread:{for_admin, for_customer}}`, so an admin can add a brand-new conversation to the inbox without another request. Times carry a UTC offset, `new Date(created_at)` is correct in any time zone.

**Who receives what:** a customer receives only his own conversation; every connected admin receives every conversation. The same account may have several tabs/devices open, all are kept in sync.

**Close codes:** `4401` bad/expired ticket (ask for a new ticket and retry), `4403` account blocked, removed, or its role changed (reload the account with `GET /api/account/`, then reconnect). Anything else (network): reconnect with backoff, then catch up with `GET …/messages/?after=<last message_id you have>`.

```js
// minimal client (works for customer and admin)
export function openChat({ onEvent, base = '/api' }) {
  let ws, closed = false, retry = 0;
  async function connect() {
    const { ticket, path } = await api('/chat/ticket/', { method: 'POST' });
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path + '?ticket=' + ticket);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (closed || e.code === 4403) return;
      setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));     // after reconnect: fetch ?after=<last id>
    };
  }
  connect();
  return {
    send: (body, conversation_id, client_id) =>
      ws.send(JSON.stringify({ type: 'message.send', body, conversation_id, client_id })),
    read: (conversation_id) => ws.send(JSON.stringify({ type: 'read', conversation_id })),
    close: () => { closed = true; ws && ws.close(); }
  };
}
```
If the frontend is served from another host than the backend, use that host for the `WebSocket` URL; the site must be listed in `CORS_ALLOWED_ORIGINS` (the socket checks the `Origin` header against it and `ALLOWED_HOSTS`).

### 2.2 REST (first load, history, badge, fallback)

All sending/reading endpoints push to the open sockets too.

| Method | URL | Who | What |
|---|---|---|---|
| POST | `/api/chat/ticket/` | any account | WebSocket ticket |
| GET | `/api/chat/unread/` | any account | `{role, unread}` for the badge |
| GET | `/api/chat/conversation/` | customer | `{conversation_id (or null), unread}` |
| GET | `/api/chat/messages/` | customer | history |
| POST | `/api/chat/messages/` | customer | `{body, client_id?}` → 201 message |
| POST | `/api/chat/read/` | customer | marks the admin's messages read → `{marked}` |
| GET | `/api/chat/admin/conversations/` | admin | inbox, newest activity first. `?q=` (name/e-mail) `&unread=1` `&limit=` (≤200) `&offset=` → `{results, count, has_more, unread_total}`; row: `{conversation_id, guest, unread, last_message:{message_id, preview, from_customer, created_at}, last_message_at}` |
| GET | `/api/chat/admin/conversations/<id>/messages/` | admin | history (+ `guest`) |
| POST | `/api/chat/admin/conversations/<id>/messages/` | admin | `{body}` → 201 message |
| POST | `/api/chat/admin/conversations/<id>/read/` | admin | marks the customer's messages read → `{marked}` (`?up_to=<id>` optional) |

**History** (`limit` 1–100, default 50): returns `{results (oldest first), has_more, next_before}`. The newest page comes first; scroll up with `?before=<next_before>`. `?after=<id>` returns only newer messages (catch up after a reconnect).

Errors: `400` with `{detail, code}` (`empty`, `too_long`, `bad_parameter`), `401` no login, `403` wrong role or blocked, `404 not_found`, `429 rate_limited`.

### 2.3 Database

`chat_conversation(conversation_id, guest_id UNIQUE, created_at)` and `chat_message(message_id, conversation_id, sender_id, body, created_at, read_at)`. `from_customer` is derived (`sender_id = conversation.guest_id`), `read_at IS NULL` = unread. Messages are never deleted by the application; deleting a guest row removes his chat (`ON DELETE CASCADE`). **`/api/admin/reset-demo/` wipes all chat messages** (like bookings); photos of site-registered accounts are kept.

## Tests

`USE_SQLITE=1 DB_NAME=x DB_USER=x DB_HOST=x DB_PORT=1 python manage.py test booking` → 163 tests (79 earlier + 22 photos + 38 chat REST + 24 chat WebSocket). The SQL files 08 and 09 were also run on a real MariaDB 10.11, together with a live server (daphne) and real WebSocket clients.
