/* Juniper Court Hotel – booking data layer.
   Follows the Task 9 plan: guest, room_type, room, booking, booking_room
   (bridge table) and payment. Kept in memory and mirrored to localStorage
   so data survives a reload. Framework-agnostic: React talks to it only
   through the exported functions and the subscribe() pub-sub below. */

const STORAGE_KEY = 'juniper-court-db-v1';
const SESSION_KEY = 'juniper-court-session-v1';
const ACTIVE = ['Confirmed', 'CheckedIn'];
const TABLES = ['guest', 'room_type', 'room', 'booking', 'booking_room', 'payment'];

/* ---------- Helpers ---------- */

function pad(n) { return n < 10 ? '0' + n : String(n); }

export function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nights(ci, co) {
  return Math.round((Date.parse(co + 'T00:00:00Z') - Date.parse(ci + 'T00:00:00Z')) / 86400000);
}

export function fmtDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso + 'T00:00:00Z'));
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

export function ref(bookingId) { return 'HB-' + String(bookingId).padStart(4, '0'); }

function nextId(rows, key) {
  return rows.reduce((max, r) => Math.max(max, r[key]), 0) + 1;
}

/* ---------- Seed data ---------- */

function seed() {
  return {
    guest: [
      { guest_id: 1, first_name: 'Amina', last_name: 'Sadykova', email: 'amina@example.com', phone: '+7 700 111 2233' },
      { guest_id: 2, first_name: 'Daniel', last_name: 'Brooks', email: 'daniel@example.com', phone: '+44 20 7946 0101' },
      { guest_id: 3, first_name: 'Mei', last_name: 'Tanaka', email: 'mei@example.com', phone: '+81 3 5550 0123' }
    ],
    room_type: [
      { room_type_id: 1, type_name: 'Standard', capacity: 2, price_per_night: 60, description: 'Queen bed, quiet courtyard view, 24 m².' },
      { room_type_id: 2, type_name: 'Deluxe', capacity: 3, price_per_night: 90, description: 'King bed, city view, work desk and rain shower, 32 m².' },
      { room_type_id: 3, type_name: 'Suite', capacity: 4, price_per_night: 150, description: 'Bedroom and separate lounge with corner windows, 55 m².' }
    ],
    room: [
      { room_id: 1, room_number: '101', floor: 1, status: 'Available', room_type_id: 1 },
      { room_id: 2, room_number: '102', floor: 1, status: 'Available', room_type_id: 1 },
      { room_id: 3, room_number: '103', floor: 1, status: 'Available', room_type_id: 1 },
      { room_id: 4, room_number: '201', floor: 2, status: 'Available', room_type_id: 2 },
      { room_id: 5, room_number: '202', floor: 2, status: 'Available', room_type_id: 2 },
      { room_id: 6, room_number: '301', floor: 3, status: 'Available', room_type_id: 3 }
    ],
    booking: [
      { booking_id: 1, guest_id: 1, booking_date: '2026-10-02 09:15', check_in: '2026-12-09', check_out: '2026-12-12', status: 'Confirmed' },
      { booking_id: 2, guest_id: 2, booking_date: '2026-10-05 14:40', check_in: '2026-12-11', check_out: '2026-12-14', status: 'Confirmed' },
      { booking_id: 3, guest_id: 1, booking_date: '2026-09-10 11:05', check_in: '2026-12-01', check_out: '2026-12-05', status: 'Completed' },
      { booking_id: 4, guest_id: 3, booking_date: '2026-10-07 18:22', check_in: '2026-12-10', check_out: '2026-12-13', status: 'Cancelled' },
      { booking_id: 5, guest_id: 2, booking_date: '2026-10-08 10:00', check_in: '2026-12-10', check_out: '2026-12-13', status: 'Confirmed' }
    ],
    booking_room: [
      { booking_room_id: 1, booking_id: 1, room_id: 1, guests_count: 2, price_per_night: 60 },
      { booking_room_id: 2, booking_id: 2, room_id: 4, guests_count: 2, price_per_night: 90 },
      { booking_room_id: 3, booking_id: 3, room_id: 2, guests_count: 1, price_per_night: 60 },
      { booking_room_id: 4, booking_id: 4, room_id: 3, guests_count: 2, price_per_night: 60 },
      { booking_room_id: 5, booking_id: 5, room_id: 5, guests_count: 3, price_per_night: 90 }
    ],
    payment: [
      { payment_id: 1, booking_id: 1, amount: 180, payment_method: 'Card', payment_status: 'Paid', payment_date: '2026-10-02 09:16' },
      { payment_id: 2, booking_id: 2, amount: 270, payment_method: 'Card', payment_status: 'Paid', payment_date: '2026-10-05 14:41' },
      { payment_id: 3, booking_id: 3, amount: 240, payment_method: 'Cash', payment_status: 'Paid', payment_date: '2026-09-10 11:06' },
      { payment_id: 4, booking_id: 4, amount: 180, payment_method: 'Card', payment_status: 'Refunded', payment_date: '2026-10-07 18:23' },
      { payment_id: 5, booking_id: 5, amount: 270, payment_method: 'Transfer', payment_status: 'Paid', payment_date: '2026-10-08 10:02' }
    ]
  };
}

