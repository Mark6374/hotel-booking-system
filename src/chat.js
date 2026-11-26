/* Support chat (customer <-> admin), backend/PHOTOS_AND_CHAT_API.md.
   One WebSocket per logged-in account, opened with a one-minute ticket from POST /api/chat/ticket/
   (the login token never goes into a URL). Messages are saved by the server first and then pushed
   to everybody, the sender included, so the screen is drawn from the server's "message.new".
   If the socket is down, sending falls back to the REST endpoints (they push too).

   Customer: state.messages is his one conversation.
   Admin:    state.inbox lists the conversations; state.threads[id] holds an opened one. */

import { api } from './api.js';
import { t } from './i18n/index.js';

const RETRY_MAX_MS = 30000;
let ws = null;
let wantOpen = false;
let retry = 0;
let retryTimer = 0;
let pingTimer = 0;
let localId = 0;

const empty = () => ({
  status: 'off',          // off | connecting | online | offline
  role: null,             // 'customer' | 'admin'
  me: null,               // guest_id
  // customer
  conversationId: null,
  messages: [],
  hasMore: false,
  nextBefore: null,
  loaded: false,
  unread: 0,
  seenUpTo: 0,            // the admin has read my messages up to this id
  // admin
  inbox: [],
  inboxLoaded: false,
  unreadTotal: 0,
  threads: {}             // id -> { guest, messages, hasMore, nextBefore, loaded, seenUpTo }
});

let state = empty();
const listeners = new Set();

export function subscribeChat(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getChat() { return state; }

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function setThread(id, patch) {
  const old = state.threads[id] || { guest: null, messages: [], hasMore: false, nextBefore: null, loaded: false, seenUpTo: 0 };
  set({ threads: { ...state.threads, [id]: { ...old, ...patch } } });
}

/* Insert or replace by message_id (and swap the "sending…" copy by client_id), keep order by id. */
function merge(list, msg) {
  const out = list.filter((m) => m.message_id !== msg.message_id && !(msg.client_id && m.client_id === msg.client_id && m.pending));
  out.push(msg);
  return out.sort((a, b) => (a.message_id || Infinity) - (b.message_id || Infinity));
}

const lastId = (list) => list.reduce((n, m) => (m.message_id && m.message_id > n ? m.message_id : n), 0);

/* ---------- Connection ---------- */

export function startChat(me) {
  stopChat();
  if (!me) return;
  wantOpen = true;
  state = { ...empty(), me: me.account_id, role: me.role === 'admin' ? 'admin' : 'customer', status: 'connecting' };
  listeners.forEach((fn) => fn());
  connect();
}

export function stopChat() {
  wantOpen = false;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  state = empty();
  listeners.forEach((fn) => fn());
}

async function connect() {
  if (!wantOpen) return;
  set({ status: 'connecting' });
  let ticket;
  try {
    ticket = await api('/chat/ticket/', { method: 'POST' });
  } catch (e) {
    scheduleRetry();
    return;
  }
  if (!wantOpen) return;
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const sock = new WebSocket(proto + location.host + ticket.path + '?ticket=' + encodeURIComponent(ticket.ticket));
  ws = sock;
  sock.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch (err) { return; }
    onEvent(data);
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    if (!wantOpen) return;
    set({ status: 'offline' });
    if (e.code === 4403) return;      // blocked or role changed: the app reloads the account
    scheduleRetry();
  };
}

function scheduleRetry() {
  if (!wantOpen) return;
  set({ status: 'offline' });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, Math.min(RETRY_MAX_MS, 1000 * 2 ** retry++));
}

function sendFrame(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}

/* ---------- Events from the server ---------- */

function onEvent(ev) {
  if (ev.type === 'ready') {
    retry = 0;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sendFrame({ type: 'ping' }), 25000);
    if (ev.role === 'admin') {
      set({ status: 'online', role: 'admin', unreadTotal: ev.unread || 0 });
      if (state.inboxLoaded) loadInbox();                                      // catch up after a reconnect
      Object.keys(state.threads).forEach((id) => catchUpThread(Number(id)));
    } else {
      set({ status: 'online', role: 'customer', conversationId: ev.conversation_id, unread: ev.unread || 0 });
      if (state.loaded) catchUpCustomer();
    }
    return;
  }
  if (ev.type === 'message.new') { onMessage(ev.message, ev.conversation); return; }
  if (ev.type === 'messages.read') { onRead(ev); return; }
  if (ev.type === 'error' && ev.client_id) markFailed(ev.client_id, ev.detail);
}

function onMessage(msg, conv) {
  if (state.role === 'admin') {
    const id = msg.conversation_id;
    const row = state.inbox.find((r) => r.conversation_id === id);
    const unreadNow = conv && conv.unread ? conv.unread.for_admin : 0;
    const newRow = {
      conversation_id: id,
      guest: (conv && conv.guest) || (row && row.guest),
      unread: { for_admin: unreadNow, for_customer: conv && conv.unread ? conv.unread.for_customer : 0 },
      last_message: { message_id: msg.message_id, preview: msg.body.slice(0, 120), from_customer: msg.from_customer, created_at: msg.created_at },
      last_message_at: msg.created_at
    };
    const delta = unreadNow - (row ? (row.unread || {}).for_admin || 0 : 0);
    set({
      inbox: [newRow].concat(state.inbox.filter((r) => r.conversation_id !== id)),
      unreadTotal: Math.max(0, state.unreadTotal + delta)
    });
    if (state.threads[id]) setThread(id, { messages: merge(state.threads[id].messages, msg) });
    return;
  }
  set({
    conversationId: msg.conversation_id,
    messages: merge(state.messages, msg),
    unread: conv && conv.unread ? conv.unread.for_customer : state.unread
  });
}

