import { useState, useSyncExternalStore } from 'react';
import {
  getDb, blockedRoomIds, typeOf, bookingDetails, fmtDate, ref, todayISO, addDays,
  toggleRoomMaintenance, checkInBooking, checkOutBooking, cancelBooking, typeName
} from '../db.js';
import { t } from '../i18n/index.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { toast } from '../toast.js';
import { subscribeChat, getChat } from '../chat.js';
import AdminChat from '../components/AdminChat.jsx';

const FILTERS = [
  { id: 'all', label: 'staff.f.all' },
  { id: 'arrivals', label: 'staff.f.arrivals' },
  { id: 'inhouse', label: 'staff.f.inhouse' },
  { id: 'departures', label: 'staff.f.departures' },
  { id: 'upcoming', label: 'staff.f.upcoming' },
  { id: 'closed', label: 'staff.f.closed' }
];

export default function StaffPage({ headingRef, me, staffDates, setStaffDates }) {
  const db = getDb();
  const today = todayISO();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('desk');          // 'desk' | 'chat'
  const chat = useSyncExternalStore(subscribeChat, getChat);

  const s = staffDates;
  const datesOk = s.ci && s.co && s.co > s.ci;
  const blocked = datesOk ? blockedRoomIds(db, s.ci, s.co) : {};

  const guestOf = (b) => db.guest.filter((x) => x.guest_id === b.guest_id)[0] || { first_name: '?', last_name: '', email: '' };

  const arrivals = db.booking.filter((b) => b.status === 'Confirmed' && b.check_in === today);
  const inhouse = db.booking.filter((b) => b.status === 'CheckedIn');
  const departures = inhouse.filter((b) => b.check_out <= today);
  const todayBlocked = blockedRoomIds(db, today, addDays(today, 1));
  const freeToday = db.room.filter((r) => r.status === 'Available' && !todayBlocked[r.room_id]).length;

  const match = {
    all: () => true,
    arrivals: (b) => b.status === 'Confirmed' && b.check_in === today,
    inhouse: (b) => b.status === 'CheckedIn',
    departures: (b) => b.status === 'CheckedIn' && b.check_out <= today,
    upcoming: (b) => b.status === 'Confirmed' && b.check_in > today,
    closed: (b) => b.status === 'Completed' || b.status === 'Cancelled'
  }[filter];

  const q = query.trim().toLowerCase();
  const rows = db.booking
    .filter(match)
    .filter((b) => {
      if (!q) return true;
      const g = guestOf(b);
      return (ref(b.booking_id) + ' ' + g.first_name + ' ' + g.last_name + ' ' + g.email).toLowerCase().indexOf(q) !== -1;
    })
    .sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : a.booking_id - b.booking_id));

  async function act(fn, id, msg) {
    try {
      const out = await fn(id);
      setStatus('');
      toast(typeof msg === 'function' ? msg(out) : msg);
    } catch (e) {
      setStatus(e.message);
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{t('nav.staff')} · {me.first_name} {me.last_name}</p>
        <h1 id="staff-title" tabIndex={-1} ref={headingRef}>{t('nav.staff')}</h1>
        <p className="lead">{t('staff.lead', { date: fmtDate(today) })}</p>
      </div>

      <div className="tabs" role="tablist" aria-label={t('nav.staff')}>
        {[{ id: 'desk', label: t('staff.tabDesk') }, { id: 'chat', label: t('admin.s.chat'), badge: chat.unreadTotal }].map((x) => (
          <button key={x.id} type="button" role="tab" id={'staff-tab-' + x.id} aria-selected={tab === x.id}
            aria-controls={'staff-panel-' + x.id} className="tab" onClick={() => setTab(x.id)}>
            {x.label}
            {x.badge > 0 && <span className="chat-badge static" aria-label={t('common.nNew', { n: x.badge })}>{x.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'chat' ? (
        <div role="tabpanel" id="staff-panel-chat" aria-labelledby="staff-tab-chat" className="tab-panel">
          <AdminChat />
        </div>
      ) : (
      <div role="tabpanel" id="staff-panel-desk" aria-labelledby="staff-tab-desk" className="tab-panel">
      <div className="stat-grid">
        <div className="stat"><span>{t('staff.f.arrivals')}</span><strong>{arrivals.length}</strong></div>
        <div className="stat"><span>{t('staff.f.inhouse')}</span><strong>{inhouse.length}</strong></div>
        <div className="stat"><span>{t('staff.dueToLeave')}</span><strong>{departures.length}</strong></div>
        <div className="stat"><span>{t('staff.freeTonight')}</span><strong>{freeToday} / {db.room.length}</strong></div>
      </div>

      <h2 className="sub-h">{t('staff.bookings')}</h2>
      <div className="toolbar">
        <div className="chips" role="group" aria-label={t('staff.filter')}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{t(f.label)}</button>
          ))}
        </div>
        <div className="field search-field">
          <label htmlFor="staff-q" className="sr">{t('staff.search')}</label>
          <input type="text" id="staff-q" placeholder={t('staff.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <p className="status" role="status">{status}</p>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>{t('th.ref')}</th><th>{t('th.guest')}</th><th>{t('bk.rooms')}</th><th>{t('search.checkIn')}</th><th>{t('search.checkOut')}</th><th>{t('th.status')}</th><th>{t('bk.payment')}</th><th>{t('th.actions')}</th></tr></thead>
          <tbody>
            {!rows.length && (
              <tr><td colSpan={8} className="muted">{t('staff.noMatch')}</td></tr>
            )}
            {rows.map((b) => {
              const g = guestOf(b);
              const d = bookingDetails(b);
              const label = ref(b.booking_id);
              return (
                <tr key={b.booking_id}>
                  <td>{label}</td>
                  <td>{g.first_name} {g.last_name}<small className="cell-sub">{g.email}</small></td>
                  <td>{d.rooms.join(', ')}</td>
                  <td>{fmtDate(b.check_in)}</td>
                  <td>{fmtDate(b.check_out)}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{d.pay ? <StatusBadge status={d.pay.payment_status} /> : t('bk.none')}</td>
                  <td className="row-actions">
                    {b.status === 'Confirmed' && b.check_in <= today && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => act(checkInBooking, b.booking_id, t('toast.checkedIn', { ref: label }))}>{t('staff.checkIn')}</button>
                    )}
                    {b.status === 'CheckedIn' && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => act(checkOutBooking, b.booking_id, t('toast.checkedOut', { ref: label }))}>{t('staff.checkOut')}</button>
                    )}
                    {b.status === 'Confirmed' && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => act(cancelBooking, b.booking_id, (refunded) => t('toast.cancelled', { ref: label }) + (refunded ? ' ' + t('toast.refunded') : ''))}>{t('common.cancel')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="sub-h">{t('staff.rooms')}</h2>
      <form className="inline-form" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="staff-ci">{t('staff.from')}</label>
          <input type="date" id="staff-ci" value={s.ci} onChange={(e) => setStaffDates({ ...s, ci: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="staff-co">{t('staff.to')}</label>
          <input type="date" id="staff-co" value={s.co} onChange={(e) => setStaffDates({ ...s, co: e.target.value })} />
        </div>
      </form>
      <p className="form-error dark" role="alert">{datesOk ? '' : t('staff.datesErr')}</p>

      <div className="room-grid">
        {datesOk && db.room.map((r) => {
          const rt = typeOf(db, r);
          let cls = 'room';
          let line;
          if (r.status !== 'Available') {
            cls += ' off';
            line = t('book.closed');
          } else if (blocked[r.room_id]) {
            cls += ' taken';
            const b = db.booking.filter((x) => x.booking_id === blocked[r.room_id])[0];
            const g = guestOf(b);
            line = t('staff.bookedBy', { name: g.first_name + ' ' + g.last_name, ref: ref(b.booking_id) });
          } else {
            line = t('staff.freeDates');
          }
          return (
            <div className={cls} key={r.room_id}>
              <strong>{t('common.roomN', { n: r.room_number })}</strong>
              <span>{t('staff.typeFloor', { type: typeName(rt), floor: r.floor })}</span>
              <small>{line}</small>
              <button type="button" className="link-btn" onClick={() => act(toggleRoomMaintenance, r.room_id, t(r.status === 'Available' ? 'toast.roomClosed' : 'toast.roomReopened', { n: r.room_number }))}>
                {t(r.status === 'Available' ? 'staff.close' : 'staff.reopen')}
              </button>
            </div>
          );
        })}
      </div>

      </div>
      )}
    </>
  );
}
