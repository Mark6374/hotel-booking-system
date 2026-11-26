/* AI assistant (backend/booking/assistant.py). The conversation lives only in this tab's memory:
   the backend is stateless and gets the last messages with every question. */
import { api } from './api.js';
import { t } from './i18n/index.js';

let state = { messages: [], busy: false, error: '' };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribeAssistant(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getAssistant() { return state; }

let nextId = 1;

export async function askAssistant(text) {
  const question = text.trim().slice(0, 1000);
  if (!question || state.busy) return;
  const mine = { id: nextId++, role: 'user', content: question };
  set({ messages: [...state.messages, mine], busy: true, error: '' });
  // only real answers go back as history (not error bubbles), the last 20 messages
  const history = state.messages.filter((m) => !m.error).slice(-20).map((m) => ({ role: m.role, content: m.content }));
  try {
    const data = await api('/assistant/', { method: 'POST', body: { messages: history } });
    set({ messages: [...state.messages, { id: nextId++, role: 'assistant', content: data.reply || '…', suggestions: data.suggestions || [] }] });
  } catch (e) {
    const why = e.status === 503 || e.status === 502 ? t('ai.unavailable') : e.message;
    set({ messages: [...state.messages, { id: nextId++, role: 'assistant', content: why, error: true }] });
  } finally {
    set({ busy: false });
  }
}

export function clearAssistant() { set({ messages: [], error: '' }); }
