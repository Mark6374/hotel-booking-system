import { useMemo, useState } from 'react';
import { addDays, todayISO, blockedRoomIds, fmtDate, plural } from '../db.js';

/* Occupancy calendar: for every night of a month, how many rooms are free.
   A night D is taken by an active booking when check_in <= D < check_out
   (the same rule as the booking page). Rooms closed for maintenance count as not free.
   First click = check-in, second click = check-out; then the search runs. */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthStart(iso) { return iso.slice(0, 8) + '01'; }

function shiftMonth(first, delta) {
  const d = new Date(first + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

function monthLabel(first) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(first + 'T00:00:00Z'));
}

function longDay(iso) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(iso + 'T00:00:00Z'));
}

/* Monday-first grid of the month: leading blanks (null) + ISO days. */
function monthDays(first) {
  const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const days = [];
  for (let i = 0; i < lead; i++) days.push(null);
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d);
  return days;
}

function level(free, total) {
  if (!total || free === 0) return 'full';
  const share = free / total;
  if (share <= 0.34) return 'low';
  if (share <= 0.67) return 'mid';
  return 'high';
}

export default function AvailabilityCalendar({ db, search, onPick }) {
  const today = todayISO();
  const firstAllowed = monthStart(today);
  const lastAllowed = shiftMonth(firstAllowed, 11); // one year ahead
  const [month, setMonth] = useState(() => {
    const m = monthStart(search.ci && search.ci >= today ? search.ci : today);
    return m > lastAllowed ? lastAllowed : m;
  });
  const [typeId, setTypeId] = useState(0); // 0 = all room types
  const [start, setStart] = useState('');  // check-in picked, waiting for check-out

  const rooms = db.room.filter((r) => !typeId || r.room_type_id === typeId);
  const total = rooms.length;

  const days = useMemo(() => monthDays(month).map((iso) => {
    if (!iso) return null;
    const blocked = blockedRoomIds(db, iso, addDays(iso, 1));
    const free = rooms.filter((r) => r.status === 'Available' && !blocked[r.room_id]).length;
    return { iso, free };
  }), [db, month, typeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(iso) {
    if (!start || iso <= start) { setStart(iso); return; }
    onPick(start, iso);
    setStart('');
  }

  const inSearch = (iso) => !start && search.ci && search.co && iso >= search.ci && iso < search.co;
  const typeName = typeId ? db.room_type.find((t) => t.room_type_id === typeId)?.type_name : 'all';

  return (
    <section className="cal" aria-labelledby="cal-title">
      <div className="cal-head">
        <div>
          <h2 id="cal-title">Availability calendar</h2>
          <p className="muted">
            {start
              ? <>Check-in <strong>{fmtDate(start)}</strong>. Now pick your check-out day.</>
              : 'How many rooms are free each night. Pick a check-in day, then a check-out day.'}
          </p>
        </div>
        <div className="chips" role="group" aria-label="Room type">
          <button type="button" className="chip" aria-pressed={typeId === 0} onClick={() => setTypeId(0)}>All rooms</button>
          {db.room_type.map((t) => (
            <button key={t.room_type_id} type="button" className="chip" aria-pressed={typeId === t.room_type_id}
              onClick={() => setTypeId(t.room_type_id)}>{t.type_name}</button>
          ))}
        </div>
      </div>

      <div className="cal-nav">
        <button type="button" className="btn btn-sm btn-ghost" disabled={month <= firstAllowed}
          onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">&larr;</button>
        <strong aria-live="polite">{monthLabel(month)}</strong>
        <button type="button" className="btn btn-sm btn-ghost" disabled={month >= lastAllowed}
          onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">&rarr;</button>
      </div>

      <div className="cal-grid" role="group" aria-label={`Free ${typeName === 'all' ? '' : typeName + ' '}rooms in ${monthLabel(month)}`}>
        {WEEKDAYS.map((w) => <div key={w} className="cal-wd" aria-hidden="true">{w}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={'b' + i} className="cal-blank" aria-hidden="true"></div>;
          const past = d.iso < today;
          const cls = ['cal-day', past ? 'past' : 'lvl-' + level(d.free, total)];
          if (d.iso === today) cls.push('today');
          if (d.iso === start) cls.push('start');
          if (inSearch(d.iso)) cls.push('in-range');
          const label = `${longDay(d.iso)}: ${past ? 'past' : `${d.free} of ${plural(total, 'room', 'rooms')} free`}`;
          return (
            <button key={d.iso} type="button" className={cls.join(' ')} disabled={past}
              aria-label={label} aria-pressed={d.iso === start || inSearch(d.iso)} onClick={() => pick(d.iso)}>
              <span className="cal-num">{Number(d.iso.slice(8))}</span>
              {!past && <span className="cal-free">{d.free}<span className="cal-free-word"> free</span></span>}
            </button>
          );
        })}
      </div>

      <ul className="cal-legend" aria-label="Legend">
        <li><span className="cal-swatch lvl-high"></span>Plenty free</li>
        <li><span className="cal-swatch lvl-mid"></span>Some free</li>
        <li><span className="cal-swatch lvl-low"></span>Almost full</li>
        <li><span className="cal-swatch lvl-full"></span>Full</li>
        <li><span className="cal-swatch in-range"></span>Your dates</li>
      </ul>
      {start && <button type="button" className="link-btn" onClick={() => setStart('')}>Cancel date choice</button>}
    </section>
  );
}