function isValidDb(d) {
  return d && TABLES.every((t) => Array.isArray(d[t]));
}

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidDb(parsed)) return parsed;
    }
  } catch (e) { /* storage blocked or corrupt: fall back to seed data */ }
  const fresh = seed();
  persist(fresh);
  return fresh;
}

function persist(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

let db = loadDb();
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

function saveDb() { persist(db); notify(); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDb() { return db; }

export function resetDb() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  db = seed();
  saveDb();
}

/* ---------- Availability ---------- */

export function blockedRoomIds(d, ci, co) {
  const ids = {};
  d.booking
    .filter((b) => ACTIVE.indexOf(b.status) !== -1 && b.check_in < co && b.check_out > ci)
    .forEach((b) => {
      d.booking_room.forEach((l) => { if (l.booking_id === b.booking_id) ids[l.room_id] = b.booking_id; });
    });
  return ids;
}

export function roomsOfType(d, typeId) {
  return d.room.filter((r) => r.room_type_id === typeId);
}

export function freeRooms(d, typeId, ci, co) {
  const blocked = blockedRoomIds(d, ci, co);
  return roomsOfType(d, typeId).filter((r) => r.status === 'Available' && !blocked[r.room_id]);
}

export function typeOf(d, room) {
  return d.room_type.filter((t) => t.room_type_id === room.room_type_id)[0];
}

export function validateSearch(s) {
  if (!s.ci || !s.co) return 'Choose both a check-in and a check-out date.';
  if (s.ci < todayISO()) return 'Check-in cannot be in the past.';
  if (s.co <= s.ci) return 'Check-out must be after check-in.';
  if (!(s.guests >= 1 && s.guests <= 10)) return 'Guests must be between 1 and 10.';
  return '';
}

export function getSelection(d, s, sel) {
  const n = nights(s.ci, s.co);
  const out = { lines: [], total: 0, cap: 0, count: 0, n };
  d.room_type.forEach((t) => {
    const q = sel[t.room_type_id] || 0;
    if (!q) return;
    const rooms = freeRooms(d, t.room_type_id, s.ci, s.co).slice(0, q);
    if (!rooms.length) return;
    const sub = rooms.length * t.price_per_night * n;
    out.lines.push({ type: t, rooms, subtotal: sub });
    out.total += sub;
    out.cap += rooms.length * t.capacity;
    out.count += rooms.length;
  });
  return out;
}

export function bookingDetails(b) {
  const n = nights(b.check_in, b.check_out);
  const lines = db.booking_room.filter((l) => l.booking_id === b.booking_id);
  let total = 0;
  const rooms = lines.map((l) => {
    const room = db.room.filter((r) => r.room_id === l.room_id)[0];
    const type = room ? typeOf(db, room) : null;
    total += l.price_per_night * n;
    return (room ? room.room_number : '?') + ' (' + (type ? type.type_name : 'Room') + ')';
  });
  const pays = db.payment.filter((p) => p.booking_id === b.booking_id);
  const pay = pays.length ? pays[pays.length - 1] : null;
  return { n, total, rooms, pay };
}

/* ---------- Transaction: book rooms and pay ---------- */

export function runBookingTransaction(req) {
  const work = loadDb();
  const snapshot = JSON.stringify(work);
  const log = [];

  function step(label, fn) {
    try {
      const out = fn();
      log.push({ label, ok: true });
      return out;
    } catch (err) {
      log.push({ label, ok: false, detail: err.message });
      throw err;
    }
  }

  try {
    step('Lock the chosen rooms and check they are open', () => {
      req.rooms.forEach((r) => {
        const row = work.room.filter((x) => x.room_id === r.room_id)[0];
        if (!row || row.status !== 'Available') throw new Error('Room ' + r.room_number + ' is closed for maintenance.');
      });
    });

    step('Check that no active booking overlaps these dates', () => {
      const blocked = blockedRoomIds(work, req.ci, req.co);
      req.rooms.forEach((r) => {
        if (blocked[r.room_id]) throw new Error('Room ' + r.room_number + ' was just booked by someone else for overlapping dates.');
      });
    });

    const guestId = step('Find or create the guest', () => {
      let g = work.guest.filter((x) => x.email.toLowerCase() === req.guest.email.toLowerCase())[0];
      if (g) {
        g.first_name = req.guest.first_name;
        g.last_name = req.guest.last_name;
        g.phone = req.guest.phone;
      } else {
        g = {
          guest_id: nextId(work.guest, 'guest_id'),
          first_name: req.guest.first_name,
          last_name: req.guest.last_name,
          email: req.guest.email,
          phone: req.guest.phone
        };
        work.guest.push(g);
      }
      return g.guest_id;
    });

    const bookingId = step('Insert the booking', () => {
      const b = {
        booking_id: nextId(work.booking, 'booking_id'),
        guest_id: guestId,
        booking_date: nowStamp(),
        check_in: req.ci,
        check_out: req.co,
        status: 'Confirmed'
      };
      work.booking.push(b);
      return b.booking_id;
    });

    step('Insert one room line for each room', () => {
      req.rooms.forEach((r) => {
        work.booking_room.push({
          booking_room_id: nextId(work.booking_room, 'booking_room_id'),
          booking_id: bookingId,
          room_id: r.room_id,
          guests_count: r.guests_count,
          price_per_night: r.price
        });
      });
    });

    step('Insert the payment', () => {
      if (req.method === 'Card' && /0000$/.test(req.cardDigits)) throw new Error('The bank declined this card.');
      work.payment.push({
        payment_id: nextId(work.payment, 'payment_id'),
        booking_id: bookingId,
        amount: req.total,
        payment_method: req.method,
        payment_status: 'Paid',
        payment_date: nowStamp()
      });
    });

    log.push({ label: 'COMMIT', ok: true, final: true, detail: 'Booking, rooms, and payment saved together.' });
    db = work;
    saveDb();
    return { ok: true, bookingId, log, total: req.total };
  } catch (err) {
    log.push({ label: 'ROLLBACK', ok: false, final: true, detail: 'Nothing was saved, so no room is blocked without payment.' });
    db = JSON.parse(snapshot);
    return { ok: false, message: err.message, log };
  }
}

export function cancelBooking(id) {
  const b = db.booking.filter((x) => x.booking_id === id)[0];
  if (!b || b.status !== 'Confirmed') return false;
  b.status = 'Cancelled';
  let refunded = false;
  db.payment.forEach((p) => {
    if (p.booking_id === id && p.payment_status === 'Paid') { p.payment_status = 'Refunded'; refunded = true; }
  });
  saveDb();
  return refunded;
}

export function toggleRoomMaintenance(roomId) {
  const r = db.room.filter((x) => x.room_id === roomId)[0];
  if (!r) return;
  r.status = r.status === 'Available' ? 'Maintenance' : 'Available';
  saveDb();
}

export { TABLES };

/* ---------- Guest session (no-password sign-in, persists across visits) ---------- */

export function loadSession() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
}

export function saveSession(email) {
  try {
    if (email) localStorage.setItem(SESSION_KEY, email);
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* ignore */ }
}
