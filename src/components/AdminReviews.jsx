import { useEffect, useState } from 'react';
import { getDb, typeName } from '../db.js';
import { t } from '../i18n/index.js';
import { allReviews, moderateReview } from '../reviews.js';
import { toast } from '../toast.js';
import StatusBadge from './StatusBadge.jsx';
import { ReviewItem } from './RoomDetailsModal.jsx';

const FILTERS = [
  { id: 'Pending', label: 'mod.f.pending' },
  { id: 'Published', label: 'mod.f.published' },
  { id: 'Hidden', label: 'mod.f.hidden' },
  { id: 'all', label: 'staff.f.all' }
];

/* Admin moderation: a guest's review appears on the website only after it is approved here.
   onCount(n) reports how many are waiting (for the badge in the side menu). */
export default function AdminReviews({ onCount }) {
  const [filter, setFilter] = useState('Pending');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  function load() {
    setError('');
    allReviews('all')
      .then((rows) => { setList(rows); if (onCount) onCount(rows.filter((r) => r.status === 'Pending').length); })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(r, status, msg, kind) {
    setBusy(r.review_id);
    try {
      await moderateReview(r.review_id, status);
      toast(msg, kind);
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(0);
    }
  }

  if (error) return <p className="tx-box tx-fail" role="alert">{error}</p>;
  if (!list) return <p className="muted">{t('rev.loading')}</p>;

  const db = getDb();
  const typeOfRoom = (roomId) => {
    const room = db.room.find((x) => x.room_id === roomId);
    const rt = room && db.room_type.find((x) => x.room_type_id === room.room_type_id);
    return typeName(rt);
  };
  const count = (id) => (id === 'all' ? list.length : list.filter((r) => r.status === id).length);
  const rows = list.filter((r) => filter === 'all' || r.status === filter);   // newest first

  return (
    <>
      <p className="lead">{t('mod.lead')}</p>
      <div className="chips" role="group" aria-label={t('mod.filter')}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {t(f.label)} ({count(f.id)})
          </button>
        ))}
      </div>

      {!rows.length ? (
        <p className="empty">{t(filter === 'Pending' ? 'mod.nothing' : 'mod.empty')}</p>
      ) : (
        <div className="review-list">
          {rows.map((r) => (
            <ReviewItem key={r.review_id} r={r}>
              <div className="row-actions">
                <StatusBadge status={r.status} />
                <span className="muted">{typeOfRoom(r.room_id)}</span>
                {r.status === 'Pending' && (
                  <>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.review_id}
                      onClick={() => setStatus(r, 'Published', t('mod.approved', { room: r.room_number }))}>{t('mod.approve')}</button>
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy === r.review_id}
                      onClick={() => setStatus(r, 'Hidden', t('mod.rejected', { room: r.room_number }), 'info')}>{t('mod.reject')}</button>
                  </>
                )}
                {r.status === 'Published' && (
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy === r.review_id}
                    onClick={() => setStatus(r, 'Hidden', t('mod.hidden', { room: r.room_number }), 'info')}>{t('mod.hide')}</button>
                )}
                {r.status === 'Hidden' && (
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy === r.review_id}
                    onClick={() => setStatus(r, 'Published', t('mod.published', { room: r.room_number }))}>{t('mod.publish')}</button>
                )}
              </div>
            </ReviewItem>
          ))}
        </div>
      )}
    </>
  );
}
