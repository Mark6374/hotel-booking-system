/* Room reviews (rating 1-5 + comment), backed by the Django API in backend/REVIEWS_API.md.
   Reviews belong to a ROOM; the site shows them per room TYPE, so lists of a type
   are merged from the rooms of that type. */

import { api } from './api.js';
import { getDb } from './db.js';

/* ---------- Store: rating summary for the room cards ---------- */

let summary = { loaded: false, rooms: {}, room_types: {} };
const listeners = new Set();

export function subscribeReviews(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getReviewSummary() { return summary; }

export async function loadReviewSummary() {
  try {
    const r = await api('/reviews/summary/');
    summary = { loaded: true, rooms: r.rooms || {}, room_types: r.room_types || {} };
  } catch (e) {
    summary = { ...summary, loaded: true }; // reviews are extra: the site works without them
  }
  listeners.forEach((fn) => fn());
}

export function typeRating(typeId) {
  return summary.room_types[String(typeId)] || { average: null, count: 0 };
}

/* ---------- Reading ---------- */

const ORDER = {
  newest: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  oldest: (a, b) => (a.created_at > b.created_at ? 1 : -1),
  highest: (a, b) => b.rating - a.rating || (a.created_at < b.created_at ? 1 : -1),
  lowest: (a, b) => a.rating - b.rating || (a.created_at < b.created_at ? 1 : -1)
};

async function roomReviews(roomId, status) {
  const q = '?page_size=50' + (status ? '&status=' + status : '');
  return api('/rooms/' + roomId + '/reviews/' + q);
}

/* All reviews of a room type: { reviews, summary: {average, count, distribution} }.
   status: undefined = published only; staff may pass 'all' or 'Hidden'. */
export async function typeReviews(typeId, { ordering = 'newest', status } = {}) {
  const rooms = getDb().room.filter((r) => r.room_type_id === typeId);
  const pages = await Promise.all(rooms.map((r) => roomReviews(r.room_id, status)));
  const reviews = pages.flatMap((p) => p.results).sort(ORDER[ordering] || ORDER.newest);
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let count = 0;
  let sum = 0;
  pages.forEach((p) => {
    Object.keys(p.summary.distribution).forEach((star) => {
      const n = p.summary.distribution[star];
      distribution[star] += n;
      count += n;
      sum += n * Number(star);
    });
  });
  return { reviews, summary: { average: count ? Math.round((sum / count) * 10) / 10 : null, count, distribution } };
}

/* Every review in the hotel (staff moderation list). */
export async function allReviews(status = 'all') {
  const rooms = getDb().room;
  const pages = await Promise.all(rooms.map((r) => roomReviews(r.room_id, status)));
  return pages.flatMap((p) => p.results).sort(ORDER.newest);
}

/* { reviews: my reviews (with status), can_review: finished stays not reviewed yet } */
export async function myReviews() {
  return api('/reviews/mine/');
}

/* ---------- Writing ---------- */

export async function createReview(roomId, { rating, comment, booking_id }) {
  const r = await api('/rooms/' + roomId + '/reviews/', { method: 'POST', body: { rating, comment, booking_id } });
  loadReviewSummary();
  return r;
}

export async function updateReview(reviewId, fields) {
  const r = await api('/reviews/' + reviewId + '/', { method: 'PATCH', body: fields });
  loadReviewSummary();
  return r;
}

export async function deleteReview(reviewId) {
  await api('/reviews/' + reviewId + '/', { method: 'DELETE' });
  loadReviewSummary();
}

export async function moderateReview(reviewId, status) {
  const r = await api('/reviews/' + reviewId + '/moderate/', { method: 'POST', body: { status } });
  loadReviewSummary();
  return r;
}

export const COMMENT_MAX = 1000;
