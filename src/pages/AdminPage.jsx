import { useEffect, useState, useSyncExternalStore } from 'react';
import { getDb, money, bookingDetails, setRoomTypePrice, resetDb, TABLES, typeName } from '../db.js';
import { t, tn } from '../i18n/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { ROLES, setRole, setActive, deleteAccount, loadAccounts, unlockAccount } from '../auth.js';
import { loadReviewSummary, subscribeReviews, getReviewSummary } from '../reviews.js';
import { toast } from '../toast.js';
import { subscribeChat, getChat } from '../chat.js';
import { allReviews } from '../reviews.js';
import AdminReviews from '../components/AdminReviews.jsx';
import AdminChat from '../components/AdminChat.jsx';
import Avatar from '../components/Avatar.jsx';

const SECTIONS = [
  { id: 'overview', label: 'admin.s.overview' },
  { id: 'users', label: 'admin.s.users' },
  { id: 'reviews', label: 'admin.s.reviews' },
  { id: 'chat', label: 'admin.s.chat' },
  { id: 'prices', label: 'admin.s.prices' },
  { id: 'data', label: 'admin.s.data' }
];

function Overview() {
  const db = getDb();
  const { accounts } = useAuth();
  const paid = db.payment.filter((p) => p.payment_status === 'Paid').reduce((s, p) => s + Number(p.amount), 0);
  const refunded = db.payment.filter((p) => p.payment_status === 'Refunded').reduce((s, p) => s + Number(p.amount), 0);
  const active = db.booking.filter((b) => b.status === 'Confirmed' || b.status === 'CheckedIn');
  const byStatus = {};
  db.booking.forEach((b) => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });
  const byType = db.room_type.map((rt) => {
    let revenue = 0;
    let count = 0;
    db.booking.filter((b) => b.status !== 'Cancelled').forEach((b) => {
      const d = bookingDetails(b);
      db.booking_room.filter((l) => l.booking_id === b.booking_id).forEach((l) => {
        const room = db.room.filter((r) => r.room_id === l.room_id)[0];
        if (room && room.room_type_id === rt.room_type_id) { revenue += l.price_per_night * d.n; count++; }
      });
    });
    return { rt, revenue, count };
  });
  const maxRev = Math.max(1, ...byType.map((x) => x.revenue));
  const ratings = useSyncExternalStore(subscribeReviews, getReviewSummary);
  let rCount = 0;
  let rSum = 0;
  Object.values(ratings.room_types).forEach((r) => { if (r.count) { rCount += r.count; rSum += r.average * r.count; } });

  return (
    <>
      <div className="stat-grid">
        <div className="stat"><span>{t('admin.revenue')}</span><strong>{money(paid)}</strong></div>
        <div className="stat"><span>{t('status.Refunded')}</span><strong>{money(refunded)}</strong></div>
        <div className="stat"><span>{t('admin.active')}</span><strong>{active.length}</strong></div>
        <div className="stat"><span>{t('admin.accounts')}</span><strong>{accounts.length}</strong></div>
        <div className="stat"><span>{t('admin.rating')}</span><strong>{rCount ? (rSum / rCount).toFixed(1) + ' ★' : '–'}</strong><small className="muted">{tn('n.reviews', rCount)}</small></div>
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>{t('admin.byType')}</h3>
          <ul className="bars">
            {byType.map(({ rt, revenue, count }) => (
              <li key={rt.room_type_id}>
                <span className="bar-label">{typeName(rt)} <small>{tn('n.roomStays', count)}</small></span>
                <span className="bar-track"><span className="bar-fill" style={{ width: (revenue / maxRev * 100) + '%' }}></span></span>
                <strong>{money(revenue)}</strong>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h3>{t('admin.byStatus')}</h3>
          <dl className="kv">
            {Object.keys(byStatus).map((k) => (
              <div key={k}><dt>{t('status.' + k)}</dt><dd>{byStatus[k]}</dd></div>
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
        <div className="chips" role="group" aria-label={t('admin.filterRole')}>
          {['all'].concat(ROLES).map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={roleFilter === r} onClick={() => setRoleFilter(r)}>
              {r === 'all' ? t('staff.f.all') : t('role.' + r)} ({r === 'all' ? accounts.length : accounts.filter((a) => a.role === r).length})
            </button>
          ))}
        </div>
        <div className="field search-field">
          <label htmlFor="adm-q" className="sr">{t('admin.searchUsers')}</label>
          <input type="text" id="adm-q" placeholder={t('admin.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <p className="status" role="status">{status}</p>
      {error && <p className="tx-box tx-fail" role="alert">{error}</p>}

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>ID</th><th>{t('th.name')}</th><th>{t('f.email')}</th><th>{t('f.phone')}</th><th>{t('th.role')}</th><th>{t('th.status')}</th><th>{t('th.actions')}</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const self = a.account_id === me.account_id;
              return (
                <tr key={a.account_id}>
                  <td>{a.account_id}</td>
                  <td>
                    <span className="name-cell">
                      <Avatar person={a} size="sm" />
                      <span>{a.first_name} {a.last_name}{self && <small className="cell-sub">{t('admin.thatsYou')}</small>}</span>
                    </span>
                  </td>
                  <td>{a.email}</td>
                  <td>{a.phone}</td>
                  <td>
                    <label className="sr" htmlFor={'role-' + a.account_id}>{t('admin.roleFor', { email: a.email })}</label>
                    <select
                      id={'role-' + a.account_id}
                      value={a.role}
                      disabled={self}
                      onChange={(e) => run(() => setRole(a.account_id, e.target.value), t('toast.roleSet', { email: a.email, role: t('role.' + e.target.value) }))}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{t('role.' + r)}</option>)}
                    </select>
                  </td>
                  <td>
                    {a.active ? <span className="badge good">{t('admin.activeBadge')}</span> : <span className="badge bad">{t('admin.blocked')}</span>}
                    {a.locked_minutes > 0 && <span className="badge bad">{t('admin.locked', { n: a.locked_minutes })}</span>}
                  </td>
                  <td className="row-actions">
                    {!self && a.locked_minutes > 0 && (
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => run(() => unlockAccount(a.account_id), t('toast.unlocked', { email: a.email }))}>
                        Unlock login
                      </button>
                    )}
                    {!self && (
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => run(() => setActive(a.account_id, !a.active), t(a.active ? 'toast.blocked' : 'toast.unblocked', { email: a.email }))}>
                        {t(a.active ? 'admin.block' : 'admin.unblock')}
                      </button>
                    )}
                    {!self && (confirmDelete === a.account_id ? (
                      <>
                        <button type="button" className="btn btn-sm btn-danger"
                          onClick={() => { setConfirmDelete(0); run(() => deleteAccount(a.account_id), t('toast.deleted', { email: a.email })); }}>
                          Yes, delete
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(0)}>{t('common.keep')}</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(a.account_id)}>{t('common.delete')}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{t('admin.deleteHint')}</p>
    </>
  );
}

function Prices() {
  const db = getDb();
  const [draft, setDraft] = useState({});
  const [status, setStatus] = useState('');

  async function save(rt) {
    const v = parseFloat(draft[rt.room_type_id]);
    if (!(v > 0 && v < 100000)) { setStatus(t('admin.prices.enterFor', { type: typeName(rt) })); return; }
    try {
      await setRoomTypePrice(rt.room_type_id, v);
    } catch (e) {
      setStatus(e.message);
      return;
    }
    setDraft({ ...draft, [rt.room_type_id]: undefined });
    setStatus(t('admin.prices.keep'));
    toast(t('toast.price', { type: typeName(rt), price: money(v) }));
  }

  return (
    <>
      <p className="status" role="status">{status}</p>
      <div className="price-list">
        {db.room_type.map((rt) => {
          const val = draft[rt.room_type_id] ?? String(rt.price_per_night);
          return (
            <form className="price-row" key={rt.room_type_id} onSubmit={(e) => { e.preventDefault(); save(rt); }}>
              <div>
                <strong>{typeName(rt)}</strong>
                <small className="cell-sub">{t('room.sleeps', { n: rt.capacity })} · {tn('n.rooms', db.room.filter((r) => r.room_type_id === rt.room_type_id).length)}</small>
              </div>
              <div className="field">
                <label htmlFor={'price-' + rt.room_type_id}>{t('admin.prices.label')}</label>
                <input type="number" id={'price-' + rt.room_type_id} min={1} step="1" value={val}
                  onChange={(e) => setDraft({ ...draft, [rt.room_type_id]: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={Number(val) === Number(rt.price_per_night)}>{t('common.save')}</button>
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
    setStatus(t('admin.resetting'));
    try {
      await resetDb();
      await loadAccounts();
      loadReviewSummary();
      setStatus('');
      toast(t('toast.demoRestored'));
    } catch (e) {
      setStatus(e.message);
    }
  }

  const tables = TABLES.map((name) => ({ name, data: db[name] }))
    .concat([{ name: 'guest_role (' + t('admin.websiteAccounts') + ')', data: accounts }]);

  return (
    <>
      <p className="lead">{t('admin.dataLead')}</p>
      <div id="staff-db">
        {tables.map(({ name, data }) => {
          const cols = data.length ? Object.keys(data[0]) : [];
          return (
            <details key={name}>
              <summary>{name} ({tn('n.rows', data.length)})</summary>
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
        <h3>{t('admin.reset')}</h3>
        <p className="muted">{t('admin.resetText1')} <code>seed_demo</code> + <code>seed_roles</code>. {t('admin.resetText2')}</p>
        <div className="actions">
          {confirmReset ? (
            <>
              <button type="button" className="btn btn-danger" onClick={doReset}>{t('admin.resetYes')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>{t('admin.resetKeep')}</button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>{t('admin.reset')}</button>
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
      <aside className="admin-side" aria-label={t('admin.sections')}>
        <p className="eyebrow">{t('admin.panel')}</p>
        <nav>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="side-link" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              {t(s.label)}
              {badge[s.id] > 0 && <span className="chat-badge static" aria-label={t('common.nNew', { n: badge[s.id] })}>{badge[s.id]}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <div className="page-head">
          <h1 id="admin-title" tabIndex={-1} ref={headingRef}>{t(SECTIONS.find((s) => s.id === section).label)}</h1>
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
