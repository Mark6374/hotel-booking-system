import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { subscribeAssistant, getAssistant, askAssistant, clearAssistant } from '../assistant.js';
import { ChatComposer } from './ChatMessages.jsx';
import { money, fmtDate, typeName } from '../db.js';
import { t, tn } from '../i18n/index.js';

/* The "AI assistant" tab of the chat widget. Works without login: it only reads public data.
   onPick(suggestion) fills in the booking form with the dates, guests and room type. */
export default function AssistantChat({ onPick }) {
  const ai = useSyncExternalStore(subscribeAssistant, getAssistant);
  const box = useRef(null);

  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [ai.messages.length, ai.busy]);

  const examples = [t('ai.ex1'), t('ai.ex2'), t('ai.ex3')];

  return (
    <>
      <div className="chat-thread" ref={box} role="log" aria-live="polite" aria-label={t('ai.title')}>
        {!ai.messages.length && (
          <div className="ai-intro">
            <p className="muted">{t('ai.hello')}</p>
            <div className="ai-examples">
              {examples.map((ex) => (
                <button key={ex} type="button" className="ai-chip" onClick={() => askAssistant(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}
        {ai.messages.map((m) => (
          <div key={m.id} className={'chat-row' + (m.role === 'user' ? ' own' : '')}>
            <div className="chat-bubble-wrap">
              {m.role !== 'user' && <span className="chat-name">{t('ai.name')}</span>}
              <div className={'chat-bubble' + (m.error ? ' failed' : '')}>{m.content}</div>
              {(m.suggestions || []).map((s) => (
                <div className="ai-offer" key={s.room_type_id}>
                  <div>
                    <strong>{typeName(s)}</strong>
                    <small>
                      {fmtDate(s.check_in)} – {fmtDate(s.check_out)} · {tn('n.nights', s.nights)} · {money(s.total)}
                    </small>
                    <small>{t('ai.freeRooms', { n: s.free_rooms })}</small>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(s)}>{t('ai.book')}</button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {ai.busy && <p className="muted ai-typing">{t('ai.thinking')}</p>}
      </div>
      <div>
        <ChatComposer onSend={askAssistant} disabled={ai.busy} placeholder={t('ai.placeholder')} autoFocus />
        <p className="ai-foot">
          {t('ai.disclaimer')}
          {ai.messages.length > 0 && <> · <button type="button" className="link-btn" onClick={clearAssistant}>{t('ai.clear')}</button></>}
        </p>
      </div>
    </>
  );
}
