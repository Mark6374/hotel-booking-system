import { getDb, bookingDetails, fmtDate, money, ref } from '../db.js';
import { t } from '../i18n/index.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { RenderLog } from './CheckoutPage.jsx';

export default function ConfirmPage({ headingRef, result, email, onViewMine, onBookAgain }) {
  const db = getDb();
  const b = db.booking.filter((x) => x.booking_id === result.bookingId)[0];
  const g = db.guest.filter((x) => x.guest_id === b.guest_id)[0];
  const d = bookingDetails(b);

  return (
    <>
      <div className="page-head">
        <h1 id="confirm-title" tabIndex={-1} ref={headingRef}>{t('confirm.title')}</h1>
      </div>
      <div id="confirm-body">
        <div className="confirm-card">
          <div className="booking-head"><span className="ref">{ref(b.booking_id)}</span><StatusBadge status={b.status} /></div>
          <div className="booking-meta">
            <span>{t('confirm.guest')} <strong>{g.first_name} {g.last_name}</strong></span>
            <span>{t('bk.dates')} <strong>{t('bk.range', { from: fmtDate(b.check_in), to: fmtDate(b.check_out) })}</strong></span>
            <span>{t('bk.rooms')} <strong>{d.rooms.join(', ')}</strong></span>
            <span>{t('confirm.paid')} <strong>{money(d.total)}</strong> · {d.pay ? t('method.' + d.pay.payment_method) : ''}</span>
          </div>
          <p className="muted">{t('confirm.emailNote', { email })}</p>
          <div className="tx-box tx-ok"><h3>{t('confirm.dbDid')}</h3><RenderLog log={result.log} /></div>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onViewMine}>{t('confirm.toMine')}</button>
        <button type="button" className="btn btn-ghost" onClick={onBookAgain}>{t('confirm.again')}</button>
      </div>
    </>
  );
}
