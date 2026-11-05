import { useEffect, useRef, useState } from 'react';
import { useDb } from './hooks/useDb.js';
import { todayISO, addDays, loadSession, saveSession, resetDb } from './db.js';
import BookPage from './pages/BookPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import ConfirmPage from './pages/ConfirmPage.jsx';
import MinePage from './pages/MinePage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RoomDetailsModal from './components/RoomDetailsModal.jsx';

const HASH_VIEWS = ['book', 'mine', 'staff', 'about', 'login'];

function defaultDates() {
  const today = todayISO();
  const ci = today < '2026-12-10' ? '2026-12-10' : addDays(today, 7);
  return { ci, co: addDays(ci, 3) };
}

export default function App() {
  useDb(); // subscribe this (top-level) component so db mutations trigger a re-render
  const dd = defaultDates();

  const [view, setView] = useState(() => {
    const h = location.hash.replace('#', '');
    return HASH_VIEWS.indexOf(h) !== -1 ? h : 'book';
  });
  const [search, setSearch] = useState({ ci: dd.ci, co: dd.co, guests: 2 });
  const [sel, setSel] = useState({});
  const [staffDates, setStaffDates] = useState({ ci: dd.ci, co: dd.co });
  const [session, setSession] = useState(() => loadSession());
  const [lastEmail, setLastEmail] = useState('');
  const [confirmResult, setConfirmResult] = useState(null);
  const [detailsType, setDetailsType] = useState(null);

  const mainH1 = useRef(null);

  function go(name) {
    setView(name);
    if (HASH_VIEWS.indexOf(name) !== -1) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    }
  }

  useEffect(() => {
    window.scrollTo(0, 0);
    if (mainH1.current) mainH1.current.focus({ preventScroll: true });
  }, [view]);

  function login(email) {
    saveSession(email);
    setSession(email);
    go('mine');
  }

  function logout() {
    saveSession('');
    setSession('');
  }

  const navName = view === 'checkout' || view === 'confirm' ? 'book' : view;

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#book" onClick={(e) => { e.preventDefault(); go('book'); }}>Juniper Court</a>
        <nav aria-label="Main">
          <button type="button" className="nav-btn" aria-current={navName === 'book' ? 'page' : undefined} onClick={() => go('book')}>Book a room</button>
          <button type="button" className="nav-btn" aria-current={navName === 'mine' ? 'page' : undefined} onClick={() => go('mine')}>My bookings</button>
          <button type="button" className="nav-btn" aria-current={navName === 'staff' ? 'page' : undefined} onClick={() => go('staff')}>Staff view</button>
          <button type="button" className="nav-btn" aria-current={navName === 'about' ? 'page' : undefined} onClick={() => go('about')}>About</button>
          {session ? (
            <button type="button" className="nav-btn" onClick={logout}>Log out ({session})</button>
          ) : (
            <button type="button" className="nav-btn" aria-current={navName === 'login' ? 'page' : undefined} onClick={() => go('login')}>Log in</button>
          )}
        </nav>
      </header>

      <main id="main">
        <section className="view" hidden={view !== 'book'} aria-labelledby="book-title">
          <BookPage
            headingRef={view === 'book' ? mainH1 : null}
            search={search}
            setSearch={setSearch}
            sel={sel}
            setSel={setSel}
            onContinue={() => go('checkout')}
            onDetails={(typeId) => setDetailsType(typeId)}
          />
        </section>

        <section className="view" hidden={view !== 'checkout'} aria-labelledby="checkout-title">
          <CheckoutPage
            headingRef={view === 'checkout' ? mainH1 : null}
            search={search}
            sel={sel}
            onBack={() => go('book')}
            onPaid={(result, email) => {
              setConfirmResult({ result, email });
              setSel({});
              setLastEmail(email);
              go('confirm');
            }}
          />
        </section>

        <section className="view" hidden={view !== 'confirm'} aria-labelledby="confirm-title">
          {confirmResult && (
            <ConfirmPage
              headingRef={view === 'confirm' ? mainH1 : null}
              result={confirmResult.result}
              email={confirmResult.email}
              onViewMine={() => go('mine')}
              onBookAgain={() => go('book')}
            />
          )}
        </section>

        <section className="view" hidden={view !== 'mine'} aria-labelledby="mine-title">
          <MinePage
            headingRef={view === 'mine' ? mainH1 : null}
            session={session}
            lastEmail={lastEmail}
          />
        </section>

        <section className="view" hidden={view !== 'staff'} aria-labelledby="staff-title">
          <StaffPage
            headingRef={view === 'staff' ? mainH1 : null}
            staffDates={staffDates}
            setStaffDates={setStaffDates}
          />
        </section>

        <section className="view" hidden={view !== 'about'} aria-labelledby="about-title">
          <AboutPage headingRef={view === 'about' ? mainH1 : null} />
        </section>

        <section className="view" hidden={view !== 'login'} aria-labelledby="login-title">
          <LoginPage headingRef={view === 'login' ? mainH1 : null} onLogin={login} />
        </section>
      </main>

      <footer className="site-footer">
        <p>Prototype for the Task 9 database design. Data is saved in this browser only.</p>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            resetDb();
            setSel({});
            setLastEmail('');
          }}
        >
          Reset demo data
        </button>
      </footer>

      {detailsType != null && (
        <RoomDetailsModal typeId={detailsType} onClose={() => setDetailsType(null)} />
      )}
    </>
  );
}
