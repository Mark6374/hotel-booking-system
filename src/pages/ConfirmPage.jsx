import { getDb, bookingDetails, fmtDate, money, ref } from '../db.js';

function RenderLog({ log }) {
  return (
    <ol className="txlog">
      {log.map((i, idx) => (
        <li className={(i.ok ? 'ok' : 'fail') + (i.final ? ' final' : '')} key={idx}>
          <span className="mark" aria-hidden="true">{i.ok ? '✓' : '✗'}</span>
          <span>
            <span className="sr">{i.ok ? 'Done: ' : 'Failed: '}</span>
            {i.label}
            {i.detail ? <small>{i.detail}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StatusBadge({ status }) {
  const cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' ? 'good'
    : status === 'Cancelled' || status === 'Failed' ? 'bad'
    : status === 'Refunded' ? 'warn' : '';
  const label = status === 'CheckedIn' ? 'Checked in' : status;
  return <span className={'badge ' + cls}>{label}</span>;
}

export default function ConfirmPage({ headingRef, result, email, onViewMine, onBookAgain }) {
  const db = getDb();
  const b = db.booking.filter((x) => x.booking_id === result.bookingId)[0];
  const g = db.guest.filter((x) => x.guest_id === b.guest_id)[0];
  const d = bookingDetails(b);

  return (
    <>
      <div className="page-head">
        <h1 id="confirm-title" tabIndex={-1} ref={headingRef}>Booking confirmed</h1>
      </div>
      <div id="confirm-body">
        <div className="confirm-card">
          <div className="booking-head"><span className="ref">{ref(b.booking_id)}</span><StatusBadge status={b.status} /></div>
          <div className="booking-meta">
            <span>Guest <strong>{g.first_name} {g.last_name}</strong></span>
            <span>Dates <strong>{fmtDate(b.check_in)} to {fmtDate(b.check_out)}</strong></span>
            <span>Rooms <strong>{d.rooms.join(', ')}</strong></span>
            <span>Total paid <strong>{money(d.total)}</strong> by {d.pay ? d.pay.payment_method.toLowerCase() : ''}</span>
          </div>
          <p className="muted">A confirmation would be sent to {email}.</p>
          <div className="tx-box tx-ok"><h3>What the database did</h3><RenderLog log={result.log} /></div>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onViewMine}>View my bookings</button>
        <button type="button" className="btn btn-ghost" onClick={onBookAgain}>Book another stay</button>
      </div>
    </>
  );
}
