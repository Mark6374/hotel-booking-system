import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDb } from './hooks/useDb.js';
import { useAuth } from './hooks/useAuth.js';
import { todayISO, addDays, reloadDb, ref } from './db.js';
import { loadReviewSummary } from './reviews.js';
import { currentTheme, toggleTheme, subscribeTheme } from './theme.js';
import { toast } from './toast.js';
import { logout, canOpen, homeFor, restoreSession, ACCESS } from './auth.js';
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
import ChatWidget from './components/ChatWidget.jsx';
import Avatar from './components/Avatar.jsx';
import { startChat, stopChat, subscribeChat, getChat } from './chat.js';
import { t, getLang, subscribeLang } from './i18n/index.js';
import LangSwitch from './components/LangSwitch.jsx';

const VIEWS = ['home', 'book', 'checkout', 'confirm', 'about', 'login', 'register', 'forgot', 'reset', 'account', 'staff', 'admin'];

/* Shown above the login form when a protected page is opened without a session. */
const NOTICE = { checkout: 'notice.checkout', confirm: 'notice.confirm', account: 'notice.account', staff: 'notice.staff', admin: 'notice.admin' };

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
  const lang = useSyncExternalStore(subscribeLang, getLang); // re-render the whole site when the language changes
  const [compact, setCompact] = useState(false);              // header menu folded into the Menu button
  const headerInner = useRef(null);
  const needWidth = useRef(0);

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

  // One chat connection per logged-in account (customer chat or the admin inbox).
  const chatKey = me ? me.account_id + ':' + me.role + ':' + me.active : '';
  useEffect(() => {
    if (me) startChat(me); else stopChat();
    return undefined;
  }, [chatKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chat = useSyncExternalStore(subscribeChat, getChat);

  // Logged-in users have no business on the login / sign-up pages.
  useEffect(() => {
    if (me && (view === 'login' || view === 'register')) go(homeFor(me));
  }, [me, view]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (mainH1.current) mainH1.current.focus({ preventScroll: true });
  }, [view, needsLogin, forbidden]);

  function afterAuth(account, isNew) {
    toast(t(isNew ? 'toast.welcomeNew' : 'toast.welcomeBack', { name: account.first_name }));
    const target = returnTo && canOpen(returnTo, account) ? returnTo : homeFor(account);
    setReturnTo('');
    go(target);
  }

  function doLogout() {
    logout();
    toast(t('toast.loggedOut'), 'info');
    setReturnTo('');
    go('home');
  }

  /* "Book" under an AI assistant answer: fill in the search and pick one room of that type. */
  function pickFromAssistant(s) {
    setSearch({ ci: s.check_in, co: s.check_out, guests: s.guests });
    setSel({ [s.room_type_id]: 1 });
    go('book');
  }

  const navCurrent = view === 'checkout' || view === 'confirm' ? 'book' : view === 'forgot' || view === 'reset' ? 'login' : view;

  function navBtn(name, label, count) {
    return (
      <button type="button" className="nav-btn" aria-current={navCurrent === name ? 'page' : undefined} onClick={() => go(name)}>
        {label}
        {count > 0 && <span className="chat-badge static" aria-label={t('nav.unreadChat', { n: count })}>{count}</span>}
      </button>
    );
  }

  function renderView() {
    const h = mainH1;
    if (checking || (!data.loaded && !data.error)) {
      return <div className="gate"><h1 tabIndex={-1} ref={h}>{t('common.loading')}</h1></div>;
    }
    if (!data.loaded) {
      return (
        <div className="gate">
          <h1 tabIndex={-1} ref={h}>{t('gate.serverDown')}</h1>
          <p className="lead">{data.error}</p>
          <p className="muted">{t('gate.startIt')} <code>cd backend && python3 manage.py runserver</code></p>
          <div className="actions"><button type="button" className="btn btn-primary" onClick={() => reloadDb()}>{t('common.tryAgain')}</button></div>
        </div>
      );
    }
    if (needsLogin) return <LoginPage key="guard-login" headingRef={h} notice={t(NOTICE[view])} onLoggedIn={afterAuth} onGo={go} />;
    if (forbidden) return <Forbidden headingRef={h} me={me} needed={ACCESS[view]} onHome={() => go(homeFor(me))} onLogout={doLogout} />;

    switch (view) {
      case 'home':
        return (
          <HomePage headingRef={h} me={me} search={search} onDetails={setDetailsType} onGo={go}
            onSearch={(s) => { setSearch(s); setSel({}); go('book'); }} />
        );
      case 'book':
        return (
          <BookPage key={search.ci + search.co + search.guests} headingRef={h} loggedIn={!!me} search={search} setSearch={setSearch} sel={sel} setSel={setSel}
            onContinue={() => go('checkout')} onDetails={setDetailsType} />
        );
      case 'checkout':
        if (!Object.values(sel).some(Boolean)) {
          return (
            <div className="gate">
              <h1 tabIndex={-1} ref={h}>{t('gate.noRooms')}</h1>
              <p className="lead">{t('gate.noRoomsText')}</p>
              <div className="actions"><button type="button" className="btn btn-primary" onClick={() => go('book')}>{t('gate.chooseRooms')}</button></div>
            </div>
          );
        }
        return (
          <CheckoutPage headingRef={h} me={me} search={search} sel={sel} onBack={() => go('book')}
            onPaid={(result, email) => {
              setConfirmResult({ result, email });
              setSel({});
              toast(t('toast.booked', { ref: ref(result.bookingId) }));
              go('confirm');
            }} />
        );
      case 'confirm':
        if (!confirmResult) {
          return (
            <div className="gate">
              <h1 tabIndex={-1} ref={h}>{t('gate.nothingToConfirm')}</h1>
              <p className="lead">{t('gate.nothingText')}</p>
              <div className="actions"><button type="button" className="btn btn-primary" onClick={() => go('account')}>{t('acc.tab.bookings')}</button></div>
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

  /* Fold the header menu into the Menu button when it does not fit on one line (longer Russian /
     Kazakh labels, the staff and admin menus). Measured before the browser paints, so nothing jumps. */
  const headerKey = lang + '|' + (me ? me.role + me.first_name : '-') + '|' + chat.unreadTotal;
  useLayoutEffect(() => { needWidth.current = 0; setCompact(false); }, [headerKey]);
  useLayoutEffect(() => {
    const el = headerInner.current;
    if (!compact && el && el.scrollWidth > el.clientWidth + 1) {
      needWidth.current = el.scrollWidth;
      setCompact(true);
    }
  });
  useEffect(() => {
    function onResize() {
      const el = headerInner.current;
      if (compact && el && needWidth.current && el.clientWidth >= needWidth.current) setCompact(false);
      if (!compact && el && el.scrollWidth > el.clientWidth + 1) { needWidth.current = el.scrollWidth; setCompact(true); }
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [compact]);

  return (
    <>
      <header className={'site-header' + (isStaff ? ' site-header-staff' : '') + (compact ? ' compact' : '')}>
        <div className="header-inner" ref={headerInner}>
          <a className="brand" href="#home" onClick={(e) => { e.preventDefault(); go('home'); }}>
            Juniper Court
            {isStaff && <span className="brand-tag">{t(isAdmin ? 'nav.tagAdmin' : 'nav.tagStaff')}</span>}
          </a>

          <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>
            {t('nav.menu')}
          </button>

          <nav id="main-nav" aria-label={t('nav.main')} className={menuOpen ? 'open' : ''}>
            <div className="nav-group">
              {navBtn('home', t('nav.home'))}
              {navBtn('book', t('nav.book'))}
              {navBtn('about', t('nav.about'))}
              {me && navBtn('account', t('nav.account'))}
              {isStaff && navBtn('staff', t('nav.staff'))}
              {isAdmin && navBtn('admin', t('nav.admin'), chat.unreadTotal)}
            </div>

            <div className="nav-group nav-user">
              <LangSwitch />
              <button type="button" className="theme-btn" onClick={toggleTheme}
                aria-label={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
                title={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}>
                <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
                <span className="theme-btn-text" aria-hidden="true">{t(theme === 'dark' ? 'theme.light' : 'theme.dark')}</span>
              </button>
              {me ? (
                <>
                  <span className="user-pill" title={me.email}>
                    <Avatar person={me} size="sm" />
                    <span className="user-pill-text">
                      {me.first_name}
                      <small>{t('role.' + me.role)}</small>
                    </span>
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={doLogout}>{t('nav.logout')}</button>
                </>
              ) : (
                <>
                  {navBtn('login', t('nav.login'))}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => go('register')}>{t('nav.signup')}</button>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>

      {data.loaded && data.error && (
        <p className="net-banner" role="alert">{t('net.lost')} {data.error} <button type="button" className="link-btn" onClick={() => reloadDb()}>{t('net.retry')}</button></p>
      )}

      <main id="main" className={view === 'home' && !needsLogin ? 'main-home' : ''}>
        {renderView()}
      </main>

      <footer className="site-footer">
        <p>{t('footer.address')}</p>
        <p>{t('footer.note')}</p>
      </footer>

      {detailsType != null && (
        <RoomDetailsModal typeId={detailsType} onClose={() => setDetailsType(null)} />
      )}

      {ready && data.loaded && <ChatWidget me={me} onGo={go} onPick={pickFromAssistant} />}
      <Toaster />
    </>
  );
}
