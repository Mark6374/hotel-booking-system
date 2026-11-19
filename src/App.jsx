import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDb } from './hooks/useDb.js';
import { useAuth } from './hooks/useAuth.js';
import { todayISO, addDays, reloadDb, ref } from './db.js';
import { loadReviewSummary } from './reviews.js';
import { currentTheme, toggleTheme, subscribeTheme } from './theme.js';
import { toast } from './toast.js';
import { logout, canOpen, homeFor, restoreSession, ACCESS, ROLE_LABEL } from './auth.js';
import HomePage from './pages/HomePage.jsx';
import BookPage from './pages/BookPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import ConfirmPage from './pages/ConfirmPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import Forbidden from './components/Forbidden.jsx';
import RoomDetailsModal from './components/RoomDetailsModal.jsx';
import Toaster from './components/Toaster.jsx';

const VIEWS = ['home', 'book', 'checkout', 'confirm', 'about', 'login', 'register', 'forgot', 'reset', 'account', 'staff', 'admin'];

const NOTICE = {
  checkout: 'Log in or create an account to finish your booking. Your rooms are kept.',
  confirm: 'Log in to see this booking.',
  account: 'Log in to see your bookings and profile.',
  staff: 'The front desk is for hotel staff. Log in with a staff account.',
  admin: 'The admin panel is for administrators. Log in with an admin account.'
};

function readHash() {
  const h = location.hash.replace('#', '').split('?')[0];
  return VIEWS.indexOf(h) !== -1 ? h : 'home';
}

/* #reset?token=... – the link from the password-reset email. */
function readToken() {
  return new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
}

function defaultDates() {
  const today = todayISO();
  const ci = today < '2026-12-10' ? '2026-12-10' : addDays(today, 7);
  return { ci, co: addDays(ci, 3) };
}

