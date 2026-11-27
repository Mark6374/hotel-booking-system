/* "Someone tried to log in to your account" (week 13, tester 24B032036).
   Shown after a successful login when there were wrong passwords for this
   account since the last login. Buttons: change the password, or "It was me". */
import { t, tn } from '../i18n/index.js';
import { dateShort } from '../i18n/dates.js';

const pad = (n) => (n < 10 ? '0' : '') + n;

function when(iso) {
  // server time with zone, e.g. '2026-11-27T08:29:10+00:00' -> "27 Nov 2026, 13:29" in the guest's local time
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return dateShort(day) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export default function SecurityNotice({ notice, onChangePassword, onDismiss }) {
  return (
    <section className="security-notice" role="alert" aria-labelledby="security-notice-title">
      <div className="security-notice-text">
        <h2 id="security-notice-title">{t('sec.title')}</h2>
        <p>
          {tn('sec.attempts', notice.failed_attempts)}{' '}
          {t('sec.lastAt', { when: when(notice.last_failed_at) })}
        </p>
        {notice.was_locked && <p>{t('sec.wasLocked', { when: when(notice.last_locked_at) })}</p>}
        <p className="security-notice-hint">{t('sec.hint')}</p>
      </div>
      <div className="security-notice-actions">
        <button type="button" className="btn btn-primary" onClick={onChangePassword}>{t('sec.change')}</button>
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>{t('sec.itWasMe')}</button>
      </div>
    </section>
  );
}
