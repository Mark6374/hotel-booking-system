import { useEffect, useState, useSyncExternalStore } from 'react';
import { getDb, money, plural, bookingDetails, setRoomTypePrice, resetDb, TABLES } from '../db.js';
import { useAuth } from '../hooks/useAuth.js';
import { ROLES, ROLE_LABEL, setRole, setActive, deleteAccount, loadAccounts, unlockAccount } from '../auth.js';
import { loadReviewSummary, subscribeReviews, getReviewSummary } from '../reviews.js';
import { toast } from '../toast.js';
import { subscribeChat, getChat } from '../chat.js';
import { allReviews } from '../reviews.js';
import AdminReviews from '../components/AdminReviews.jsx';
import AdminChat from '../components/AdminChat.jsx';
import Avatar from '../components/Avatar.jsx';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users and roles' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'chat', label: 'Support chat' },
  { id: 'prices', label: 'Room prices' },
  { id: 'data', label: 'Database' }
];

function Overview() {
  const db = getDb();
  const { accounts } = useAuth();
  const paid = db.payment.filter((p) => p.payment_status === 'Paid').reduce((s, p) => s + Number(p.amount), 0);
  const refunded = db.payment.filter((p) => p.payment_status === 'Refunded').reduce((s, p) => s + Number(p.amount), 0);
  const active = db.booking.filter((b) => b.status === 'Confirmed' || b.status === 'CheckedIn');
  const byStatus = {};
  db.booking.forEach((b) => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });
  const byType = db.room_type.map((t) => {
    let revenue = 0;
    let count = 0;
    db.booking.filter((b) => b.status !== 'Cancelled').forEach((b) => {
      const d = bookingDetails(b);
      db.booking_room.filter((l) => l.booking_id === b.booking_id).forEach((l) => {
        const room = db.room.filter((r) => r.room_id === l.room_id)[0];
        if (room && room.room_type_id === t.room_type_id) { revenue += l.price_per_night * d.n; count++; }
      });
    });
    return { t, revenue, count };
  });
  const maxRev = Math.max(1, ...byType.map((x) => x.revenue));
  const ratings = useSyncExternalStore(subscribeReviews, getReviewSummary);
  let rCount = 0;
  let rSum = 0;
  Object.values(ratings.room_types).forEach((r) => { if (r.count) { rCount += r.count; rSum += r.average * r.count; } });

  return (
    <>
      <div className="stat-grid">
        <div className="stat"><span>Revenue (paid)</span><strong>{money(paid)}</strong></div>
        <div className="stat"><span>Refunded</span><strong>{money(refunded)}</strong></div>
        <div className="stat"><span>Active bookings</span><strong>{active.length}</strong></div>
        <div className="stat"><span>User accounts</span><strong>{accounts.length}</strong></div>
        <div className="stat"><span>Guest rating</span><strong>{rCount ? (rSum / rCount).toFixed(1) + ' ★' : '–'}</strong><small className="muted">{rCount} {rCount === 1 ? 'review' : 'reviews'}</small></div>
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>Booked revenue by room type</h3>
          <ul className="bars">
            {byType.map(({ t, revenue, count }) => (
              <li key={t.room_type_id}>
                <span className="bar-label">{t.type_name} <small>{plural(count, 'room-stay', 'room-stays')}</small></span>
                <span className="bar-track"><span className="bar-fill" style={{ width: (revenue / maxRev * 100) + '%' }}></span></span>
                <strong>{money(revenue)}</strong>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h3>Bookings by status</h3>
          <dl className="kv">
            {Object.keys(byStatus).map((k) => (
              <div key={k}><dt>{k === 'CheckedIn' ? 'Checked in' : k}</dt><dd>{byStatus[k]}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

function Users({ me }) {
  const { accounts } = useAuth();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(0);

  useEffect(() => { loadAccounts(); }, []);

  async function run(fn, msg) {
    setError('');
    try { await fn(); setStatus(''); toast(msg); } catch (e) { setError(e.message); setStatus(''); }
  }

  const q = query.trim().toLowerCase();
  const rows = accounts
    .filter((a) => roleFilter === 'all' || a.role === roleFilter)
    .filter((a) => !q || (a.first_name + ' ' + a.last_name + ' ' + a.email).toLowerCase().indexOf(q) !== -1);

  return (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by role">
          {['all'].concat(ROLES).map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={roleFilter === r} onClick={() => setRoleFilter(r)}>
              {r === 'all' ? 'All' : ROLE_LABEL[r]} ({r === 'all' ? accounts.length : accounts.filter((a) => a.role === r).length})
            </button>
          ))}
        </div>
        <div className="field search-field">
          <label htmlFor="adm-q" className="sr">Search users</label>
          <input type="text" id="adm-q" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <p className="status" role="status">{status}</p>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const self = a.account_id === me.account_id;
              return (
                <tr key={a.account_id}>
                  <td>{a.account_id}</td>
                  <td>
                    <span className="name-cell">
                      <Avatar person={a} size="sm" />
                      <span>{a.first_name} {a.last_name}{self && <small className="cell-sub">That's you</small>}</span>
                    </span>
                  </td>
                  <td>{a.email}</td>
                  <td>{a.phone}</td>
                  <td>
                    <label className="sr" htmlFor={'role-' + a.account_id}>Role for {a.email}</label>
                    <select
                      id={'role-' + a.account_id}
                      value={a.role}
                      disabled={self}
                      onChange={(e) => run(() => setRole(a.account_id, e.target.value), `${a.email} is now ${ROLE_LABEL[e.target.value]}.`)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    {a.active ? <span className="badge good">Active</span> : <span className="badge bad">Blocked</span>}
                    {a.locked_minutes > 0 && <span className="badge bad"> Locked {a.locked_minutes} min</span>}
                  </td>
                  <td className="row-actions">
                    {!self && a.locked_minutes > 0 && (
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => run(() => unlockAccount(a.account_id), `${a.email} unlocked.`)}>
                        Unlock login
                      </button>
                    )}
                    {!self && (
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => run(() => setActive(a.account_id, !a.active), `${a.email} ${a.active ? 'blocked' : 'unblocked'}.`)}>
                        {a.active ? 'Block' : 'Unblock'}
                      </button>
                    )}
                    {!self && (confirmDelete === a.account_id ? (
                      <>
                        <button type="button" className="btn btn-sm btn-danger"
                          onClick={() => { setConfirmDelete(0); run(() => deleteAccount(a.account_id), `${a.email} deleted.`); }}>
                          Yes, delete
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(0)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(a.account_id)}>Delete</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Deleting an account only removes its login. The guest row and bookings stay, since they are part of the hotel's records.</p>
    </>
  );
}

function Prices() {
  const db = getDb();
  const [draft, setDraft] = useState({});
  const [status, setStatus] = useState('');

  async function save(t) {
    const v = parseFloat(draft[t.room_type_id]);
    if (!(v > 0 && v < 100000)) { setStatus('Enter a price above 0 for ' + t.type_name + '.'); return; }
    try {
      await setRoomTypePrice(t.room_type_id, v);
    } catch (e) {
      setStatus(e.message);
      return;
    }
    setDraft({ ...draft, [t.room_type_id]: undefined });
    setStatus('Existing bookings keep their old price.');
    toast(t.type_name + ' now costs ' + money(v) + ' per night.');
  }

  return (
    <>
      <p className="status" role="status">{status}</p>
      <div className="price-list">
        {db.room_type.map((t) => {
          const val = draft[t.room_type_id] ?? String(t.price_per_night);
          return (
            <form className="price-row" key={t.room_type_id} onSubmit={(e) => { e.preventDefault(); save(t); }}>
              <div>
                <strong>{t.type_name}</strong>
                <small className="cell-sub">Sleeps {t.capacity} · {db.room.filter((r) => r.room_type_id === t.room_type_id).length} rooms</small>
              </div>
              <div className="field">
                <label htmlFor={'price-' + t.room_type_id}>Price per night, $</label>
                <input type="number" id={'price-' + t.room_type_id} min={1} step="1" value={val}
                  onChange={(e) => setDraft({ ...draft, [t.room_type_id]: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={Number(val) === Number(t.price_per_night)}>Save</button>
            </form>
          );
        })}
      </div>
    </>
  );
}

function Data() {
  const db = getDb();
  const { accounts } = useAuth();
  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  async function doReset() {
    setConfirmReset(false);
    setStatus('Resetting…');
    try {
      await resetDb();
      await loadAccounts();
      loadReviewSummary();
      setStatus('');
      toast('Demo data restored.');
    } catch (e) {
      setStatus(e.message);
    }
  }

  const tables = TABLES.map((name) => ({ name, data: db[name] }))
    .concat([{ name: 'guest_role (website accounts)', data: accounts }]);

  return (
    <>
      <p className="lead">Live rows from the MySQL database, read through the Django API. Password hashes are never sent to the browser.</p>
      <div id="staff-db">
        {tables.map(({ name, data }) => {
          const cols = data.length ? Object.keys(data[0]) : [];
          return (
            <details key={name}>
              <summary>{name} ({plural(data.length, 'row', 'rows')})</summary>
              <div className="tbl-wrap">
                <table>
                  <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.map((row, idx) => (
                      <tr key={idx}>{cols.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <section className="panel danger-zone">
        <h3>Reset demo data</h3>
        <p className="muted">Runs <code>seed_demo</code> and <code>seed_roles</code> on the server: every table is wiped and the sample rows and demo accounts come back. Accounts registered on the site are kept (with their password and role), but their bookings and reviews are removed. This cannot be undone.</p>
        <div className="actions">
          {confirmReset ? (
            <>
              <button type="button" className="btn btn-danger" onClick={doReset}>Yes, wipe and re-seed</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Keep my data</button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>Reset demo data</button>
          )}
        </div>
        <p className="status" role="status">{status}</p>
      </section>
    </>
  );
}

export default function AdminPage({ headingRef, me }) {
  const [section, setSection] = useState('overview');
  const [pending, setPending] = useState(0);
  const chat = useSyncExternalStore(subscribeChat, getChat);

  // badge "reviews waiting" in the side menu
  useEffect(() => {
    allReviews('Pending').then((rows) => setPending(rows.length)).catch(() => {});
  }, []);

  const badge = { reviews: pending, chat: chat.unreadTotal };

  return (
    <div className="admin-layout">
      <aside className="admin-side" aria-label="Admin sections">
        <p className="eyebrow">Admin panel</p>
        <nav>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="side-link" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              {s.label}
              {badge[s.id] > 0 && <span className="chat-badge static" aria-label={`${badge[s.id]} new`}>{badge[s.id]}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <div className="page-head">
          <h1 id="admin-title" tabIndex={-1} ref={headingRef}>{SECTIONS.find((s) => s.id === section).label}</h1>
        </div>
        {section === 'overview' && <Overview />}
        {section === 'users' && <Users me={me} />}
        {section === 'reviews' && <AdminReviews onCount={setPending} />}
        {section === 'chat' && <AdminChat />}
        {section === 'prices' && <Prices />}
        {section === 'data' && <Data />}
      </div>
    </div>
  );
}
