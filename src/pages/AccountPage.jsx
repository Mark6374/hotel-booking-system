import { useState } from 'react';
import { getDb, bookingDetails, fmtDate, money, ref, todayISO, cancelBooking, guestByEmail } from '../db.js';
import { updateProfile, changePassword, passwordProblem, ROLE_LABEL, PHONE_RE, PHONE_MESSAGE } from '../auth.js';
import StatusBadge from '../components/StatusBadge.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

const TABS = [
  { id: 'bookings', label: 'My bookings' },
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password' }
];

function Bookings({ me, onGo }) {
  const db = getDb();
  const [status, setStatus] = useState('');
  const g = guestByEmail(db, me.email);
  const list = g ? db.booking.filter((b) => b.guest_id === g.guest_id).slice().sort((a, b) => b.booking_id - a.booking_id) : [];
  const today = todayISO();
  const upcoming = list.filter((b) => (b.status === 'Confirmed' || b.status === 'CheckedIn') && b.check_out >= today);
  const past = list.filter((b) => upcoming.indexOf(b) === -1);

  async function onCancel(id) {
    try {
      const refunded = await cancelBooking(id);
      setStatus('Booking ' + ref(id) + ' cancelled.' + (refunded ? ' The payment is marked as refunded.' : ''));
    } catch (e) {
      setStatus(e.message);
    }
  }

  function card(b) {
    const d = bookingDetails(b);
    const canCancel = b.status === 'Confirmed' && b.check_in >= today;
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
  }

  return (
    <>
      <p className="status" role="status">{status}</p>
      {!list.length ? (
        <div className="empty-card">
          <p>You have no bookings yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => onGo('book')}>Book a room</button>
        </div>
      ) : (
        <>
          <h2 className="sub-h">Upcoming ({upcoming.length})</h2>
          {upcoming.length ? <div className="booking-list">{upcoming.map(card)}</div> : <p className="empty">No upcoming stays.</p>}
          <h2 className="sub-h">Past and cancelled ({past.length})</h2>
          {past.length ? <div className="booking-list">{past.map(card)}</div> : <p className="empty">Nothing here yet.</p>}
        </>
      )}
    </>
  );
}

function Profile({ me }) {
  const [f, setF] = useState({ first_name: me.first_name, last_name: me.last_name, phone: me.phone });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');

  async function submit(e) {
    e.preventDefault();
    setStatus('');
    const errs = {};
    if (!f.first_name.trim()) errs.first_name = 'Enter your first name.';
    if (!f.last_name.trim()) errs.last_name = 'Enter your last name.';
    if (!PHONE_RE.test(f.phone.trim())) errs.phone = PHONE_MESSAGE;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await updateProfile(me.account_id, f);
      setStatus('Profile saved.');
    } catch (err) {
      setErrors({ phone: err.message });
    }
  }

  return (
    <form className="panel-form" noValidate onSubmit={submit}>
      <div className="row-2">
        <div className="field">
          <label htmlFor="p-first">First name</label>
          <input type="text" id="p-first" maxLength={50} value={f.first_name} aria-invalid={errors.first_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <p className="field-error">{errors.first_name || ''}</p>
        </div>
        <div className="field">
          <label htmlFor="p-last">Last name</label>
          <input type="text" id="p-last" maxLength={50} value={f.last_name} aria-invalid={errors.last_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, last_name: e.target.value })} />
          <p className="field-error">{errors.last_name || ''}</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-email">Email</label>
        <input type="email" id="p-email" value={me.email} readOnly aria-describedby="p-email-hint" />
        <p className="hint" id="p-email-hint">Your email is your login and cannot be changed here.</p>
      </div>
      <div className="field">
        <label htmlFor="p-phone">Phone</label>
        <input type="tel" id="p-phone" maxLength={20} value={f.phone} aria-invalid={errors.phone ? 'true' : undefined}
          onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <p className="field-error">{errors.phone || ''}</p>
      </div>
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">Save changes</button>
    </form>
  );
}

function Security({ me }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function submit(e) {
    e.preventDefault();
    setStatus('');
    const problem = !oldPw ? 'Enter your current password.'
      : passwordProblem(newPw) || (newPw !== newPw2 ? 'The new passwords do not match.' : '');
    setError(problem);
    if (problem) return;
    try {
      await changePassword(me.account_id, oldPw, newPw);
      setOldPw(''); setNewPw(''); setNewPw2('');
      setStatus('Password changed.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="panel-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="s-old">Current password</label>
        <PasswordInput id="s-old" autoComplete="current-password" value={oldPw} onChange={setOldPw} />
      </div>
      <div className="field">
        <label htmlFor="s-new">New password</label>
        <PasswordInput id="s-new" autoComplete="new-password" value={newPw} onChange={setNewPw} describedBy="s-new-hint" />
        <p className="hint" id="s-new-hint">At least 8 characters with a letter and a digit.</p>
      </div>
      <div className="field">
        <label htmlFor="s-new2">Repeat new password</label>
        <PasswordInput id="s-new2" autoComplete="new-password" value={newPw2} onChange={setNewPw2} />
      </div>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">Change password</button>
    </form>
  );
}

export default function AccountPage({ headingRef, me, onGo }) {
  const [tab, setTab] = useState('bookings');

  return (
    <>
      <div className="page-head account-head">
        <div className="avatar" aria-hidden="true">{me.first_name[0]}{me.last_name[0]}</div>
        <div>
          <h1 id="account-title" tabIndex={-1} ref={headingRef}>{me.first_name} {me.last_name}</h1>
          <p className="muted">{me.email} · <span className={'role-chip role-' + me.role}>{ROLE_LABEL[me.role]}</span></p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Account sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={'tab-' + t.id}
            aria-selected={tab === t.id}
            aria-controls={'panel-' + t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab} className="tab-panel">
        {tab === 'bookings' && <Bookings me={me} onGo={onGo} />}
        {tab === 'profile' && <Profile me={me} />}
        {tab === 'security' && <Security me={me} />}
      </div>
    </>
  );
}
