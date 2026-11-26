import { useSyncExternalStore } from 'react';
import { LANGS, getLang, setLang, subscribeLang, t } from '../i18n/index.js';

/* EN · RU · KZ switch in the header. */
export default function LangSwitch() {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l.id} type="button" lang={l.id} aria-pressed={lang === l.id} title={l.name}
          aria-label={l.name} onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
