/* Juniper Court Hotel – accounts, roles and sign-in, backed by Django.
   Login / sign-up: POST /api/auth/login|register  ->  { token, guest }
   Current account with role: GET /api/account/
   Roles:
     guest – books rooms, sees own bookings and profile
     staff – front desk: check guests in/out, cancel, close rooms
     admin – everything staff can do, plus users, prices and raw data */

import { api, getToken, setToken } from './api.js';
import { reloadDb } from './db.js';

export const ROLES = ['guest', 'staff', 'admin'];
export const ROLE_LABEL = { guest: 'Guest', staff: 'Staff', admin: 'Admin' };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same rule as the backend (booking/serializers.py): at least 6 digits
export const PHONE_RE = /^\+?(?=(?:\D*\d){6})[\d\s()-]{6,20}$/;
export const PHONE_MESSAGE = 'Enter at least 6 digits. Spaces, ( ) - and a + at the start are allowed.';

/* Same rule as the backend (min 8, not only digits), plus a letter and a digit. */
export function passwordProblem(pw) {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one digit.';
  return '';
}

/* 0–4, for the strength meter on the sign-up form. */
export function passwordScore(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  else if (/\d/.test(pw)) s += 0.5;
  return Math.min(4, Math.floor(s));
}

/* Created by `manage.py seed_demo` + `manage.py seed_roles`. */
export const DEMO_ACCOUNTS = [
  { email: 'admin@junipercourt.example', password: 'Admin12345', role: 'admin' },
  { email: 'staff@junipercourt.example', password: 'Staff12345', role: 'staff' },
  { email: 'saltanat@gmail.com', password: 'demo12345', role: 'guest' }
];

/* ---------- State ---------- */

/* Backend shape -> what the pages use (account_id, active). */
function toAccount(a) {
  if (!a) return null;
  return {
    account_id: a.guest_id,
    email: a.email,
    first_name: a.first_name,
    last_name: a.last_name,
    phone: a.phone,
    role: a.role || 'guest',
    locked_minutes: a.locked_minutes || 0,
    active: a.is_active !== false
  };
}

let snapshot = { ready: false, me: null, accounts: [] };
const listeners = new Set();

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuth() { return snapshot; }

async function loadMe() {
  const me = toAccount(await api('/account/'));
  set({ me, ready: true });
  if (me.role === 'admin') loadAccounts();
  return me;
}

/* On page load: turn a saved token back into a session. */
export async function restoreSession() {
  if (!getToken()) { set({ ready: true }); return null; }
  try {
    return await loadMe();
  } catch (e) {
    if (e.status === 401 || e.status === 403) setToken('');
    set({ me: null, ready: true });
    return null;
  }
}

/* ---------- Sign in / sign up / sign out ---------- */

async function startSession(token, remember) {
  setToken(token, remember);
  try {
    // First load the data this account may see, then open its pages,
    // so "My bookings" never shows the empty visitor data.
    await reloadDb();
    return await loadMe();
  } catch (e) {
    setToken('');
    set({ me: null });
    throw e; // e.g. "This account is blocked."
  }
}

export async function login(email, password, remember) {
  const r = await api('/auth/login/', { method: 'POST', body: { email: email.trim(), password } });
  return startSession(r.token, remember);
}

export async function register(form) {
  const r = await api('/auth/register/', {
    method: 'POST',
    body: {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      password: form.password
    }
  });
  const me = await startSession(r.token, true);
  reloadDb(); // the new guest row
  return me;
}

/* Tokens are stateless on the server, so logging out = forgetting the token. */
export function logout() {
  setToken('');
  set({ me: null, accounts: [] });
  reloadDb(); // forget the private data of the account that logged out
}

/* ---------- Self-service ---------- */

export async function updateProfile(id, fields) {
  const me = toAccount(await api('/account/', {
    method: 'PATCH',
    body: { first_name: fields.first_name.trim(), last_name: fields.last_name.trim(), phone: fields.phone.trim() }
  }));
  set({ me });
  reloadDb();
}

export async function changePassword(id, oldPw, newPw) {
  await api('/account/password/', { method: 'POST', body: { old_password: oldPw, new_password: newPw } });
}

/* ---------- Admin ---------- */

export async function loadAccounts() {
  try {
    const rows = await api('/admin/accounts/');
    set({ accounts: rows.map(toAccount) });
  } catch (e) { /* not an admin or server down: keep the old list */ }
}

export async function setRole(id, role) {
  await api('/admin/accounts/' + id + '/', { method: 'PATCH', body: { role } });
  await loadAccounts();
}

export async function setActive(id, active) {
  await api('/admin/accounts/' + id + '/', { method: 'PATCH', body: { is_active: active } });
  await loadAccounts();
}

/* Removes the 15-minute lock after 5 wrong passwords. */
export async function unlockAccount(id) {
  await api('/admin/accounts/' + id + '/', { method: 'PATCH', body: { unlock: true } });
  await loadAccounts();
}

/* Removes the login only; the guest row and bookings stay in the database. */
export async function deleteAccount(id) {
  await api('/admin/accounts/' + id + '/', { method: 'DELETE' });
  await loadAccounts();
}

/* ---------- Access rules ---------- */

/* Which roles may open each page. Pages not listed are public. */
export const ACCESS = {
  account: ['guest', 'staff', 'admin'],
  checkout: ['guest', 'staff', 'admin'],
  confirm: ['guest', 'staff', 'admin'],
  staff: ['staff', 'admin'],
  admin: ['admin']
};

export function canOpen(view, me) {
  const roles = ACCESS[view];
  if (!roles) return true;
  return !!me && roles.indexOf(me.role) !== -1;
}

export function homeFor(me) {
  if (!me) return 'home';
  if (me.role === 'admin') return 'admin';
  if (me.role === 'staff') return 'staff';
  return 'account';
}

/* ---------- Forgot password ---------- */

/* Asks the server to email a reset link. With DEBUG on, the server also returns the token. */
export async function requestPasswordReset(email) {
  return api('/auth/password-reset/', { method: 'POST', body: { email: email.trim() } });
}

export async function confirmPasswordReset(token, newPassword) {
  return api('/auth/password-reset/confirm/', { method: 'POST', body: { token, new_password: newPassword } });
}