function onRead(ev) {
  if (state.role === 'admin') {
    if (ev.reader === 'customer') {
      if (state.threads[ev.conversation_id]) {
        setThread(ev.conversation_id, { seenUpTo: Math.max(state.threads[ev.conversation_id].seenUpTo, ev.up_to || 0) });
      }
    } else {
      // read by an admin (this tab or another one): clear the row's badge
      const row = state.inbox.find((r) => r.conversation_id === ev.conversation_id);
      const had = row ? (row.unread || {}).for_admin || 0 : ev.count || 0;
      set({
        inbox: state.inbox.map((r) => (r.conversation_id === ev.conversation_id ? { ...r, unread: { ...r.unread, for_admin: 0 } } : r)),
        unreadTotal: Math.max(0, state.unreadTotal - had)
      });
    }
    return;
  }
  if (ev.reader === 'admin') set({ seenUpTo: Math.max(state.seenUpTo, ev.up_to || 0) });
  else set({ unread: 0 });
}

function markFailed(clientId, detail) {
  const fail = (list) => list.map((m) => (m.client_id === clientId ? { ...m, pending: false, failed: detail || t('chat.failed') } : m));
  if (state.role === 'admin') {
    Object.keys(state.threads).forEach((id) => setThread(Number(id), { messages: fail(state.threads[id].messages) }));
  } else {
    set({ messages: fail(state.messages) });
  }
}

/* ---------- Customer ---------- */

export async function loadCustomerHistory() {
  const r = await api('/chat/messages/');
  set({ messages: r.results, hasMore: r.has_more, nextBefore: r.next_before, loaded: true });
}

export async function loadCustomerOlder() {
  if (!state.nextBefore) return;
  const r = await api('/chat/messages/?before=' + state.nextBefore);
  set({ messages: r.results.concat(state.messages), hasMore: r.has_more, nextBefore: r.next_before });
}

async function catchUpCustomer() {
  try {
    const r = await api('/chat/messages/?after=' + lastId(state.messages));
    let list = state.messages;
    r.results.forEach((m) => { list = merge(list, m); });
    set({ messages: list });
  } catch (e) { /* next reconnect tries again */ }
}

export async function sendCustomerMessage(body) {
  const text = body.trim();
  if (!text) return;
  const client_id = 'c' + Date.now() + '-' + (++localId);
  set({ messages: state.messages.concat({ client_id, body: text, from_customer: true, pending: true, created_at: new Date().toISOString() }) });
  if (sendFrame({ type: 'message.send', body: text, client_id })) return;
  try {
    const msg = await api('/chat/messages/', { method: 'POST', body: { body: text, client_id } });
    set({ messages: merge(state.messages, msg) });
  } catch (e) {
    markFailed(client_id, e.message);
  }
}

export function markCustomerRead() {
  if (!state.unread) return;
  set({ unread: 0 });
  if (!sendFrame({ type: 'read' })) api('/chat/read/', { method: 'POST' }).catch(() => {});
}

/* ---------- Admin ---------- */

export async function loadInbox({ q = '', unread = false } = {}) {
  const params = new URLSearchParams({ limit: '100' });
  if (q.trim()) params.set('q', q.trim());
  if (unread) params.set('unread', '1');
  const r = await api('/chat/admin/conversations/?' + params.toString());
  set({ inbox: r.results, inboxLoaded: true, unreadTotal: r.unread_total });
  return r;
}

export async function openThread(id) {
  const r = await api('/chat/admin/conversations/' + id + '/messages/');
  setThread(id, { guest: r.guest, messages: r.results, hasMore: r.has_more, nextBefore: r.next_before, loaded: true });
}

export async function loadThreadOlder(id) {
  const th = state.threads[id];
  if (!th || !th.nextBefore) return;
  const r = await api('/chat/admin/conversations/' + id + '/messages/?before=' + th.nextBefore);
  setThread(id, { messages: r.results.concat(th.messages), hasMore: r.has_more, nextBefore: r.next_before });
}

async function catchUpThread(id) {
  const th = state.threads[id];
  if (!th || !th.loaded) return;
  try {
    const r = await api('/chat/admin/conversations/' + id + '/messages/?after=' + lastId(t.messages));
    let list = state.threads[id].messages;
    r.results.forEach((m) => { list = merge(list, m); });
    setThread(id, { messages: list });
  } catch (e) { /* ignore */ }
}

export async function sendAdminReply(id, body) {
  const text = body.trim();
  if (!text) return;
  const client_id = 'a' + Date.now() + '-' + (++localId);
  const th = state.threads[id];
  setThread(id, { messages: (th ? th.messages : []).concat({ client_id, body: text, from_customer: false, pending: true, created_at: new Date().toISOString() }) });
  if (sendFrame({ type: 'message.send', conversation_id: id, body: text, client_id })) return;
  try {
    const msg = await api('/chat/admin/conversations/' + id + '/messages/', { method: 'POST', body: { body: text, client_id } });
    setThread(id, { messages: merge(state.threads[id].messages, msg) });
  } catch (e) {
    markFailed(client_id, e.message);
  }
}

export function markThreadRead(id) {
  const row = state.inbox.find((r) => r.conversation_id === id);
  if (!row || !(row.unread || {}).for_admin) return;
  if (!sendFrame({ type: 'read', conversation_id: id })) {
    api('/chat/admin/conversations/' + id + '/read/', { method: 'POST' })
      .then(() => onRead({ reader: 'admin', conversation_id: id }))
      .catch(() => {});
  }
}

/* "Seen" under my own messages. */
export function isSeen(msg, seenUpTo) {
  return !!msg.message_id && (!!msg.read_at || msg.message_id <= (seenUpTo || 0));
}
