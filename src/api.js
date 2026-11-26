/* Thin client for the Django REST backend (see backend/AUTH.md).
   Auth: "Authorization: Bearer <token>" from /api/auth/login|register. */

import { t, serverText } from './i18n/index.js';

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
/* Server texts are English; serverText() translates the ones the site knows. */
function messageFrom(data, status) {
  if (!data || typeof data !== 'object') return t('srv.error', { code: status || '' });
  if (typeof data.detail === 'string') return serverText(data.detail);
  const parts = [];
  Object.keys(data).forEach((k) => {
    const list = Array.isArray(data[k]) ? data[k] : typeof data[k] === 'string' ? [data[k]] : [];
    list.forEach((v) => { if (typeof v === 'string' && v) parts.push(serverText(v)); });
  });
  return parts.join(' ') || t('srv.error', { code: status });
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  // A FormData body (file upload) sets its own multipart Content-Type with the boundary.
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(t('srv.unreachable'), 0, null);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or HTML body */ }
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status, data);
  return data;
}

/* Photo paths from the API ('/api/photos/x.jpg') work as they are with the Vite proxy; with an
   absolute VITE_API_URL the backend host is put in front. */
export function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:/.test(path) || !/^https?:/.test(BASE)) return path;
  return BASE.replace(/\/api\/?$/, '') + path;
}
