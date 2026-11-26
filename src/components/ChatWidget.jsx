import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeChat, getChat, loadCustomerHistory, loadCustomerOlder, sendCustomerMessage, markCustomerRead } from '../chat.js';
import { ChatThread, ChatComposer } from './ChatMessages.jsx';
import AssistantChat from './AssistantChat.jsx';
import { t } from '../i18n/index.js';

/* Floating chat button for guests (and staff). Two tabs: the AI assistant (no login needed)
   and the live support chat with the front office. Admins answer in the Admin panel. */
export default function ChatWidget({ me, onGo, onPick }) {
  const chat = useSyncExternalStore(subscribeChat, getChat);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ai');
  const support = tab === 'support';
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !support || !me || chat.loaded) return;
    loadCustomerHistory().catch((e) => setError(e.message));
  }, [open, support, me, chat.loaded]);

  // reading the chat while it is open marks the hotel's messages read
  useEffect(() => { if (open && support && me) markCustomerRead(); }, [open, support, me, chat.unread, chat.messages.length]);

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
              <h2 id="chat-title" className="sr">{t('chat.support')}</h2>
              <div className="chat-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={!support} onClick={() => setTab('ai')}>{t('ai.tab')}</button>
                <button type="button" role="tab" aria-selected={support} onClick={() => setTab('support')}>
                  {t('chat.support')}{unread > 0 && <span className="chat-badge static">{unread}</span>}
                </button>
              </div>
              <span className="chat-status">
                {support ? (
                  <>
                    <span className={'dot ' + (online ? 'on' : 'off')} aria-hidden="true"></span>
                    {t(!me ? 'chat.loginToWrite' : online ? 'chat.replyFast' : 'chat.connecting')}
                  </>
                ) : t('ai.status')}
              </span>
            </div>
            <button type="button" className="modal-close" aria-label={t('chat.close')} onClick={() => setOpen(false)}>&times;</button>
          </header>

          {!support ? (
            <AssistantChat onPick={(s) => { setOpen(false); onPick(s); }} />
          ) : !me ? (
            <div className="chat-guest">
              <p>{t('chat.guestText')}</p>
              <div className="actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpen(false); onGo('login'); }}>{t('nav.login')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); onGo('register'); }}>{t('nav.signup')}</button>
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
                label={t('chat.withHotel')}
                emptyText={chat.loaded ? t('chat.hello') : t('common.loading')}
              />
              <ChatComposer onSend={sendCustomerMessage} autoFocus />
            </>
          )}
        </section>
      )}

      <button type="button" className="chat-launcher" aria-expanded={open} onClick={() => setOpen(!open)}
        aria-label={open ? t('chat.closeSupport') : t('chat.openSupport') + (unread ? ', ' + t('common.nNew', { n: unread }) : '')}>
        <span aria-hidden="true">{open ? '×' : '💬'}</span>
        <span className="chat-launcher-text">{t(open ? 'common.close' : 'chat.support')}</span>
        {!open && unread > 0 && <span className="chat-badge" aria-hidden="true">{unread}</span>}
      </button>
    </>
  );
}
