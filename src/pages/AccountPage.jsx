import { useEffect, useState } from 'react';
import { getDb, bookingDetails, fmtDate, money, ref, todayISO, cancelBooking, guestByEmail, typeName } from '../db.js';
import { t } from '../i18n/index.js';
import { updateProfile, changePassword, passwordProblem, PHONE_RE, uploadPhoto, removePhoto, PHOTO_TYPES, PHOTO_MAX_MB } from '../auth.js';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { StarInput } from '../components/Stars.jsx';
import { ReviewItem } from '../components/RoomDetailsModal.jsx';
import { myReviews, createReview, updateReview, deleteReview, COMMENT_MAX } from '../reviews.js';
import { toast } from '../toast.js';

const TABS = [
  { id: 'bookings', label: 'acc.tab.bookings' },
  { id: 'reviews', label: 'acc.tab.reviews' },
  { id: 'profile', label: 'acc.tab.profile' },
  { id: 'security', label: 'acc.tab.password' }
];

function Bookings({ me, onGo }) {
  const db = getDb();
  const [status, setStatus] = useState('');
  const g = guestByEmail(db, me.email);
  const list = g ? db.booking.filter((b) => b.guest_id === g.guest_id).slice().sort((a, b) => b.booking_id - a.booking_id) : [];
  const today = todayISO();
  const upcoming = list.filter((b) => (b.status === 'Confirmed' || b.status === 'CheckedIn') && b.check_out >= today);
  const past = list.filter((b) => upcoming.indexOf(b) === -1);

  async function onCancel(id) {
    try {
      const refunded = await cancelBooking(id);
      setStatus('');
      toast(t('toast.cancelled', { ref: ref(id) }) + (refunded ? ' ' + t('toast.refunded') : ''));
    } catch (e) {
      setStatus(e.message);
    }
  }

  function card(b) {
    const d = bookingDetails(b);
    const canCancel = b.status === 'Confirmed' && b.check_in >= today;
    return (
      <article className="booking-card" key={b.booking_id}>
        <div className="booking-head"><span className="ref">{ref(b.booking_id)}</span><StatusBadge status={b.status} /></div>
        <div className="booking-meta">
          <span>{t('bk.dates')} <strong>{t('bk.range', { from: fmtDate(b.check_in), to: fmtDate(b.check_out) })}</strong></span>
          <span>{t('sum.nights')} <strong>{d.n}</strong></span>
          <span>{t('bk.rooms')} <strong>{d.rooms.join(', ')}</strong></span>
          <span>{t('sum.total')} <strong>{money(d.total)}</strong></span>
          <span>{t('bk.payment')} {d.pay ? <StatusBadge status={d.pay.payment_status} /> : <strong>{t('bk.none')}</strong>}</span>
        </div>
        {canCancel && (
          <div><button type="button" className="btn btn-danger" onClick={() => onCancel(b.booking_id)}>{t('bk.cancel', { ref: ref(b.booking_id) })}</button></div>
        )}
      </article>
    );
  }

  return (
    <>
      <p className="status" role="status">{status}</p>
      {!list.length ? (
        <div className="empty-card">
          <p>{t('bk.noneYet')}</p>
          <button type="button" className="btn btn-primary" onClick={() => onGo('book')}>{t('nav.book')}</button>
        </div>
      ) : (
        <>
          <h2 className="sub-h">{t('bk.upcoming', { n: upcoming.length })}</h2>
          {upcoming.length ? <div className="booking-list">{upcoming.map(card)}</div> : <p className="empty">{t('bk.noUpcoming')}</p>}
          <h2 className="sub-h">{t('bk.past', { n: past.length })}</h2>
          {past.length ? <div className="booking-list">{past.map(card)}</div> : <p className="empty">{t('bk.nothing')}</p>}
        </>
      )}
    </>
  );
}

