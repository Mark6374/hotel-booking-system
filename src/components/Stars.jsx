import { useSyncExternalStore } from 'react';
import { subscribeReviews, getReviewSummary, typeRating } from '../reviews.js';
import { t, tn } from '../i18n/index.js';

/* Read-only stars. value can be a fraction (4.5). */
export function Stars({ value, size }) {
  const pct = Math.max(0, Math.min(5, value || 0)) / 5 * 100;
  return (
    <span className={'stars' + (size === 'lg' ? ' stars-lg' : '')} aria-hidden="true">
      <span className="stars-bg">★★★★★</span>
      <span className="stars-fg" style={{ width: pct + '%' }}>★★★★★</span>
    </span>
  );
}

/* "★★★★☆ 4.5 (12 reviews)" for a room type, from the summary store. */
export function TypeRating({ typeId, onClick }) {
  useSyncExternalStore(subscribeReviews, getReviewSummary);
  const r = typeRating(typeId);
  const label = r.count
    ? t('stars.summary', { avg: r.average.toFixed(1), reviews: tn('n.reviews', r.count) })
    : t('stars.none');
  const inner = r.count ? (
    <>
      <Stars value={r.average} />
      <strong>{r.average.toFixed(1)}</strong>
      <span className="muted">({tn('n.reviews', r.count)})</span>
    </>
  ) : <span className="muted">{t('stars.none')}</span>;
  if (onClick) {
    return <button type="button" className="rating rating-btn" aria-label={label + '. ' + t('stars.read')} onClick={onClick}>{inner}</button>;
  }
  return <span className="rating" aria-label={label} role="img">{inner}</span>;
}

/* 1-5 star picker (radio group, works with keyboard arrows). */
export function StarInput({ value, onChange, idPrefix, invalid }) {
  const words = ['', t('stars.w1'), t('stars.w2'), t('stars.w3'), t('stars.w4'), t('stars.w5')];
  return (
    <fieldset className="star-input" aria-invalid={invalid ? 'true' : undefined}>
      <legend className="sr">{t('stars.rating')}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={n <= value ? 'on' : ''} title={words[n]}>
          <input type="radio" name={idPrefix + '-rating'} value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden="true">★</span>
          <span className="sr">{tn('n.stars', n)} ({words[n]})</span>
        </label>
      ))}
      <span className="star-word" aria-hidden="true">{value ? words[value] : t('stars.pick')}</span>
    </fieldset>
  );
}
