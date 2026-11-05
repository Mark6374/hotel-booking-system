import { useState } from 'react';
import { getDb, bookingDetails, fmtDate, money, ref, todayISO, cancelBooking } from '../db.js';

function StatusBadge({ status }) {
  const cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' ? 'good'
    : status === 'Cancelled' || status === 'Failed' ? 'bad'
    : status === 'Refunded' ? 'warn' : '';
  const label = status === 'CheckedIn' ? 'Checked in' : status;
  return <span className={'badge ' + cls}>{label}</span>;
}

export default function MinePage({ headingRef, session, lastEmail }) {
  const db = getDb();
  const [manualEmail, setManualEmail] = useState(lastEmail || '');
  const [looked, setLooked] = useState(false);
  const [status, setStatus] = useState('');

  const email = session || (looked ? manualEmail : '');

  function lookup(e) {
    e.preventDefault();
    setStatus('');
    setLooked(true);
  }

  function onCancel(id) {
    const refunded = cancelBooking(id);
    setStatus('Booking ' + ref(id) + ' cancelled.' + (refunded ? ' The payment is marked as refunded.' : ''));
  }

  const g = email ? db.guest.filter((x) => x.email.toLowerCase() === email.toLowerCase())[0] : null;
  const list = g ? db.booking.filter((b) => b.guest_id === g.guest_id).slice().sort((a, b) => b.booking_id - a.booking_id) : [];

  return (
    <>
      <div className="page-head">
        <h1 id="mine-title" tabIndex={-1} ref={headingRef}>My bookings</h1>
        {session ? (
          <p className="lead">Showing bookings for <strong>{session}</strong> (logged in).</p>
        ) : (
          <p className="lead">Enter the email you booked with, or <strong>log in</strong> to skip this next time. Try <strong>amina@example.com</strong> to see sample bookings.</p>
        )}
      </div>

      {!session && (
        <form className="inline-form" noValidate onSubmit={lookup}>
          <div className="field">
            <label htmlFor="mine-email">Email</label>
            <input type="email" id="mine-email" autoComplete="email" value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value.trim())} />
          </div>
          <button type="submit" className="btn btn-primary">Find my bookings</button>
        </form>
      )}

      <p className="status" role="status">{status}</p>

      <div id="mine-results">
        {!email ? null : !list.length ? (
          <p className="empty">No bookings found for {email}. Check the spelling, or book a room first.</p>
        ) : (
          <div className="booking-list">
            {list.map((b) => {
              const d = bookingDetails(b);
              const canCancel = b.status === 'Confirmed' && b.check_in >= todayISO();
              return (
                <article className="booking-card" key={b.booking_id}>
                  <div className="booking-head"><span className="ref">{ref(b.booking_id)}</span><StatusBadge status={b.status} /></div>
                  <div className="booking-meta">
                    <span>Dates <strong>{fmtDate(b.check_in)} to {fmtDate(b.check_out)}</strong></span>
                    <span>Nights <strong>{d.n}</strong></span>
                    <span>Rooms <strong>{d.rooms.join(', ')}</strong></span>
                    <span>Total <strong>{money(d.total)}</strong></span>
                    <span>Payment {d.pay ? <StatusBadge status={d.pay.payment_status} /> : <strong>None</strong>}</span>
                  </div>
                  {canCancel && (
                    <div><button type="button" className="btn btn-danger" onClick={() => onCancel(b.booking_id)}>Cancel booking {ref(b.booking_id)}</button></div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
