/* Languages of the website: English, Russian, Kazakh.
   t('key', {name: 'x'})     -> text with {name} filled in
   tn('nights', 3)           -> "3 nights" / "3 ночи" / "3 түн" (plural forms by Intl.PluralRules)
   The choice is saved in the browser; the first visit follows the browser language. */

import en from './en.js';
import ru from './ru.js';
import kk from './kk.js';

export const LANGS = [
  { id: 'en', label: 'EN', name: 'English', locale: 'en-GB' },
  { id: 'ru', label: 'RU', name: 'Русский', locale: 'ru-RU' },
  { id: 'kk', label: 'KZ', name: 'Қазақша', locale: 'kk-KZ' }
];
const DICT = { en, ru, kk };
const KEY = 'juniper-court-lang';
const listeners = new Set();

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (DICT[saved]) return saved;
  } catch (e) { /* private mode */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of nav) {
    const code = String(l || '').slice(0, 2).toLowerCase();
    if (code === 'kk') return 'kk';
    if (code === 'ru') return 'ru';
    if (code === 'en') return 'en';
  }
  return 'en';
}

let lang = initial();

export function getLang() { return lang; }
export function subscribeLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function locale() { return LANGS.find((l) => l.id === lang).locale; }

export function setLang(next) {
  if (!DICT[next] || next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
  applyPage();
  listeners.forEach((fn) => fn());
}

/* Parts of index.html outside React: <html lang>, the tab title and the skip link. */
function applyPage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  const skip = document.querySelector('.skip');
  if (skip) skip.textContent = t('nav.skip');
}

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

applyPage();

export function has(key) { return DICT[lang][key] !== undefined || DICT.en[key] !== undefined; }

export function t(key, vars) {
  let s = DICT[lang][key];
  if (s === undefined) s = DICT.en[key];
  if (s === undefined) return key;
  if (typeof s === 'object') s = s.other;
  return fill(s, vars);
}

/* Plural: dictionary value is {one, few, many, other}; {n} is the number. */
export function tn(key, n, vars) {
  const forms = DICT[lang][key] || DICT.en[key];
  if (!forms) return n + ' ' + key;
  if (typeof forms === 'string') return fill(forms, { n, ...vars });
  const rule = new Intl.PluralRules(locale()).select(n);
  return fill(forms[rule] || forms.other, { n, ...vars });
}

/* ---------- Messages that come from the server in English ---------- */

