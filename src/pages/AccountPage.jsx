import { useEffect, useState } from 'react';
import { getDb, bookingDetails, fmtDate, money, ref, todayISO, cancelBooking, guestByEmail } from '../db.js';
import { updateProfile, changePassword, passwordProblem, ROLE_LABEL, PHONE_RE, PHONE_MESSAGE, uploadPhoto, removePhoto, PHOTO_TYPES, PHOTO_MAX_MB } from '../auth.js';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { StarInput } from '../components/Stars.jsx';
import { ReviewItem } from '../components/RoomDetailsModal.jsx';
import { myReviews, createReview, updateReview, deleteReview, COMMENT_MAX } from '../reviews.js';
import { toast } from '../toast.js';

const TABS = [
  { id: 'bookings', label: 'My bookings' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password' }
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
      toast('Booking ' + ref(id) + ' cancelled.' + (refunded ? ' The payment is refunded.' : ''));
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
          <span>Dates <strong>{fmtDate(b.check_in)} to {fmtDate(b.check_out)}</strong></span>
          <span>Nights <strong>{d.n}</strong></span>
          <span>Rooms <strong>{d.rooms.join(', ')}</strong></span>
          <span>Total <strong>{money(d.total)}</strong></span>
          <span>Payment {d.pay ? <StatusBadge status={d.pay.payment_status} /> : <strong>None</strong>}</span>
        </div>
        {canCancel && (
          <div><button type="button" className="btn btn-danger" onClick={() => onCancel(b.booking_id)}>Cancel booking {ref(b.booking_id)}</button></div>
        )}
      </article>
    );
  }

  return (
    <>
      <p className="status" role="status">{status}</p>
      {!list.length ? (
        <div className="empty-card">
          <p>You have no bookings yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => onGo('book')}>Book a room</button>
        </div>
      ) : (
        <>
          <h2 className="sub-h">Upcoming ({upcoming.length})</h2>
          {upcoming.length ? <div className="booking-list">{upcoming.map(card)}</div> : <p className="empty">No upcoming stays.</p>}
          <h2 className="sub-h">Past and cancelled ({past.length})</h2>
          {past.length ? <div className="booking-list">{past.map(card)}</div> : <p className="empty">Nothing here yet.</p>}
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
    if (PHOTO_TYPES.indexOf(file.type) === -1) { setError('Use a JPEG, PNG or WebP picture.'); return; }
    if (file.size > PHOTO_MAX_MB * 1024 * 1024) { setError('The photo is too big. The limit is ' + PHOTO_MAX_MB + ' MB.'); return; }
    setError('');
    setBusy(true);
    try {
      await uploadPhoto(file);
      toast('Profile photo saved.');
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
      toast('Profile photo removed.', 'info');
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
        <strong>Profile photo</strong>
        <p className="hint">JPEG, PNG or WebP, up to {PHOTO_MAX_MB} MB. It is cropped to a square. The hotel team sees it in the support chat.</p>
        <div className="actions">
          <label className={'btn btn-sm btn-primary file-btn' + (busy ? ' disabled' : '')}>
            {busy ? 'Saving…' : me.photo_url ? 'Change photo' : 'Upload photo'}
            <input type="file" accept={PHOTO_TYPES.join(',')} onChange={pick} disabled={busy} />
          </label>
          {me.photo_url && <button type="button" className="btn btn-sm btn-ghost" onClick={remove} disabled={busy}>Remove</button>}
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
    if (!f.first_name.trim()) errs.first_name = 'Enter your first name.';
    if (!f.last_name.trim()) errs.last_name = 'Enter your last name.';
    if (!PHONE_RE.test(f.phone.trim())) errs.phone = PHONE_MESSAGE;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await updateProfile(me.account_id, f);
      toast('Profile saved.');
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
          <label htmlFor="p-first">First name</label>
          <input type="text" id="p-first" maxLength={50} value={f.first_name} aria-invalid={errors.first_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <p className="field-error">{errors.first_name || ''}</p>
        </div>
        <div className="field">
          <label htmlFor="p-last">Last name</label>
          <input type="text" id="p-last" maxLength={50} value={f.last_name} aria-invalid={errors.last_name ? 'true' : undefined}
            onChange={(e) => setF({ ...f, last_name: e.target.value })} />
          <p className="field-error">{errors.last_name || ''}</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-email">Email</label>
        <input type="email" id="p-email" value={me.email} readOnly aria-describedby="p-email-hint" />
        <p className="hint" id="p-email-hint">Your email is your login and cannot be changed here.</p>
      </div>
      <div className="field">
        <label htmlFor="p-phone">Phone</label>
        <input type="tel" id="p-phone" maxLength={20} value={f.phone} aria-invalid={errors.phone ? 'true' : undefined}
          onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <p className="field-error">{errors.phone || ''}</p>
      </div>
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">Save changes</button>
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
    if (!rating) { setError('Pick from 1 to 5 stars.'); return; }
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
        <label htmlFor={idPrefix + '-comment'}>Comment <span className="muted">(optional)</span></label>
        <textarea id={idPrefix + '-comment'} rows={4} maxLength={COMMENT_MAX} value={comment}
          placeholder="What did you like? What could be better?"
          aria-describedby={idPrefix + '-count'} onChange={(e) => setComment(e.target.value)} />
        <p className="hint" id={idPrefix + '-count'}>{comment.length} / {COMMENT_MAX}</p>
      </div>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
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
  if (!data) return <p className="muted">Loading…</p>;

  async function remove(r) {
    setConfirmDelete(0);
    try {
      await deleteReview(r.review_id);
      toast('Your review of room ' + r.room_number + ' is deleted.', 'info');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <h2 className="sub-h">Rate your stays ({data.can_review.length})</h2>
      {!data.can_review.length ? (
        <p className="empty">Nothing to rate right now. After you check out, your rooms show up here.</p>
      ) : (
        <div className="booking-list">
          {data.can_review.map((s) => {
            const key = s.booking_id + '-' + s.room_id;
            return (
              <article className="booking-card" key={key}>
                <div className="booking-head">
                  <span className="ref">Room {s.room_number} · {s.type_name}</span>
                  <span className="muted">{ref(s.booking_id)}</span>
                </div>
                <p className="muted">Stayed {fmtDate(s.check_in)} to {fmtDate(s.check_out)}</p>
                {writing === key ? (
                  <ReviewForm idPrefix={'new-' + key} submitLabel="Publish review" onCancel={() => setWriting('')}
                    onSubmit={async (f) => {
                      await createReview(s.room_id, { ...f, booking_id: s.booking_id });
                      setWriting('');
                      toast('Thank you! Your review of room ' + s.room_number + ' is sent. It appears on the site after the hotel checks it.');
                      load();
                    }} />
                ) : (
                  <div><button type="button" className="btn btn-primary" onClick={() => setWriting(key)}>Write a review</button></div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <h2 className="sub-h">Your reviews ({data.reviews.length})</h2>
      {!data.reviews.length ? (
        <p className="empty">You have not written any reviews yet.</p>
      ) : (
        <div className="review-list">
          {data.reviews.map((r) => (
            editing === r.review_id ? (
              <article className="review" key={r.review_id}>
                <strong>Room {r.room_number}</strong>
                <ReviewForm idPrefix={'edit-' + r.review_id} initial={r} submitLabel="Save changes" onCancel={() => setEditing(0)}
                  onSubmit={async (f) => {
                    const out = await updateReview(r.review_id, f);
                    setEditing(0);
                    toast('Your review of room ' + r.room_number + ' is updated.' + (out.status === 'Pending' ? ' It will be visible again after the hotel checks it.' : ''));
                    load();
                  }} />
              </article>
            ) : (
              <ReviewItem key={r.review_id} r={r}>
                {r.status === 'Hidden' && (
                  <p className="note">The hotel did not publish this review. Only you can see it, and it cannot be edited.</p>
                )}
                {r.status === 'Pending' && (
                  <p className="note note-info">Waiting for approval. It appears on the website after the hotel checks it.</p>
                )}
                <div className="row-actions">
                  {r.status !== 'Hidden' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(r.review_id)}>Edit</button>
                  )}
                  {confirmDelete === r.review_id ? (
                    <>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r)}>Yes, delete</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(0)}>Keep</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(r.review_id)}>Delete</button>
                  )}
                </div>
              </ReviewItem>
            )
          ))}
        </div>
      )}
      <p className="hint">You can rate a room once per stay, after you check out. Reviews are checked by the hotel before they appear. Your name is shown as first name and initial only.
        {' '}<button type="button" className="link-btn" onClick={() => onGo('book')}>Book another stay</button></p>
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
    const problem = !oldPw ? 'Enter your current password.'
      : passwordProblem(newPw) || (newPw !== newPw2 ? 'The new passwords do not match.' : '');
    setError(problem);
    if (problem) return;
    try {
      await changePassword(me.account_id, oldPw, newPw);
      setOldPw(''); setNewPw(''); setNewPw2('');
      toast('Password changed.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="panel-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="s-old">Current password</label>
        <PasswordInput id="s-old" autoComplete="current-password" value={oldPw} onChange={setOldPw} />
      </div>
      <div className="field">
        <label htmlFor="s-new">New password</label>
        <PasswordInput id="s-new" autoComplete="new-password" value={newPw} onChange={setNewPw} describedBy="s-new-hint" />
        <p className="hint" id="s-new-hint">At least 8 characters with a letter and a digit.</p>
      </div>
      <div className="field">
        <label htmlFor="s-new2">Repeat new password</label>
        <PasswordInput id="s-new2" autoComplete="new-password" value={newPw2} onChange={setNewPw2} />
      </div>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}
      <p className="status" role="status">{status}</p>
      <button type="submit" className="btn btn-primary">Change password</button>
    </form>
  );
}

export default function AccountPage({ headingRef, me, onGo }) {
  const [tab, setTab] = useState('bookings');

  return (
    <>
      <div className="page-head account-head">
        <Avatar person={me} />
        <div>
          <h1 id="account-title" tabIndex={-1} ref={headingRef}>{me.first_name} {me.last_name}</h1>
          <p className="muted">{me.email} · <span className={'role-chip role-' + me.role}>{ROLE_LABEL[me.role]}</span></p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Account sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={'tab-' + t.id}
            aria-selected={tab === t.id}
            aria-controls={'panel-' + t.id}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
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
