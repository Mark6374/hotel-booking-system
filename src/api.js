/* Thin client for the Django REST backend (see backend/AUTH.md).
   Auth: "Authorization: Bearer <token>" from /api/auth/login|register. */

const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'juniper-court-token-v2';

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

export function setToken(token, remember) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch (e) { /* ignore */ }
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/* Turns DRF error bodies ({detail}, {field: [msg]}, {non_field_errors: [..]}) into one sentence. */
function messageFrom(data, status) {
  if (!data || typeof data !== 'object') return status ? 'Server error (' + status + ').' : 'Server error.';
  if (typeof data.detail === 'string') return data.detail;
  const parts = [];
  Object.keys(data).forEach((k) => {
    const v = Array.isArray(data[k]) ? data[k].join(' ') : typeof data[k] === 'string' ? data[k] : '';
    if (v) parts.push(v);
  });
  return parts.join(' ') || 'Request failed (' + status + ').';
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError('Cannot reach the server. Is the Django backend running on port 8000?', 0, null);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or HTML body */ }
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status, data);
  return data;
}