function PhotoPicker({ me }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // the same file can be picked again
    if (!file) return;
    if (PHOTO_TYPES.indexOf(file.type) === -1) { setError(t('photo.type')); return; }
    if (file.size > PHOTO_MAX_MB * 1024 * 1024) { setError(t('photo.big', { n: PHOTO_MAX_MB })); return; }
    setError('');
    setBusy(true);
    try {
      await uploadPhoto(file);
      toast(t('photo.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removePhoto();
      toast(t('photo.removed'), 'info');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-picker">
      <Avatar person={me} size="lg" />
      <div className="photo-picker-body">
        <strong>{t('photo.title')}</strong>
        <p className="hint">{t('photo.hint', { n: PHOTO_MAX_MB })}</p>
        <div className="actions">
          <label className={'btn btn-sm btn-primary file-btn' + (busy ? ' disabled' : '')}>
            {t(busy ? 'common.saving' : me.photo_url ? 'photo.change' : 'photo.upload')}
            <input type="file" accept={PHOTO_TYPES.join(',')} onChange={pick} disabled={busy} />
          </label>
          {me.photo_url && <button type="button" className="btn btn-sm btn-ghost" onClick={remove} disabled={busy}>{t('photo.remove')}</button>}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function Profile({ me }) {
  const [f, setF] = useState({ first_name: me.first_name, last_name: me.last_name, phone: me.phone });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');

  async function submit(e) {
    e.preventDefault();
    setStatus('');
    const errs = {};
    if (!f.first_name.trim()) errs.first_name = t('v.firstName');
    if (!f.last_name.trim()) errs.last_name = t('v.lastName');
    if (!PHONE_RE.test(f.phone.trim())) errs.phone = t('v.phone');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await updateProfile(me.account_id, f);
      toast(t('toast.profileSaved'));
    } catch (err) {
      setErrors({ phone: err.message });
    }
  }

  return (
    <>
    <PhotoPicker me={me} />
    <form className="panel-form" noValidate onSubmit={submit}>
      <div className="row-2">
        <div className="field">
          <label htmlFor="p-first">{t('f.firstName')}</label>
          <input type="text" id="p-first" maxLength={50} value={f.first_name} aria-invalid={errors.first_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <p className="field-error">{errors.first_name || ''}</p>
        </div>
        <div className="field">
          <label htmlFor="p-last">{t('f.lastName')}</label>
          <input type="text" id="p-last" maxLength={50} value={f.last_name} aria-invalid={errors.last_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, last_name: e.target.value })} />
          <p className="field-error">{errors.last_name || ''}</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-email">{t('f.email')}</label>
        <input type="email" id="p-email" value={me.email} readOnly aria-describedby="p-email-hint" />
        <p className="hint" id="p-email-hint">{t('acc.emailHint')}</p>
      </div>
      <div className="field">
        <label htmlFor="p-phone">{t('f.phone')}</label>
        <input type="tel" id="p-phone" maxLength={20} value={f.phone} aria-invalid={errors.phone ? 'true' : undefined}
          onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <p className="field-error">{errors.phone || ''}</p>
      </div>
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">{t('common.saveChanges')}</button>
    </form>
    </>
  );
}

function ReviewForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }) {
  const [rating, setRating] = useState(initial ? initial.rating : 0);
  const [comment, setComment] = useState(initial ? initial.comment : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!rating) { setError(t('rev.pickStars')); return; }
    setError('');
    setBusy(true);
    try {
      await onSubmit({ rating, comment: comment.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="review-form" noValidate onSubmit={submit}>
      <StarInput value={rating} onChange={setRating} idPrefix={idPrefix} invalid={!!error && !rating} />
      <div className="field">
        <label htmlFor={idPrefix + '-comment'}>{t('rev.comment')} <span className="muted">{t('common.optional')}</span></label>
        <textarea id={idPrefix + '-comment'} rows={4} maxLength={COMMENT_MAX} value={comment}
          placeholder={t('rev.placeholder')}
          aria-describedby={idPrefix + '-count'} onChange={(e) => setComment(e.target.value)} />
        <p className="hint" id={idPrefix + '-count'}>{comment.length} / {COMMENT_MAX}</p>
      </div>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : submitLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function MyReviews({ onGo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState('');   // key of the stay being reviewed
  const [editing, setEditing] = useState(0);    // review_id being edited
  const [confirmDelete, setConfirmDelete] = useState(0);

  function load() {
    myReviews().then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (error) return <p className="tx-box tx-fail" role="alert">{error}</p>;
  if (!data) return <p className="muted">{t('common.loading')}</p>;

  async function remove(r) {
    setConfirmDelete(0);
    try {
      await deleteReview(r.review_id);
      toast(t('rev.deleted', { room: r.room_number }), 'info');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <h2 className="sub-h">{t('rev.rateStays', { n: data.can_review.length })}</h2>
      {!data.can_review.length ? (
        <p className="empty">{t('rev.nothingToRate')}</p>
      ) : (
        <div className="booking-list">
          {data.can_review.map((s) => {
            const key = s.booking_id + '-' + s.room_id;
            return (
              <article className="booking-card" key={key}>
                <div className="booking-head">
                  <span className="ref">{t('common.roomN', { n: s.room_number })} · {typeName({ type_name: s.type_name })}</span>
                  <span className="muted">{ref(s.booking_id)}</span>
                </div>
                <p className="muted">{t('rev.stayed', { from: fmtDate(s.check_in), to: fmtDate(s.check_out) })}</p>
                {writing === key ? (
                  <ReviewForm idPrefix={'new-' + key} submitLabel={t('rev.publish')} onCancel={() => setWriting('')}
                    onSubmit={async (f) => {
                      await createReview(s.room_id, { ...f, booking_id: s.booking_id });
                      setWriting('');
                      toast(t('rev.sent', { room: s.room_number }));
                      load();
                    }} />
                ) : (
                  <div><button type="button" className="btn btn-primary" onClick={() => setWriting(key)}>{t('rev.write')}</button></div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <h2 className="sub-h">{t('rev.yours', { n: data.reviews.length })}</h2>
      {!data.reviews.length ? (
        <p className="empty">{t('rev.noneYet')}</p>
      ) : (
        <div className="review-list">
          {data.reviews.map((r) => (
            editing === r.review_id ? (
              <article className="review" key={r.review_id}>
                <strong>{t('common.roomN', { n: r.room_number })}</strong>
                <ReviewForm idPrefix={'edit-' + r.review_id} initial={r} submitLabel={t('common.saveChanges')} onCancel={() => setEditing(0)}
                  onSubmit={async (f) => {
                    const out = await updateReview(r.review_id, f);
                    setEditing(0);
                    toast(t('rev.updated', { room: r.room_number }) + (out.status === 'Pending' ? ' ' + t('rev.updatedPending') : ''));
                    load();
                  }} />
              </article>
            ) : (
              <ReviewItem key={r.review_id} r={r}>
                {r.status === 'Hidden' && (
                  <p className="note">{t('rev.hiddenNote')}</p>
                )}
                {r.status === 'Pending' && (
                  <p className="note note-info">{t('rev.pendingNote')}</p>
                )}
                <div className="row-actions">
                  {r.status !== 'Hidden' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(r.review_id)}>{t('common.edit')}</button>
                  )}
                  {confirmDelete === r.review_id ? (
                    <>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r)}>{t('common.yesDelete')}</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(0)}>{t('common.keep')}</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(r.review_id)}>{t('common.delete')}</button>
                  )}
                </div>
              </ReviewItem>
            )
          ))}
        </div>
      )}
      <p className="hint">{t('rev.hint')}
        {' '}<button type="button" className="link-btn" onClick={() => onGo('book')}>{t('confirm.again')}</button></p>
    </>
  );
}

function Security({ me }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function submit(e) {
    e.preventDefault();
    setStatus('');
    const problem = !oldPw ? t('v.pwCurrent')
      : passwordProblem(newPw) || (newPw !== newPw2 ? t('v.pwMatch') : '');
    setError(problem);
    if (problem) return;
    try {
      await changePassword(me.account_id, oldPw, newPw);
      setOldPw(''); setNewPw(''); setNewPw2('');
      toast(t('srv.pwChanged'));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="panel-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="s-old">{t('f.currentPassword')}</label>
        <PasswordInput id="s-old" autoComplete="current-password" value={oldPw} onChange={setOldPw} />
      </div>
      <div className="field">
        <label htmlFor="s-new">{t('f.newPassword')}</label>
        <PasswordInput id="s-new" autoComplete="new-password" value={newPw} onChange={setNewPw} describedBy="s-new-hint" />
        <p className="hint" id="s-new-hint">{t('pw.rule')}</p>
      </div>
      <div className="field">
        <label htmlFor="s-new2">{t('f.newPassword2')}</label>
        <PasswordInput id="s-new2" autoComplete="new-password" value={newPw2} onChange={setNewPw2} />
      </div>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">{t('acc.changePassword')}</button>
    </form>
  );
}

export default function AccountPage({ headingRef, me, onGo, openTab }) {
  const [tab, setTab] = useState('bookings');
  // week 13: "Change password" on the security notice opens the Password tab
  useEffect(() => { if (openTab && openTab.tab) setTab(openTab.tab); }, [openTab]);

  return (
    <>
      <div className="page-head account-head">
        <Avatar person={me} />
        <div>
          <h1 id="account-title" tabIndex={-1} ref={headingRef}>{me.first_name} {me.last_name}</h1>
          <p className="muted">{me.email} · <span className={'role-chip role-' + me.role}>{t('role.' + me.role)}</span></p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={t('acc.sections')}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            id={'tab-' + tb.id}
            aria-selected={tab === tb.id}
            aria-controls={'panel-' + tb.id}
            className="tab"
            onClick={() => setTab(tb.id)}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab} className="tab-panel">
        {tab === 'bookings' && <Bookings me={me} onGo={onGo} />}
        {tab === 'reviews' && <MyReviews onGo={onGo} />}
        {tab === 'profile' && <Profile me={me} />}
        {tab === 'security' && <Security me={me} />}
      </div>
    </>
  );
}
