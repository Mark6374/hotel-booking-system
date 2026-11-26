import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeChat, getChat, loadInbox, openThread, loadThreadOlder, sendAdminReply, markThreadRead } from '../chat.js';
import { ChatThread, ChatComposer } from './ChatMessages.jsx';
import Avatar from './Avatar.jsx';
import { t } from '../i18n/index.js';
import { inboxTime } from '../i18n/dates.js';

function when(iso) { return iso ? inboxTime(iso) : ''; }

/* Admin inbox: every customer conversation, newest activity first; any admin can reply. */
export default function AdminChat() {
  const chat = useSyncExternalStore(subscribeChat, getChat);
  const [query, setQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => loadInbox({ q: query, unread: onlyUnread }).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(timer);
  }, [query, onlyUnread]);

  useEffect(() => {
    if (selected) openThread(selected).catch((e) => setError(e.message));
  }, [selected]);

  const thread = selected ? chat.threads[selected] : null;
  // an open conversation is read: new customer messages are marked read right away
  useEffect(() => { if (selected && thread && thread.loaded) markThreadRead(selected); }, [selected, thread, chat.inbox]);

  const row = chat.inbox.find((r) => r.conversation_id === selected);
  const guest = (thread && thread.guest) || (row && row.guest);

  return (
    <>
      <p className="lead">
        {t('chat.adminLead')}{' '}
        <span className={'chat-status-inline ' + (chat.status === 'online' ? 'on' : 'off')}>
          <span className={'dot ' + (chat.status === 'online' ? 'on' : 'off')} aria-hidden="true"></span>
          {t(chat.status === 'online' ? 'chat.connected' : 'chat.connecting')}
        </span>
      </p>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}

      <div className={'inbox' + (selected ? ' has-thread' : '')}>
        <div className="inbox-list">
          <div className="inbox-tools">
            <label className="sr" htmlFor="inbox-q">{t('chat.searchLabel')}</label>
            <input type="text" id="inbox-q" placeholder={t('admin.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="chip" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(!onlyUnread)}>{t('chat.unread')}</button>
          </div>
          {!chat.inboxLoaded ? <p className="muted inbox-empty">{t('common.loading')}</p> : !chat.inbox.length ? (
            <p className="muted inbox-empty">{t(query || onlyUnread ? 'chat.noMatch' : 'chat.noInbox')}</p>
          ) : (
            <ul>
              {chat.inbox.map((c) => {
                const n = (c.unread || {}).for_admin || 0;
                return (
                  <li key={c.conversation_id}>
                    <button type="button" className={'inbox-row' + (n ? ' unread' : '')} aria-current={selected === c.conversation_id ? 'true' : undefined}
                      onClick={() => setSelected(c.conversation_id)}>
                      <Avatar person={c.guest} size="sm" />
                      <span className="inbox-text">
                        <span className="inbox-top">
                          <strong>{c.guest.first_name} {c.guest.last_name}</strong>
                          <small className="muted">{when(c.last_message_at)}</small>
                        </span>
                        <span className="inbox-preview muted">
                          {c.last_message && !c.last_message.from_customer ? t('chat.you') + ' ' : ''}{c.last_message ? c.last_message.preview : ''}
                        </span>
                      </span>
                      {n > 0 && <span className="chat-badge static" aria-label={t('chat.nUnread', { n })}>{n}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="inbox-thread">
          {!selected ? (
            <p className="muted inbox-empty">{t('chat.choose')}</p>
          ) : (
            <>
              <div className="inbox-thread-head">
                <button type="button" className="link-btn inbox-back" onClick={() => setSelected(0)}>&larr; {t('chat.all')}</button>
                {guest && (
                  <div className="inbox-guest">
                    <Avatar person={guest} size="sm" />
                    <div><strong>{guest.first_name} {guest.last_name}</strong><small className="cell-sub">{guest.email}</small></div>
                  </div>
                )}
              </div>
              <ChatThread
                messages={thread ? thread.messages : []}
                mine={(m) => !m.from_customer}
                seenUpTo={thread ? thread.seenUpTo : 0}
                hasMore={thread ? thread.hasMore : false}
                onOlder={() => loadThreadOlder(selected)}
                label={guest ? t('chat.with', { name: guest.first_name + ' ' + guest.last_name }) : t('chat.messages')}
                emptyText={t(thread && thread.loaded ? 'chat.noMessages' : 'common.loading')}
              />
              <ChatComposer key={selected} onSend={(text) => sendAdminReply(selected, text)} placeholder={t('chat.replyPh')} autoFocus />
            </>
          )}
        </div>
      </div>
    </>
  );
}
