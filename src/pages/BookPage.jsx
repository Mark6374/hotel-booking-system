import { useMemo, useState } from 'react';
import {
  getDb, validateSearch, nights, fmtDate, money, typeName, typeDesc,
  getSelection, roomsOfType, freeRooms, blockedRoomIds
} from '../db.js';
import { t, tn } from '../i18n/index.js';
import RoomPhoto from '../components/RoomPhoto.jsx';
import { TypeRating } from '../components/Stars.jsx';
import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx';

function SummaryDates({ s, n }) {
  return (
    <dl>
      <div><dt>{t('search.checkIn')}</dt><dd>{fmtDate(s.ci)}</dd></div>
      <div><dt>{t('search.checkOut')}</dt><dd>{fmtDate(s.co)}</dd></div>
      <div><dt>{t('sum.nights')}</dt><dd>{n}</dd></div>
      <div><dt>{t('search.guests')}</dt><dd>{s.guests}</dd></div>
    </dl>
  );
}

function SummaryLines({ sel }) {
  return sel.lines.map((l) => (
    <div className="sum-line" key={l.type.room_type_id}>
      <div>
        {l.rooms.length} &times; {typeName(l.type)}
        <small>{t('sum.nightsAt', { nights: tn('n.nights', sel.n), price: money(l.type.price_per_night) })}</small>
      </div>
      <strong>{money(l.subtotal)}</strong>
    </div>
  ));
}

export default function BookPage({ headingRef, loggedIn, search, setSearch, sel, setSel, onContinue, onDetails }) {
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
          <h1 id="book-title" tabIndex={-1} ref={headingRef}>{t('book.title')}</h1>
          <p>{t('book.lead')}</p>
        </div>

        <form className="search" noValidate onSubmit={submitSearch}>
          <h2>{t('search.findRoom')}</h2>
          <div className="field">
            <label htmlFor="ci">{t('search.checkIn')}</label>
            <input type="date" id="ci" min={new Date().toISOString().slice(0, 10)} value={ci} onChange={(e) => setCi(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="co">{t('search.checkOut')}</label>
            <input type="date" id="co" min={new Date().toISOString().slice(0, 10)} value={co} onChange={(e) => setCo(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="guests">{t('search.guests')}</label>
            <input type="number" id="guests" min={1} max={10} value={guests} onChange={(e) => setGuests(e.target.value)} required />
          </div>
          <p className="form-error" role="alert">{searchError}</p>
          <button type="submit" className="btn btn-light">{t('book.showRooms')}</button>
        </form>
      </div>

      <AvailabilityCalendar db={db} search={search} onPick={(from, to) => {
        const s = { ci: from, co: to, guests: parseInt(guests, 10) || search.guests };
        setCi(from);
        setCo(to);
        setSearchError('');
        setSearch(s);
        setSel({});
        document.getElementById('results-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }} />

      <div className="results-wrap">
        <div className="results-main">
          <h2 id="results-title">
            {searchErr ? t('book.chooseDates') : t('book.resultsTitle', { from: fmtDate(search.ci), to: fmtDate(search.co), nights: tn('n.nights', n) })}
          </h2>
          <ul className="legend" aria-label={t('common.legend')}>
            <li><span className="seg free" aria-hidden="true"></span>{t('book.free')}</li>
            <li><span className="seg taken" aria-hidden="true"></span>{t('book.booked')}</li>
            <li><span className="seg off" aria-hidden="true"></span>{t('book.closed')}</li>
          </ul>

          <div id="results">
            {searchErr ? (
              <p className="empty">{searchErr}</p>
            ) : (
              db.room_type.map((rt) => {
                const all = roomsOfType(db, rt.room_type_id);
                const free = freeRooms(db, rt.room_type_id, search.ci, search.co);
                const qty = Math.min(sel[rt.room_type_id] || 0, free.length);
                return (
                  <article className="rt" key={rt.room_type_id}>
                    <div className="rt-info">
                      <div className="rt-thumb">
                        <RoomPhoto kind="bed" typeId={rt.room_type_id} label={t('room.photoOf', { type: typeName(rt) })} />
                      </div>
                      <div className="rt-info-text">
                        <h3>{typeName(rt)}</h3>
                        <TypeRating typeId={rt.room_type_id} onClick={() => onDetails(rt.room_type_id)} />
                        <p className="desc">{typeDesc(rt)}</p>
                        <p className="price">
                          {t('book.priceLine', { n: rt.capacity, price: money(rt.price_per_night), total: money(rt.price_per_night * n), nights: tn('n.nights', n) })}
                        </p>
                        <button type="button" className="link-btn" onClick={() => onDetails(rt.room_type_id)}>{t('room.detailsLinkLong')}</button>
                      </div>
                    </div>
                    <div className="rt-avail">
                      <div className="segs" role="img" aria-label={t('book.segsLabel', { free: free.length, all: all.length, type: typeName(rt) })}>
                        {all.map((r) => {
                          const cls = r.status !== 'Available' ? 'off' : blocked[r.room_id] ? 'taken' : 'free';
                          return <span className={'seg ' + cls} key={r.room_id}></span>;
                        })}
                      </div>
                      {free.length === 0
                        ? <p className="left sold">{t('book.soldOut')}</p>
                        : <p className="left">{t('book.left', { free: free.length, all: all.length })}</p>}
                    </div>
                    <div className="stepper" role="group" aria-label={t('book.numberOf', { type: typeName(rt) })}>
                      <button
                        type="button"
                        className="step"
                        aria-label={t('book.removeOne', { type: typeName(rt) })}
                        disabled={qty === 0}
                        onClick={() => step(rt.room_type_id, -1, free.length)}
                      >&minus;</button>
                      <output aria-live="polite">{qty}</output>
                      <button
                        type="button"
                        className="step"
                        aria-label={t('book.addOne', { type: typeName(rt) })}
                        disabled={qty >= free.length}
                        onClick={() => step(rt.room_type_id, 1, free.length)}
                      >+</button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        <aside className="summary" aria-labelledby="summary-title">
          <h2 id="summary-title">{t('sum.title')}</h2>
          <div id="summary-body">
            {searchErr ? (
              <p className="muted">{t('sum.chooseDates')}</p>
            ) : !selection.lines.length ? (
              <>
                <SummaryDates s={search} n={n} />
                <p className="muted">{t('sum.noRooms')}</p>
              </>
            ) : (
              <>
                <SummaryDates s={search} n={n} />
                <hr />
                <SummaryLines sel={selection} />
                <hr />
                <div className="sum-line"><span>{t('sum.total')}</span><span className="sum-total">{money(selection.total)}</span></div>
                {!enough && (
                  <p className="note">{t('sum.notEnough', { cap: selection.cap, guests: search.guests })}</p>
                )}
              </>
            )}
          </div>
          <button type="button" className="btn btn-primary" disabled={!selection || !selection.lines.length || !enough} onClick={onContinue}>
            {t(loggedIn ? 'sum.continue' : 'sum.loginToContinue')}
          </button>
          {!loggedIn && <p className="hint">{t('sum.needAccount')}</p>}
        </aside>
      </div>
    </>
  );
}
