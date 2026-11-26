import { t } from '../i18n/index.js';

export default function Forbidden({ headingRef, me, needed, onHome, onLogout }) {
  const names = needed.map((r) => t('role.' + r)).join(t('common.or'));
  return (
    <div className="gate">
      <p className="gate-code">403</p>
      <h1 tabIndex={-1} ref={headingRef}>{t('forbidden.title')}</h1>
      <p className="lead">
        {t('forbidden.text', { email: me.email, role: t('role.' + me.role), roles: names })}
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onHome}>{t('forbidden.home')}</button>
        <button type="button" className="btn btn-ghost" onClick={onLogout}>{t('nav.logout')}</button>
      </div>
    </div>
  );
}
