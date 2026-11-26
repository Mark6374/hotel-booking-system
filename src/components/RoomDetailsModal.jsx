import { useEffect, useRef, useState } from 'react';
import { getDb, money, fmtDate, typeName, typeDesc } from '../db.js';
import { t, tn } from '../i18n/index.js';
import { monthYear as monthYearOf } from '../i18n/dates.js';
import { typeReviews } from '../reviews.js';
import RoomPhoto from './RoomPhoto.jsx';
import { Stars } from './Stars.jsx';

const ORDERINGS = [
  { id: 'newest', label: 'rev.sort.newest' },
  { id: 'highest', label: 'rev.sort.highest' },
  { id: 'lowest', label: 'rev.sort.lowest' }
];

function monthYear(iso) {
  return monthYearOf(iso);
}

/* One review, used here and in the account / front desk pages. */
export function ReviewItem({ r, children }) {
  return (
    <article className="review">
      <div className="review-head">
        <Stars value={r.rating} />
        <span className="sr">{t('stars.label', { n: r.rating })}.</span>
        <strong>{r.author}</strong>
        <span className="muted">{t('common.roomN', { n: r.room_number })} · {t('rev.stayedIn', { month: monthYear(r.stay_check_in) })}</span>
      </div>
      {r.comment ? <p className="review-text">{r.comment}</p> : <p className="review-text muted">{t('rev.noComment')}</p>}
      <p className="review-date muted">
        {fmtDate(r.created_at.slice(0, 10))}{r.edited ? ' · ' + t('rev.edited') : ''}
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

  if (error) return <p className="tx-box tx-fail">{t('rev.loadFail')} {error}</p>;
  if (!data) return <p className="muted">{t('rev.loading')}</p>;

  const s = data.summary;
  return (
    <section className="reviews" aria-labelledby="reviews-title">
      <h3 id="reviews-title">{t('about.reviews')}</h3>
      {!s.count ? (
        <p className="muted">{t('rev.noneForRoom')}</p>
      ) : (
        <>
          <div className="review-summary">
            <div className="review-score">
              <strong>{s.average.toFixed(1)}</strong>
              <Stars value={s.average} size="lg" />
              <span className="muted">{tn('n.reviews', s.count)}</span>
            </div>
            <ul className="review-bars" aria-label={t('rev.byStars')}>
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

          <div className="chips" role="group" aria-label={t('rev.sort')}>
            {ORDERINGS.map((o) => (
              <button key={o.id} type="button" className="chip" aria-pressed={ordering === o.id} onClick={() => setOrdering(o.id)}>{t(o.label)}</button>
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
  const rt = db.room_type.filter((x) => x.room_type_id === typeId)[0];
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!rt) return null;

  const roomCount = db.room.filter((r) => r.room_type_id === typeId).length;

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{typeName(rt)}</h2>
          <button type="button" className="modal-close" ref={closeRef} onClick={onClose} aria-label={t('common.close')}>&times;</button>
        </div>

        <div className="modal-gallery">
          <RoomPhoto kind="bed" typeId={rt.room_type_id} label={t('room.photoBed')} />
          <RoomPhoto kind="bath" typeId={rt.room_type_id} label={t('room.photoBath')} />
          <RoomPhoto kind="view" typeId={rt.room_type_id} label={t('room.photoView')} />
        </div>

        <p>{typeDesc(rt)}</p>

        <div className="modal-facts">
          <span>{t('room.sleepsLabel')} <strong>{rt.capacity}</strong></span>
          <span>{t('room.price')} <strong>{money(rt.price_per_night)}</strong> {t('price.perNightShort')}</span>
          <span>{t('room.ofType')} <strong>{roomCount}</strong></span>
        </div>

        <Reviews typeId={rt.room_type_id} />

        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}
