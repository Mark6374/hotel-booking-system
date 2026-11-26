import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeChat, getChat, loadCustomerHistory, loadCustomerOlder, sendCustomerMessage, markCustomerRead } from '../chat.js';
import { ChatThread, ChatComposer } from './ChatMessages.jsx';

/* Floating "Support" button for guests (and staff). Admins answer in the Admin panel. */
export default function ChatWidget({ me, onGo }) {
  const chat = useSyncExternalStore(subscribeChat, getChat);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !me || chat.loaded) return;
    loadCustomerHistory().catch((e) => setError(e.message));
  }, [open, me, chat.loaded]);

  // reading the chat while it is open marks the hotel's messages read
  useEffect(() => { if (open && me) markCustomerRead(); }, [open, me, chat.unread, chat.messages.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (me && me.role === 'admin') return null;
  const unread = me ? chat.unread : 0;
  const online = chat.status === 'online';

  return (
    <>
      {open && (
        <section className="chat-panel" role="dialog" aria-labelledby="chat-title">
          <header className="chat-head">
            <div>
              <h2 id="chat-title">Support</h2>
              <span className="chat-status">
                <span className={'dot ' + (online ? 'on' : 'off')} aria-hidden="true"></span>
                {!me ? 'Log in to write to us' : online ? 'We usually reply within minutes' : 'Connecting…'}
              </span>
            </div>
            <button type="button" className="modal-close" aria-label="Close chat" onClick={() => setOpen(false)}>&times;</button>
          </header>

          {!me ? (
            <div className="chat-guest">
              <p>Questions about a booking, payment or your stay? Log in and write to the front office. We answer here, and your messages are kept in your account.</p>
              <div className="actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpen(false); onGo('login'); }}>Log in</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); onGo('register'); }}>Sign up</button>
              </div>
            </div>
          ) : (
            <>
              {error && <p className="tx-box tx-fail chat-error" role="alert">{error}</p>}
              <ChatThread
                messages={chat.messages}
                mine={(m) => m.from_customer}
                seenUpTo={chat.seenUpTo}
                hasMore={chat.hasMore}
                onOlder={loadCustomerOlder}
                label="Messages with the hotel"
                emptyText={chat.loaded ? 'Hi! Write your question and the hotel team will answer here.' : 'Loading…'}
              />
              <ChatComposer onSend={sendCustomerMessage} autoFocus />
            </>
          )}
        </section>
      )}

      <button type="button" className="chat-launcher" aria-expanded={open} onClick={() => setOpen(!open)}
        aria-label={open ? 'Close support chat' : 'Open support chat' + (unread ? `, ${unread} new` : '')}>
        <span aria-hidden="true">{open ? '×' : '💬'}</span>
        <span className="chat-launcher-text">{open ? 'Close' : 'Support'}</span>
        {!open && unread > 0 && <span className="chat-badge" aria-hidden="true">{unread}</span>}
      </button>
    </>
  );
}