export default function App() {
  const data = useDb(); // re-render on any booking-data change
  const { me, ready } = useAuth();
  const dd = defaultDates();

  const [view, setView] = useState(readHash);
  const [resetToken, setResetToken] = useState(readToken);
  const [search, setSearch] = useState({ ci: dd.ci, co: dd.co, guests: 2 });
  const [sel, setSel] = useState({});
  const [staffDates, setStaffDates] = useState({ ci: dd.ci, co: dd.co });
  const [confirmResult, setConfirmResult] = useState(null);
  const [detailsType, setDetailsType] = useState(null);
  const [returnTo, setReturnTo] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);

  const mainH1 = useRef(null);

  // Load the tables from the API and turn a saved token back into a session.
  useEffect(() => {
    reloadDb();
    restoreSession();
    loadReviewSummary();
  }, []);

  useEffect(() => {
    const onHash = () => { setView(readHash()); setResetToken(readToken()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(name) {
    setMenuOpen(false);
    if (location.hash !== '#' + name) location.hash = name; // pushes history, so Back works
    setView(name);
    setResetToken('');
  }

  // Protected page opened without a session: remember it, show the login form in its place.
  const checking = !!ACCESS[view] && !ready; // still asking the server who we are
  const needsLogin = !!ACCESS[view] && ready && !me;
  const forbidden = !!ACCESS[view] && !!me && !canOpen(view, me);

  useEffect(() => {
    if (needsLogin) setReturnTo(view);
  }, [needsLogin, view]);

  // Logged-in users have no business on the login / sign-up pages.
  useEffect(() => {
    if (me && (view === 'login' || view === 'register')) go(homeFor(me));
  }, [me, view]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (mainH1.current) mainH1.current.focus({ preventScroll: true });
  }, [view, needsLogin, forbidden]);

  function afterAuth(account, isNew) {
    toast(isNew ? `Welcome, ${account.first_name}! Your account is ready.` : `Welcome back, ${account.first_name}.`);
    const target = returnTo && canOpen(returnTo, account) ? returnTo : homeFor(account);
    setReturnTo('');
    go(target);
  }

  function doLogout() {
    logout();
    toast('You are logged out.', 'info');
    setReturnTo('');
    go('home');
  }

  const navCurrent = view === 'checkout' || view === 'confirm' ? 'book' : view === 'forgot' || view === 'reset' ? 'login' : view;

  function navBtn(name, label) {
    return (
      <button type="button" className="nav-btn" aria-current={navCurrent === name ? 'page' : undefined} onClick={() => go(name)}>
        {label}
      </button>
    );
  }

  function renderView() {
    const h = mainH1;
    if (checking || (!data.loaded && !data.error)) {
      return <div className="gate"><h1 tabIndex={-1} ref={h}>Loading…</h1></div>;
    }
    if (!data.loaded) {
      return (
        <div className="gate">
          <h1 tabIndex={-1} ref={h}>The hotel server is not responding</h1>
          <p className="lead">{data.error}</p>
          <p className="muted">Start it with <code>cd backend && python3 manage.py runserver</code>, then try again.</p>
          <div className="actions"><button type="button" className="btn btn-primary" onClick={() => reloadDb()}>Try again</button></div>
        </div>
      );
    }
    if (needsLogin) return <LoginPage key="guard-login" headingRef={h} notice={NOTICE[view]} onLoggedIn={afterAuth} onGo={go} />;
    if (forbidden) return <Forbidden headingRef={h} me={me} needed={ACCESS[view]} onHome={() => go(homeFor(me))} onLogout={doLogout} />;

    switch (view) {
      case 'home':
        return (
          <HomePage headingRef={h} me={me} search={search} onDetails={setDetailsType} onGo={go}
            onSearch={(s) => { setSearch(s); setSel({}); go('book'); }} />
        );
      case 'book':
        return (
          <BookPage headingRef={h} loggedIn={!!me} search={search} setSearch={setSearch} sel={sel} setSel={setSel}
            onContinue={() => go('checkout')} onDetails={setDetailsType} />
        );
      case 'checkout':
        if (!Object.values(sel).some(Boolean)) {
          return (
            <div className="gate">
              <h1 tabIndex={-1} ref={h}>No rooms selected</h1>
              <p className="lead">Pick at least one room before checking out.</p>
              <div className="actions"><button type="button" className="btn btn-primary" onClick={() => go('book')}>Choose rooms</button></div>
            </div>
          );
        }
        return (
          <CheckoutPage headingRef={h} me={me} search={search} sel={sel} onBack={() => go('book')}
            onPaid={(result, email) => {
              setConfirmResult({ result, email });
              setSel({});
              toast(`Booking ${ref(result.bookingId)} confirmed. Your room is reserved.`);
              go('confirm');
            }} />
        );
      case 'confirm':
        if (!confirmResult) {
          return (
            <div className="gate">
              <h1 tabIndex={-1} ref={h}>Nothing to confirm</h1>
              <p className="lead">Your bookings are listed in your account.</p>
              <div className="actions"><button type="button" className="btn btn-primary" onClick={() => go('account')}>My bookings</button></div>
            </div>
          );
        }
        return (
          <ConfirmPage headingRef={h} result={confirmResult.result} email={confirmResult.email}
            onViewMine={() => go('account')} onBookAgain={() => go('book')} />
        );
      case 'account':
        return <AccountPage key={me.account_id} headingRef={h} me={me} onGo={go} />;
      case 'staff':
        return <StaffPage headingRef={h} me={me} staffDates={staffDates} setStaffDates={setStaffDates} />;
      case 'admin':
        return <AdminPage headingRef={h} me={me} />;
      case 'about':
        return <AboutPage headingRef={h} />;
      case 'login':
        return <LoginPage headingRef={h} onLoggedIn={afterAuth} onGo={go} />;
      case 'register':
        return <RegisterPage headingRef={h} onRegistered={(a) => afterAuth(a, true)} onGo={go} />;
      case 'forgot':
      case 'reset':
        return <ResetPasswordPage headingRef={h} token={view === 'reset' ? resetToken : ''} onGo={go} />;
      default:
        return null;
    }
  }

  const isStaff = me && (me.role === 'staff' || me.role === 'admin');
  const isAdmin = me && me.role === 'admin';

  return (
    <>
      <header className={'site-header' + (isStaff ? ' site-header-staff' : '')}>
        <div className="header-inner">
          <a className="brand" href="#home" onClick={(e) => { e.preventDefault(); go('home'); }}>
            Juniper Court
            {isStaff && <span className="brand-tag">{isAdmin ? 'Admin' : 'Staff'}</span>}
          </a>

          <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>
            Menu
          </button>

          <nav id="main-nav" aria-label="Main" className={menuOpen ? 'open' : ''}>
            <div className="nav-group">
              {navBtn('home', 'Home')}
              {navBtn('book', 'Book a room')}
              {navBtn('about', 'About')}
              {me && navBtn('account', 'My account')}
              {isStaff && navBtn('staff', 'Front desk')}
              {isAdmin && navBtn('admin', 'Admin')}
            </div>

            <div className="nav-group nav-user">
              <button type="button" className="theme-btn" onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
                <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
                <span className="theme-btn-text" aria-hidden="true">{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              {me ? (
                <>
                  <span className="user-pill" title={me.email}>
                    <span className="avatar avatar-sm" aria-hidden="true">{me.first_name[0]}{me.last_name[0]}</span>
                    <span className="user-pill-text">
                      {me.first_name}
                      <small>{ROLE_LABEL[me.role]}</small>
                    </span>
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={doLogout}>Log out</button>
                </>
              ) : (
                <>
                  {navBtn('login', 'Log in')}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => go('register')}>Sign up</button>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>

      {data.loaded && data.error && (
        <p className="net-banner" role="alert">Lost connection to the server: {data.error} <button type="button" className="link-btn" onClick={() => reloadDb()}>Retry</button></p>
      )}

      <main id="main" className={view === 'home' && !needsLogin ? 'main-home' : ''}>
        {renderView()}
      </main>

      <footer className="site-footer">
        <p>Juniper Court Hotel · 14 Juniper Court, Almaty</p>
        <p>Prototype for the Task 9 database design. Data comes from the Django + MySQL backend.</p>
      </footer>

      {detailsType != null && (
        <RoomDetailsModal typeId={detailsType} onClose={() => setDetailsType(null)} />
      )}

      <Toaster />
    </>
  );
}
