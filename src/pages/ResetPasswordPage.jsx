import { useState } from 'react';
import { requestPasswordReset, confirmPasswordReset, passwordProblem, EMAIL_RE } from '../auth.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { toast } from '../toast.js';

/* Two steps of "Forgot password":
   #forgot              – enter your email, the server emails a link
   #reset?token=...     – the link from the email: choose a new password */

function RequestForm({ headingRef, onGo }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Enter an email like name@example.com.'); return; }
    setError('');
    setBusy(true);
    try {
      setSent(await requestPasswordReset(email));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    const demoLink = sent.debug_token ? '#reset?token=' + encodeURIComponent(sent.debug_token) : '';
    return (
      <>
        <div className="auth-head">
          <h1 tabIndex={-1} ref={headingRef}>Check your email</h1>
          <p className="muted">{sent.detail}</p>
        </div>
        {demoLink && (
          <div className="note demo-reset">
            <p><strong>Demo mode:</strong> the project has no mail server, so the email is printed in the Django terminal. You can also open the link here:</p>
            <p><a className="btn btn-primary btn-sm" href={demoLink}>Open reset link</a></p>
          </div>
        )}
        <p className="auth-switch">
          <button type="button" className="link-btn" onClick={() => onGo('login')}>Back to log in</button>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="auth-head">
        <h1 tabIndex={-1} ref={headingRef}>Reset password</h1>
        <p className="muted">Enter the email you signed up with. We will send you a link to choose a new password.</p>
      </div>
      <form className="auth-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="reset-email">Email</label>
          <input type="email" id="reset-email" autoComplete="username"
            aria-describedby="reset-email-error" aria-invalid={error ? 'true' : undefined}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="field-error" id="reset-email-error">{error}</p>
        </div>
        {formError && <p className="tx-box tx-fail" role="alert">{formError}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="auth-switch">
        Remembered it?{' '}
        <button type="button" className="link-btn" onClick={() => onGo('login')}>Back to log in</button>
      </p>
    </>
  );
}

function NewPasswordForm({ headingRef, token, onGo }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const errs = {};
    const p = passwordProblem(pw);
    if (p) errs.pw = p;
    if (pw2 !== pw) errs.pw2 = 'The passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await confirmPasswordReset(token, pw);
      setDone(true);
      toast('Password changed. You can log in now.');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <div className="auth-head">
          <h1 tabIndex={-1} ref={headingRef}>Password changed</h1>
          <p className="muted">You can now log in with your new password.</p>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => onGo('login')}>Log in</button>
      </>
    );
  }

  return (
    <>
      <div className="auth-head">
        <h1 tabIndex={-1} ref={headingRef}>Choose a new password</h1>
        <p className="muted">At least 8 characters, with a letter and a digit.</p>
      </div>
      <form className="auth-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-pw">New password</label>
          <PasswordInput id="new-pw" autoComplete="new-password" value={pw} onChange={setPw}
            invalid={!!errors.pw} describedBy="new-pw-error" />
          <p className="field-error" id="new-pw-error">{errors.pw || ''}</p>
        </div>
        <div className="field">
          <label htmlFor="new-pw2">Repeat new password</label>
          <PasswordInput id="new-pw2" autoComplete="new-password" value={pw2} onChange={setPw2}
            invalid={!!errors.pw2} describedBy="new-pw2-error" />
          <p className="field-error" id="new-pw2-error">{errors.pw2 || ''}</p>
        </div>
        {formError && (
          <div className="tx-box tx-fail" role="alert">
            {formError}{' '}
            <button type="button" className="link-btn" onClick={() => onGo('forgot')}>Get a new link</button>
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage({ headingRef, token, onGo }) {
  return (
    <div className="auth-layout auth-layout-single">
      <div className="auth-card">
        {token
          ? <NewPasswordForm key={token} headingRef={headingRef} token={token} onGo={onGo} />
          : <RequestForm headingRef={headingRef} onGo={onGo} />}
      </div>
    </div>
  );
}
