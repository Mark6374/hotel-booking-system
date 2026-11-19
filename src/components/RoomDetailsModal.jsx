import { useEffect, useRef, useState } from 'react';
import { getDb, money, fmtDate } from '../db.js';
import { typeReviews } from '../reviews.js';
import RoomPhoto from './RoomPhoto.jsx';
import { Stars } from './Stars.jsx';

const ORDERINGS = [
  { id: 'newest', label: 'Newest' },
  { id: 'highest', label: 'Highest rated' },
  { id: 'lowest', label: 'Lowest rated' }
];

function monthYear(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/* One review, used here and in the account / front desk pages. */
export function ReviewItem({ r, children }) {
  return (
    <article className="review">
      <div className="review-head">
        <Stars value={r.rating} />
        <span className="sr">{r.rating} out of 5.</span>
        <strong>{r.author}</strong>
        <span className="muted">Room {r.room_number} · stayed {monthYear(r.stay_check_in)}</span>
      </div>
      {r.comment ? <p className="review-text">{r.comment}</p> : <p className="review-text muted">No comment, just a rating.</p>}
      <p className="review-date muted">
        {fmtDate(r.created_at.slice(0, 10))}{r.edited ? ' · edited' : ''}
      </p>
      {children}
    </article>
  );
}

function Reviews({ typeId }) {
  const [ordering, setOrdering] = useState('newest');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    typeReviews(typeId, { ordering })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [typeId, ordering]);

  if (error) return <p className="tx-box tx-fail">Could not load reviews: {error}</p>;
  if (!data) return <p className="muted">Loading reviews…</p>;

  const s = data.summary;
  return (
    <section className="reviews" aria-labelledby="reviews-title">
      <h3 id="reviews-title">Guest reviews</h3>
      {!s.count ? (
        <p className="muted">No reviews yet. Guests can rate a room after their stay.</p>
      ) : (
        <>
          <div className="review-summary">
            <div className="review-score">
              <strong>{s.average.toFixed(1)}</strong>
              <Stars value={s.average} size="lg" />
              <span className="muted">{s.count} {s.count === 1 ? 'review' : 'reviews'}</span>
            </div>
            <ul className="review-bars" aria-label="Ratings by stars">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = s.distribution[star] || 0;
                return (
                  <li key={star}>
                    <span>{star} ★</span>
                    <span className="bar-track"><span className="bar-fill bar-star" style={{ width: (n / s.count * 100) + '%' }}></span></span>
                    <span className="muted">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="chips" role="group" aria-label="Sort reviews">
            {ORDERINGS.map((o) => (
              <button key={o.id} type="button" className="chip" aria-pressed={ordering === o.id} onClick={() => setOrdering(o.id)}>{o.label}</button>
            ))}
          </div>

          <div className="review-list">
            {data.reviews.map((r) => <ReviewItem key={r.review_id} r={r} />)}
          </div>
        </>
      )}
    </section>
  );
}

export default function RoomDetailsModal({ typeId, onClose }) {
  const db = getDb();
  const t = db.room_type.filter((x) => x.room_type_id === typeId)[0];
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!t) return null;

  const roomCount = db.room.filter((r) => r.room_type_id === typeId).length;

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{t.type_name}</h2>
          <button type="button" className="modal-close" ref={closeRef} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="modal-gallery">
          <RoomPhoto kind="bed" typeId={t.room_type_id} label="Bed and window" />
          <RoomPhoto kind="bath" typeId={t.room_type_id} label="Bathroom" />
          <RoomPhoto kind="view" typeId={t.room_type_id} label="Room view" />
        </div>

        <p>{t.description}</p>

        <div className="modal-facts">
          <span>Sleeps <strong>{t.capacity}</strong></span>
          <span>Price <strong>{money(t.price_per_night)}</strong> / night</span>
          <span>Rooms of this type <strong>{roomCount}</strong></span>
        </div>

        <Reviews typeId={t.room_type_id} />

        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
