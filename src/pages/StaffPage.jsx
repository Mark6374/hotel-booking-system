import { useState } from 'react';
import {
  getDb, blockedRoomIds, typeOf, bookingDetails, fmtDate, ref, todayISO, addDays,
  toggleRoomMaintenance, checkInBooking, checkOutBooking, cancelBooking
} from '../db.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { toast } from '../toast.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'arrivals', label: 'Arriving today' },
  { id: 'inhouse', label: 'In house' },
  { id: 'departures', label: 'Leaving today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'closed', label: 'Completed / cancelled' }
];

export default function StaffPage({ headingRef, me, staffDates, setStaffDates }) {
  const db = getDb();
  const today = todayISO();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const s = staffDates;
  const datesOk = s.ci && s.co && s.co > s.ci;
  const blocked = datesOk ? blockedRoomIds(db, s.ci, s.co) : {};

  const guestOf = (b) => db.guest.filter((x) => x.guest_id === b.guest_id)[0] || { first_name: '?', last_name: '', email: '' };

  const arrivals = db.booking.filter((b) => b.status === 'Confirmed' && b.check_in === today);
  const inhouse = db.booking.filter((b) => b.status === 'CheckedIn');
  const departures = inhouse.filter((b) => b.check_out <= today);
  const todayBlocked = blockedRoomIds(db, today, addDays(today, 1));
  const freeToday = db.room.filter((r) => r.status === 'Available' && !todayBlocked[r.room_id]).length;

  const match = {
    all: () => true,
    arrivals: (b) => b.status === 'Confirmed' && b.check_in === today,
    inhouse: (b) => b.status === 'CheckedIn',
    departures: (b) => b.status === 'CheckedIn' && b.check_out <= today,
    upcoming: (b) => b.status === 'Confirmed' && b.check_in > today,
    closed: (b) => b.status === 'Completed' || b.status === 'Cancelled'
  }[filter];

  const q = query.trim().toLowerCase();
  const rows = db.booking
    .filter(match)
    .filter((b) => {
      if (!q) return true;
      const g = guestOf(b);
      return (ref(b.booking_id) + ' ' + g.first_name + ' ' + g.last_name + ' ' + g.email).toLowerCase().indexOf(q) !== -1;
    })
    .sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : a.booking_id - b.booking_id));

  async function act(fn, id, msg) {
    try {
      const out = await fn(id);
      setStatus('');
      toast(typeof msg === 'function' ? msg(out) : msg);
    } catch (e) {
      setStatus(e.message);
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Front desk · {me.first_name} {me.last_name}</p>
        <h1 id="staff-title" tabIndex={-1} ref={headingRef}>Front desk</h1>
        <p className="lead">Today is {fmtDate(today)}. Check guests in and out, cancel bookings and close rooms for maintenance.</p>
      </div>

      <div className="stat-grid">
        <div className="stat"><span>Arriving today</span><strong>{arrivals.length}</strong></div>
        <div className="stat"><span>In house</span><strong>{inhouse.length}</strong></div>
        <div className="stat"><span>Due to leave</span><strong>{departures.length}</strong></div>
        <div className="stat"><span>Rooms free tonight</span><strong>{freeToday} / {db.room.length}</strong></div>
      </div>

      <h2 className="sub-h">Bookings</h2>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter bookings">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="field search-field">
          <label htmlFor="staff-q" className="sr">Search bookings</label>
          <input type="text" id="staff-q" placeholder="Search by ref, name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <p className="status" role="status">{status}</p>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Ref</th><th>Guest</th><th>Rooms</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Payment</th><th>Actions</th></tr></thead>
          <tbody>
            {!rows.length && (
              <tr><td colSpan={8} className="muted">No bookings match.</td></tr>
            )}
            {rows.map((b) => {
              const g = guestOf(b);
              const d = bookingDetails(b);
              const label = ref(b.booking_id);
              return (
                <tr key={b.booking_id}>
                  <td>{label}</td>
                  <td>{g.first_name} {g.last_name}<small className="cell-sub">{g.email}</small></td>
                  <td>{d.rooms.join(', ')}</td>
                  <td>{fmtDate(b.check_in)}</td>
                  <td>{fmtDate(b.check_out)}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{d.pay ? <StatusBadge status={d.pay.payment_status} /> : 'None'}</td>
                  <td className="row-actions">
                    {b.status === 'Confirmed' && b.check_in <= today && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => act(checkInBooking, b.booking_id, label + ' checked in.')}>Check in</button>
                    )}
                    {b.status === 'CheckedIn' && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => act(checkOutBooking, b.booking_id, label + ' checked out.')}>Check out</button>
                    )}
                    {b.status === 'Confirmed' && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => act(cancelBooking, b.booking_id, (refunded) => label + ' cancelled.' + (refunded ? ' Payment refunded.' : ''))}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="sub-h">Rooms</h2>
      <form className="inline-form" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="staff-ci">From</label>
          <input type="date" id="staff-ci" value={s.ci} onChange={(e) => setStaffDates({ ...s, ci: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="staff-co">To</label>
          <input type="date" id="staff-co" value={s.co} onChange={(e) => setStaffDates({ ...s, co: e.target.value })} />
        </div>
      </form>
      <p className="form-error dark" role="alert">{datesOk ? '' : 'Choose a start date and an end date after it.'}</p>

      <div className="room-grid">
        {datesOk && db.room.map((r) => {
          const t = typeOf(db, r);
          let cls = 'room';
          let line;
          if (r.status !== 'Available') {
            cls += ' off';
            line = 'Closed for maintenance';
          } else if (blocked[r.room_id]) {
            cls += ' taken';
            const b = db.booking.filter((x) => x.booking_id === blocked[r.room_id])[0];
            const g = guestOf(b);
            line = `Booked by ${g.first_name} ${g.last_name} (${ref(b.booking_id)})`;
          } else {
            line = 'Free for these dates';
          }
          return (
            <div className={cls} key={r.room_id}>
              <strong>Room {r.room_number}</strong>
              <span>{t.type_name}, floor {r.floor}</span>
              <small>{line}</small>
              <button type="button" className="link-btn" onClick={() => act(toggleRoomMaintenance, r.room_id, 'Room ' + r.room_number + (r.status === 'Available' ? ' closed for maintenance.' : ' reopened.'))}>
                {r.status === 'Available' ? 'Close for maintenance' : 'Reopen room'}
              </button>
            </div>
          );
        })}
      </div>

    </>
  );
}
