import { useState } from 'react';
import { requestPasswordReset, confirmPasswordReset, passwordProblem, EMAIL_RE } from '../auth.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { toast } from '../toast.js';
import { t } from '../i18n/index.js';

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
    if (!email.trim()) { setError(t('v.emailRequired')); return; }
    if (!EMAIL_RE.test(email.trim())) { setError(t('v.email')); return; }
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
          <h1 tabIndex={-1} ref={headingRef}>{t('reset.checkEmail')}</h1>
          <p className="muted">{t('reset.sent')}</p>
        </div>
        {demoLink && (
          <div className="note demo-reset">
            <p><strong>{t('reset.demo')}</strong> {t('reset.demoText')}</p>
            <p><a className="btn btn-primary btn-sm" href={demoLink}>{t('reset.openLink')}</a></p>
          </div>
        )}
        <p className="auth-switch">
          <button type="button" className="link-btn" onClick={() => onGo('login')}>{t('reset.back')}</button>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="auth-head">
        <h1 tabIndex={-1} ref={headingRef}>{t('reset.title')}</h1>
        <p className="muted">{t('reset.lead')}</p>
      </div>
      <form className="auth-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="reset-email">{t('f.email')}</label>
          <input type="email" id="reset-email" autoComplete="username"
            aria-describedby="reset-email-error" aria-invalid={error ? 'true' : undefined}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="field-error" id="reset-email-error">{error}</p>
        </div>
        {formError && <p className="tx-box tx-fail" role="alert">{formError}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {t(busy ? 'reset.sending' : 'reset.send')}
        </button>
      </form>
      <p className="auth-switch">
        {t('reset.remembered')}{' '}
        <button type="button" className="link-btn" onClick={() => onGo('login')}>{t('reset.back')}</button>
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
    if (pw2 !== pw) errs.pw2 = t('v.pwMatch');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await confirmPasswordReset(token, pw);
      setDone(true);
      toast(t('reset.toast'));
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
          <h1 tabIndex={-1} ref={headingRef}>{t('reset.done')}</h1>
          <p className="muted">{t('reset.doneText')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => onGo('login')}>{t('nav.login')}</button>
      </>
    );
  }

  return (
    <>
      <div className="auth-head">
        <h1 tabIndex={-1} ref={headingRef}>{t('reset.newTitle')}</h1>
        <p className="muted">{t('pw.rule')}</p>
      </div>
      <form className="auth-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-pw">{t('f.newPassword')}</label>
          <PasswordInput id="new-pw" autoComplete="new-password" value={pw} onChange={setPw}
            invalid={!!errors.pw} describedBy="new-pw-error" />
          <p className="field-error" id="new-pw-error">{errors.pw || ''}</p>
        </div>
        <div className="field">
          <label htmlFor="new-pw2">{t('f.newPassword2')}</label>
          <PasswordInput id="new-pw2" autoComplete="new-password" value={pw2} onChange={setPw2}
            invalid={!!errors.pw2} describedBy="new-pw2-error" />
          <p className="field-error" id="new-pw2-error">{errors.pw2 || ''}</p>
        </div>
        {formError && (
          <div className="tx-box tx-fail" role="alert">
            {formError}{' '}
            <button type="button" className="link-btn" onClick={() => onGo('forgot')}>{t('reset.newLink')}</button>
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {t(busy ? 'common.saving' : 'reset.save')}
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
