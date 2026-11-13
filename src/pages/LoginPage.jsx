import { useState } from 'react';
import { login, DEMO_ACCOUNTS, ROLE_LABEL, EMAIL_RE } from '../auth.js';
import PasswordInput from '../components/PasswordInput.jsx';

export default function LoginPage({ headingRef, notice, onLoggedIn, onGo }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (!email.trim()) errs.email = 'Enter your email.';
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter an email like name@example.com.';
    if (!password) errs.password = 'Enter your password.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(errs.email ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setBusy(true);
    try {
      const me = await login(email, password, remember);
      onLoggedIn(me);
    } catch (err) {
      setFormError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  function fill(d) {
    setEmail(d.email);
    setPassword(d.password);
    setErrors({});
    setFormError('');
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-head">
          <h1 id="login-title" tabIndex={-1} ref={headingRef}>Log in</h1>
          <p className="muted">Welcome back to Juniper Court.</p>
        </div>

        {notice && <p className="note" role="status">{notice}</p>}

        <form className="auth-form" noValidate onSubmit={submit}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              type="email"
              id="login-email"
              autoComplete="username"
              aria-describedby="login-email-error"
              aria-invalid={errors.email ? 'true' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="field-error" id="login-email-error">{errors.email || ''}</p>
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="login-password">Password</label>
              <button type="button" className="link-btn" onClick={() => onGo('forgot')}>Forgot password?</button>
            </div>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              invalid={!!errors.password}
              describedBy="login-password-error"
            />
            <p className="field-error" id="login-password-error">{errors.password || ''}</p>
          </div>

          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me logged in on this device
          </label>

          {formError && <p className="tx-box tx-fail" role="alert">{formError}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          New here?{' '}
          <button type="button" className="link-btn" onClick={() => onGo('register')}>Create an account</button>
        </p>
      </div>

      <aside className="demo-box" aria-labelledby="demo-title">
        <h2 id="demo-title">Demo accounts</h2>
        <p className="muted">This is a prototype. Pick an account to fill the form, then press Log in.</p>
        <ul className="demo-list">
          {DEMO_ACCOUNTS.map((d) => (
            <li key={d.email}>
              <button type="button" className="demo-item" onClick={() => fill(d)}>
                <span className={'role-chip role-' + d.role}>{ROLE_LABEL[d.role]}</span>
                <span className="demo-cred">
                  <strong>{d.email}</strong>
                  <small>Password: {d.password}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
