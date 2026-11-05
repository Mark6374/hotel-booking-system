import { useMemo, useState } from 'react';
import {
  getDb, validateSearch, nights, fmtDate, money, plural,
  getSelection, roomsOfType, freeRooms, blockedRoomIds
} from '../db.js';

function SummaryDates({ s, n }) {
  return (
    <dl>
      <div><dt>Check-in</dt><dd>{fmtDate(s.ci)}</dd></div>
      <div><dt>Check-out</dt><dd>{fmtDate(s.co)}</dd></div>
      <div><dt>Nights</dt><dd>{n}</dd></div>
      <div><dt>Guests</dt><dd>{s.guests}</dd></div>
    </dl>
  );
}

function SummaryLines({ sel }) {
  return sel.lines.map((l) => (
    <div className="sum-line" key={l.type.room_type_id}>
      <div>
        {l.rooms.length} &times; {l.type.type_name}
        <small>{plural(sel.n, 'night', 'nights')} at {money(l.type.price_per_night)}</small>
      </div>
      <strong>{money(l.subtotal)}</strong>
    </div>
  ));
}

export default function BookPage({ headingRef, search, setSearch, sel, setSel, onContinue, onDetails }) {
  const db = getDb();
  const [ci, setCi] = useState(search.ci);
  const [co, setCo] = useState(search.co);
  const [guests, setGuests] = useState(search.guests);
  const [searchError, setSearchError] = useState('');

  const searchErr = validateSearch(search);
  const n = searchErr ? 0 : nights(search.ci, search.co);
  const blocked = searchErr ? {} : blockedRoomIds(db, search.ci, search.co);
  const selection = useMemo(() => (searchErr ? null : getSelection(db, search, sel)), [db, search, sel, searchErr]);

  function submitSearch(e) {
    e.preventDefault();
    const s = { ci, co, guests: parseInt(guests, 10) };
    const err = validateSearch(s);
    setSearchError(err);
    if (err) return;
    setSearch(s);
    setSel({});
  }

  function step(typeId, delta, maxFree) {
    setSel((prev) => {
      const next = Math.max(0, Math.min(maxFree, (prev[typeId] || 0) + delta));
      return { ...prev, [typeId]: next };
    });
  }

  const enough = selection && selection.cap >= search.guests;

  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <h1 id="book-title" tabIndex={-1} ref={headingRef}>Pick your dates. See exactly what's left.</h1>
          <p>Availability is read from the same booking tables the front desk uses, so the number of rooms you see is the number we can actually give you.</p>
        </div>

        <form className="search" noValidate onSubmit={submitSearch}>
          <h2>Find a room</h2>
          <div className="field">
            <label htmlFor="ci">Check-in</label>
            <input type="date" id="ci" min={new Date().toISOString().slice(0, 10)} value={ci} onChange={(e) => setCi(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="co">Check-out</label>
            <input type="date" id="co" min={new Date().toISOString().slice(0, 10)} value={co} onChange={(e) => setCo(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="guests">Guests</label>
            <input type="number" id="guests" min={1} max={10} value={guests} onChange={(e) => setGuests(e.target.value)} required />
          </div>
          <p className="form-error" role="alert">{searchError}</p>
          <button type="submit" className="btn btn-light">Show available rooms</button>
        </form>
      </div>

      <div className="results-wrap">
        <div className="results-main">
          <h2 id="results-title">
            {searchErr ? 'Choose valid dates to see rooms' : `Rooms for ${fmtDate(search.ci)} to ${fmtDate(search.co)} (${plural(n, 'night', 'nights')})`}
          </h2>
          <ul className="legend" aria-label="Legend">
            <li><span className="seg free" aria-hidden="true"></span>Free</li>
            <li><span className="seg taken" aria-hidden="true"></span>Booked</li>
            <li><span className="seg off" aria-hidden="true"></span>Closed for maintenance</li>
          </ul>

          <div id="results">
            {searchErr ? (
              <p className="empty">{searchErr}</p>
            ) : (
              db.room_type.map((t) => {
                const all = roomsOfType(db, t.room_type_id);
                const free = freeRooms(db, t.room_type_id, search.ci, search.co);
                const qty = Math.min(sel[t.room_type_id] || 0, free.length);
                return (
                  <article className="rt" key={t.room_type_id}>
                    <div className="rt-info">
                      <h3>{t.type_name}</h3>
                      <p className="desc">{t.description}</p>
                      <p className="price">
                        Sleeps {t.capacity}. {money(t.price_per_night)} per night, {money(t.price_per_night * n)} for {plural(n, 'night', 'nights')}.
                      </p>
                      <button type="button" className="link-btn" onClick={() => onDetails(t.room_type_id)}>See photos and details</button>
                    </div>
                    <div className="rt-avail">
                      <div className="segs" role="img" aria-label={`${free.length} of ${all.length} ${t.type_name} rooms free`}>
                        {all.map((r) => {
                          const cls = r.status !== 'Available' ? 'off' : blocked[r.room_id] ? 'taken' : 'free';
                          return <span className={'seg ' + cls} key={r.room_id}></span>;
                        })}
                      </div>
                      {free.length === 0
                        ? <p className="left sold">Sold out for these dates</p>
                        : <p className="left">{free.length} of {all.length} left</p>}
                    </div>
                    <div className="stepper" role="group" aria-label={`Number of ${t.type_name} rooms`}>
                      <button
                        type="button"
                        className="step"
                        aria-label={`Remove one ${t.type_name} room`}
                        disabled={qty === 0}
                        onClick={() => step(t.room_type_id, -1, free.length)}
                      >&minus;</button>
                      <output aria-live="polite">{qty}</output>
                      <button
                        type="button"
                        className="step"
                        aria-label={`Add one ${t.type_name} room`}
                        disabled={qty >= free.length}
                        onClick={() => step(t.room_type_id, 1, free.length)}
                      >+</button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        <aside className="summary" aria-labelledby="summary-title">
          <h2 id="summary-title">Your stay</h2>
          <div id="summary-body">
            {searchErr ? (
              <p className="muted">Choose valid dates to start.</p>
            ) : !selection.lines.length ? (
              <>
                <SummaryDates s={search} n={n} />
                <p className="muted">No rooms yet. Press + on a room type to add one.</p>
              </>
            ) : (
              <>
                <SummaryDates s={search} n={n} />
                <hr />
                <SummaryLines sel={selection} />
                <hr />
                <div className="sum-line"><span>Total</span><span className="sum-total">{money(selection.total)}</span></div>
                {!enough && (
                  <p className="note">These rooms sleep {selection.cap}, but you are booking for {search.guests}. Add another room or lower the number of guests.</p>
                )}
              </>
            )}
          </div>
          <button type="button" className="btn btn-primary" disabled={!selection || !selection.lines.length || !enough} onClick={onContinue}>
            Continue to guest details
          </button>
        </aside>
      </div>
    </>
  );
}
