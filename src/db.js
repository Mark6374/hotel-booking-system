/* Juniper Court Hotel – booking data layer.
   Tables (guest, room_type, room, booking, booking_room, payment) come from
   the Django REST backend and are kept here as an in-memory cache.
   Pages read the cache synchronously through getDb(); every change goes
   to the backend first and then the cache is reloaded. */

import { api } from './api.js';
import { t, has } from './i18n/index.js';
import { dateShort } from './i18n/dates.js';

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
  return dateShort(iso);
}

/* Room types live in the database in English; the site shows them in the chosen language. */
export function typeName(type) {
  if (!type) return t('common.room');
  const key = 'roomType.' + type.type_name;
  return has(key) ? t(key) : type.type_name;
}

export function typeDesc(type) {
  if (!type) return '';
  const key = 'roomDesc.' + type.type_name;
  return has(key) ? t(key) : type.description;
}

export function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}


export function ref(bookingId) { return 'HB-' + String(bookingId).padStart(4, '0'); }

/* ---------- Cache loaded from the API ---------- */

const ENDPOINTS = {
  guest: '/guests/',
  room_type: '/room-types/',
  room: '/rooms/',
  booking: '/bookings/',
  booking_room: '/booking-rooms/',
  payment: '/payments/'
};

/* DRF sends foreign keys as "guest", decimals as "60.00" and datetimes with a "T".
   Reshape rows to the column names of the SQL tables, which the pages use. */
const num = (v) => (v == null ? v : Number(v));
const stamp = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : v);
const NORMALIZE = {
  guest: (r) => r,
  room_type: (r) => ({ ...r, price_per_night: num(r.price_per_night) }),
  room: ({ room_type, ...r }) => ({ ...r, room_type_id: room_type }),
  booking: ({ guest, ...r }) => ({ booking_id: r.booking_id, guest_id: guest, ...r, booking_date: stamp(r.booking_date) }),
  booking_room: ({ booking, room, ...r }) => ({ booking_room_id: r.booking_room_id, booking_id: booking, room_id: room, ...r, price_per_night: num(r.price_per_night) }),
  payment: ({ booking, ...r }) => ({ payment_id: r.payment_id, booking_id: booking, ...r, amount: num(r.amount), payment_date: stamp(r.payment_date) })
};

function empty() {
  const d = { loaded: false, error: '' };
  TABLES.forEach((t) => { d[t] = []; });
  return d;
}

let db = empty();
const listeners = new Set();

function notify() { listeners.forEach((fn) => fn()); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDb() { return db; }

/* Fetch every table. Keeps the old cache if the server is down. */
/* Several reloads can overlap (login, logout, page load). Only the newest one is
   applied, so an older answer made with another account's token never wins. */
let reloadSeq = 0;

export async function reloadDb() {
  const seq = ++reloadSeq;
  try {
    const rows = await Promise.all(TABLES.map((t) => api(ENDPOINTS[t])));
    if (seq !== reloadSeq) return db;
    const next = { loaded: true, error: '' };
    TABLES.forEach((t, i) => { next[t] = rows[i].map(NORMALIZE[t]); });
    db = next;
  } catch (e) {
    if (seq !== reloadSeq) return db;
    db = { ...db, error: e.message };
  }
  notify();
  return db;
}

/* Admin only: wipe and re-seed the demo data on the server. */
export async function resetDb() {
  await api('/admin/reset-demo/', { method: 'POST' });
  await reloadDb();
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
  if (!s.ci || !s.co) return t('v.bothDates');
  if (s.ci < todayISO()) return t('v.ciPast');
  if (s.co <= s.ci) return t('v.coAfter');
  if (!(s.guests >= 1 && s.guests <= 10)) return t('v.guests');
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
    return (room ? room.room_number : '?') + ' (' + typeName(type) + ')';
  });
  const pays = db.payment.filter((p) => p.booking_id === b.booking_id);
  const pay = pays.length ? pays[pays.length - 1] : null;
  return { n, total, rooms, pay };
}

/* ---------- Transaction: book rooms and pay (runs on the server) ---------- */

/* req: { ci, co, rooms: [{room_id, guests_count}], method, cardDigits, guest: {first_name, last_name, phone} } */
export async function runBookingTransaction(req) {
  try {
    const r = await api('/bookings/create/', {
      method: 'POST',
      body: {
        check_in: req.ci,
        check_out: req.co,
        rooms: req.rooms.map((x) => ({ room_id: x.room_id, guests_count: x.guests_count })),
        payment_method: req.method,
        card_number: req.cardDigits,
        first_name: req.guest.first_name,
        last_name: req.guest.last_name,
        phone: req.guest.phone
      }
    });
    await reloadDb();
    return { ok: true, bookingId: r.booking_id, log: r.log, total: Number(r.total) };
  } catch (e) {
    if (e.status === 409) await reloadDb(); // someone else may have taken the room
    return { ok: false, message: e.message, log: (e.data && e.data.log) || [] };
  }
}

async function post(path, body) {
  const r = await api(path, { method: 'POST', body });
  await reloadDb();
  return r;
}

/* Returns true when a payment was refunded. Throws ApiError on failure. */
export async function cancelBooking(id) {
  const r = await post('/bookings/' + id + '/cancel/');
  return !!r.refunded;
}

export async function checkInBooking(id) { await post('/bookings/' + id + '/check-in/'); return true; }
export async function checkOutBooking(id) { await post('/bookings/' + id + '/check-out/'); return true; }
export async function toggleRoomMaintenance(roomId) { await post('/rooms/' + roomId + '/maintenance/'); }

export async function setRoomTypePrice(typeId, price) {
  await api('/room-types/' + typeId + '/price/', { method: 'PATCH', body: { price_per_night: price } });
  await reloadDb();
  return true;
}

export function guestByEmail(d, email) {
  if (!email) return null;
  return d.guest.filter((x) => x.email.toLowerCase() === email.toLowerCase())[0] || null;
}

export { TABLES };
