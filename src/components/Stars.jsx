import { useSyncExternalStore } from 'react';
import { subscribeReviews, getReviewSummary, typeRating } from '../reviews.js';

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
    ? `${r.average.toFixed(1)} out of 5, ${r.count} ${r.count === 1 ? 'review' : 'reviews'}`
    : 'No reviews yet';
  const inner = r.count ? (
    <>
      <Stars value={r.average} />
      <strong>{r.average.toFixed(1)}</strong>
      <span className="muted">({r.count} {r.count === 1 ? 'review' : 'reviews'})</span>
    </>
  ) : <span className="muted">No reviews yet</span>;
  if (onClick) {
    return <button type="button" className="rating rating-btn" aria-label={label + '. Read reviews'} onClick={onClick}>{inner}</button>;
  }
  return <span className="rating" aria-label={label} role="img">{inner}</span>;
}

/* 1-5 star picker (radio group, works with keyboard arrows). */
export function StarInput({ value, onChange, idPrefix, invalid }) {
  const words = ['', 'Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];
  return (
    <fieldset className="star-input" aria-invalid={invalid ? 'true' : undefined}>
      <legend className="sr">Rating</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={n <= value ? 'on' : ''} title={words[n]}>
          <input type="radio" name={idPrefix + '-rating'} value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden="true">★</span>
          <span className="sr">{n} {n === 1 ? 'star' : 'stars'} ({words[n]})</span>
        </label>
      ))}
      <span className="star-word" aria-hidden="true">{value ? words[value] : 'Pick a rating'}</span>
    </fieldset>
  );
}
