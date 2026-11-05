import {
  getDb, blockedRoomIds, typeOf, bookingDetails, fmtDate, ref, plural,
  toggleRoomMaintenance, TABLES
} from '../db.js';

function StatusBadge({ status }) {
  const cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' ? 'good'
    : status === 'Cancelled' || status === 'Failed' ? 'bad'
    : status === 'Refunded' ? 'warn' : '';
  const label = status === 'CheckedIn' ? 'Checked in' : status;
  return <span className={'badge ' + cls}>{label}</span>;
}

export default function StaffPage({ headingRef, staffDates, setStaffDates }) {
  const db = getDb();
  const s = staffDates;
  const datesOk = s.ci && s.co && s.co > s.ci;
  const blocked = datesOk ? blockedRoomIds(db, s.ci, s.co) : {};

  const rows = db.booking.slice().sort((a, b) => (a.check_in < b.check_in ? -1 : 1));

  return (
    <>
      <div className="page-head">
        <h1 id="staff-title" tabIndex={-1} ref={headingRef}>Staff view</h1>
        <p className="lead">What the front desk sees: every room for a date range, all bookings, and the raw database tables behind them. No login in this prototype.</p>
      </div>

      <form className="inline-form" noValidate>
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

      <h2>Rooms</h2>
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
            const g = db.guest.filter((x) => x.guest_id === b.guest_id)[0];
            line = `Booked by ${g.first_name} ${g.last_name} (${ref(b.booking_id)})`;
          } else {
            line = 'Free for these dates';
          }
          return (
            <div className={cls} key={r.room_id}>
              <strong>Room {r.room_number}</strong>
              <span>{t.type_name}, floor {r.floor}</span>
              <small>{line}</small>
              <button type="button" className="link-btn" onClick={() => toggleRoomMaintenance(r.room_id)}>
                {r.status === 'Available' ? 'Close for maintenance' : 'Reopen room'}
              </button>
            </div>
          );
        })}
      </div>

      <h2>Bookings</h2>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Ref</th><th>Guest</th><th>Rooms</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Payment</th></tr></thead>
          <tbody>
            {rows.map((b) => {
              const g = db.guest.filter((x) => x.guest_id === b.guest_id)[0];
              const d = bookingDetails(b);
              return (
                <tr key={b.booking_id}>
                  <td>{ref(b.booking_id)}</td>
                  <td>{g.first_name} {g.last_name}</td>
                  <td>{d.rooms.join(', ')}</td>
                  <td>{fmtDate(b.check_in)}</td>
                  <td>{fmtDate(b.check_out)}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{d.pay ? <StatusBadge status={d.pay.payment_status} /> : 'None'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Database tables</h2>
      <p className="lead">The six tables from the database plan. Open one to see its rows.</p>
      <div id="staff-db">
        {TABLES.map((name) => {
          const data = db[name];
          const cols = data.length ? Object.keys(data[0]) : [];
          return (
            <details key={name}>
              <summary>{name} ({plural(data.length, 'row', 'rows')})</summary>
              <div className="tbl-wrap">
                <table>
                  <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.map((row, idx) => (
                      <tr key={idx}>{cols.map((c) => <td key={c}>{String(row[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