/* Exact texts -> keys */
const SERVER = {
  'Invalid email or password.': 'srv.badLogin',
  'Enter your email.': 'v.emailRequired',
  'An account with this email already exists.': 'srv.emailTaken',
  'Password cannot be only digits.': 'srv.pwDigits',
  'Use at least 8 characters, not only digits.': 'srv.pwRule',
  'Your current password is wrong.': 'srv.pwWrong',
  'Password changed.': 'srv.pwChanged',
  'Password changed. You can log in with the new password.': 'reset.doneText',
  'This reset link is invalid, expired or already used. Ask for a new one.': 'srv.resetBad',
  'If an account with that email exists, we sent a link to reset the password. It works for 1 hour.': 'reset.sent',
  'This account is blocked.': 'srv.blocked',
  'Account not found.': 'srv.accountNotFound',
  'Unknown role.': 'srv.unknownRole',
  'You cannot change or remove your own admin account.': 'srv.ownAccount',
  'Enter at least 6 digits. Spaces, ( ) - and a + at the start are allowed.': 'v.phone',
  'Check-in cannot be in the past.': 'v.ciPast',
  'Check-out must be after check-in.': 'v.coAfter',
  'Enter a 16-digit card number.': 'v.card',
  'The same room is listed twice.': 'srv.roomTwice',
  'Each room needs a room_id and guests_count.': 'srv.badRequest',
  'The bank declined this card.': 'srv.declined',
  'Booking not found.': 'srv.bookingNotFound',
  'This is not your booking.': 'srv.notYourBooking',
  'Only confirmed bookings can be cancelled.': 'srv.onlyConfirmed',
  'Enter a price.': 'admin.prices.enter',
  'Enter a price above 0.': 'admin.prices.enter',
  'Room not found.': 'srv.roomNotFound',
  'Room type not found.': 'srv.roomNotFound',
  'Log in to review a room.': 'srv.loginToReview',
  'You can review a room only after you have stayed in it (your booking must be completed).': 'srv.reviewNeedsStay',
  'You have already reviewed this room for that stay. You can edit your review.': 'srv.reviewTwice',
  'You have already reviewed this room for that stay.': 'srv.reviewTwice',
  'This review was hidden by a moderator and cannot be edited.': 'srv.reviewHidden',
  'Review not found.': 'srv.reviewNotFound',
  'Send a rating and/or a comment.': 'rev.pickStars',
  'Write a message first.': 'srv.chatEmpty',
  'You are sending messages too fast. Wait a minute.': 'srv.chatFast',
  'Conversation not found.': 'srv.chatNotFound',
  'Use a JPEG, PNG or WebP picture.': 'photo.type',
  'This file is not a valid picture. Use a JPEG, PNG or WebP picture.': 'photo.type',
  'Authentication credentials were not provided.': 'srv.needLogin',
  'Invalid or expired token.': 'srv.sessionExpired',
  'Account no longer exists.': 'srv.sessionExpired',
  'You do not have permission to perform this action.': 'srv.noPermission',
  'Lock the chosen rooms and check they are open': 'log.lock',
  'Check that no active booking overlaps these dates': 'log.overlap',
  'Find or create the guest': 'log.guest',
  'Insert the booking': 'log.booking',
  'Insert one room line for each room': 'log.rooms',
  'Insert the payment': 'log.payment',
  'Booking, rooms, and payment saved together.': 'log.commitText',
  'Nothing was saved, so no room is blocked without payment.': 'log.rollbackText'
};

/* Texts with numbers or names inside */
const PATTERNS = [
  [/^Too many wrong passwords\. This account is locked for (\d+) more minutes?\./, (m) => tn('srv.locked', Number(m[1]))],
  [/^Room (\S+) is closed for maintenance\.$/, (m) => t('srv.roomClosed', { room: m[1] })],
  [/^Room (\S+) was just booked by someone else for overlapping dates\.$/, (m) => t('srv.roomTaken', { room: m[1] })],
  [/^Room (\S+) sleeps at most (\d+)\.$/, (m) => t('srv.roomCap', { room: m[1], n: m[2] })],
  [/^Room (\S+) does not exist\.$/, (m) => t('srv.roomMissing', { room: m[1] })],
  [/^Booking must be (\w+) first\.$/, (m) => t('srv.bookingMustBe', { status: t('status.' + m[1]) })],
  [/^A message can have at most (\d+) characters\.$/, (m) => t('srv.chatLong', { n: m[1] })],
  [/^The photo is too big\. The limit is (\d+) MB\.$/, (m) => t('photo.big', { n: m[1] })],
  [/^The picture is too large\. Use one under (\d+) megapixels\.$/, (m) => t('photo.pixels', { n: m[1] })],
  [/^Request was throttled\. Expected available in (\d+) seconds?\.$/, (m) => t('srv.throttled', { n: m[1] })],
  [/^Server error \((\d+)\)\.$/, (m) => t('srv.error', { code: m[1] })],
  [/^Request failed \((\d+)\)\.$/, (m) => t('srv.error', { code: m[1] })]
];

/* Translate one server sentence; several sentences are translated one by one. Unknown text stays as it is. */
export function serverText(text) {
  if (!text || lang === 'en') return text;
  const s = String(text).trim();
  if (SERVER[s]) return t(SERVER[s]);
  for (const [re, fn] of PATTERNS) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  if (s === 'COMMIT' || s === 'ROLLBACK') return s;
  // "A. B." -> translate the parts we know
  const parts = s.split(/(?<=\.)\s+/);
  if (parts.length > 1) return parts.map((p) => serverText(p)).join(' ');
  return s;
}
