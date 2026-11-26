import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { isSeen } from '../chat.js';

function time(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat('en-GB', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/* Message list + composer, used by the customer widget and the admin inbox.
   mine(msg) decides which side a message is on. Text is shown as text, never as HTML. */
export function ChatThread({ messages, mine, seenUpTo, hasMore, onOlder, emptyText, label }) {
  const box = useRef(null);
  const stick = useRef(true);
  const lastCount = useRef(0);

  // keep the view at the bottom when new messages arrive (unless the user scrolled up to read)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (stick.current || messages.length - lastCount.current > 20) el.scrollTop = el.scrollHeight;
    lastCount.current = messages.length;
  }, [messages]);

  async function older() {
    const el = box.current;
    const before = el.scrollHeight;
    stick.current = false;
    await onOlder();
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before; });
  }

  const lastMine = [...messages].reverse().find((m) => mine(m) && m.message_id);

  return (
    <div className="chat-thread" ref={box} role="log" aria-live="polite" aria-label={label}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {hasMore && <button type="button" className="link-btn chat-older" onClick={older}>Load earlier messages</button>}
      {!messages.length && <p className="muted chat-empty">{emptyText}</p>}
      {messages.map((m) => {
        const own = mine(m);
        return (
          <div key={m.message_id || m.client_id} className={'chat-row' + (own ? ' own' : '')}>
            {!own && <Avatar person={{ first_name: m.sender_name, last_name: '', photo_url: m.sender_photo_url }} size="sm" />}
            <div className="chat-bubble-wrap">
              {!own && <span className="chat-name">{m.sender_name}</span>}
              <div className={'chat-bubble' + (m.failed ? ' failed' : '')}>{m.body}</div>
              <span className="chat-meta">
                {m.pending ? 'Sending…' : m.failed ? 'Not sent: ' + m.failed : time(m.created_at)}
                {own && lastMine && m.message_id === lastMine.message_id && isSeen(m, seenUpTo) ? ' · Seen' : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatComposer({ onSend, disabled, placeholder, autoFocus }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);

  function send(e) {
    if (e) e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  }

  return (
    <form className="chat-composer" onSubmit={send}>
      <label className="sr" htmlFor="chat-input">Message</label>
      <textarea id="chat-input" ref={ref} rows={1} maxLength={2000} value={text} placeholder={placeholder || 'Write a message…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={disabled || !text.trim()}>Send</button>
    </form>
  );
}
