import { useState } from 'react';
import { register, passwordProblem, passwordScore, EMAIL_RE, PHONE_RE } from '../auth.js';
import { t } from '../i18n/index.js';
import PasswordInput from '../components/PasswordInput.jsx';

const STRENGTH = ['pw.s0', 'pw.s1', 'pw.s2', 'pw.s3', 'pw.s4'];
const ORDER = ['first_name', 'last_name', 'email', 'phone', 'password', 'password2', 'terms'];

export default function RegisterPage({ headingRef, onRegistered, onGo }) {
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '', password2: '', terms: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(name, value) { setF((prev) => ({ ...prev, [name]: value })); }

  function validate() {
    const e = {};
    if (!f.first_name.trim()) e.first_name = t('v.firstName');
    if (!f.last_name.trim()) e.last_name = t('v.lastName');
    if (!f.email.trim()) e.email = t('v.emailRequired');
    else if (!EMAIL_RE.test(f.email.trim())) e.email = t('v.email');
    if (!f.phone.trim()) e.phone = t('v.phoneRequired');
    else if (!PHONE_RE.test(f.phone.trim())) e.phone = t('v.phone');
    const pw = passwordProblem(f.password);
    if (pw) e.password = pw;
    if (!f.password2) e.password2 = t('v.pwRepeat');
    else if (f.password2 !== f.password) e.password2 = t('v.pwMatch');
    if (!f.terms) e.terms = t('v.terms');
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    setFormError('');
    const e = validate();
    setErrors(e);
    const first = ORDER.find((k) => e[k]);
    if (first) {
      document.getElementById('reg-' + first)?.focus();
      return;
    }
    setBusy(true);
    try {
      const me = await register(f);
      onRegistered(me);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const score = passwordScore(f.password);

  function textField(name, label, type, autoComplete, maxLength) {
    return (
      <div className="field">
        <label htmlFor={'reg-' + name}>{label}</label>
        <input
          type={type}
          id={'reg-' + name}
          autoComplete={autoComplete}
          maxLength={maxLength}
          aria-describedby={'reg-' + name + '-error'}
          aria-invalid={errors[name] ? 'true' : undefined}
          value={f[name]}
          onChange={(e) => set(name, e.target.value)}
        />
        <p className="field-error" id={'reg-' + name + '-error'}>{errors[name] || ''}</p>
      </div>
    );
  }

  return (
    <div className="auth-layout auth-layout-single">
      <div className="auth-card auth-card-wide">
        <div className="auth-head">
          <h1 id="register-title" tabIndex={-1} ref={headingRef}>{t('reg.title')}</h1>
          <p className="muted">{t('reg.lead')}</p>
        </div>

        <form className="auth-form" noValidate onSubmit={submit}>
          <div className="row-2">
            {textField('first_name', t('f.firstName'), 'text', 'given-name', 50)}
            {textField('last_name', t('f.lastName'), 'text', 'family-name', 50)}
          </div>
          <div className="row-2">
            {textField('email', t('f.email'), 'email', 'email', 100)}
            {textField('phone', t('f.phone'), 'tel', 'tel', 20)}
          </div>

          <div className="field">
            <label htmlFor="reg-password">{t('f.password')}</label>
            <PasswordInput
              id="reg-password"
              autoComplete="new-password"
              value={f.password}
              onChange={(v) => set('password', v)}
              invalid={!!errors.password}
              describedBy="reg-password-hint reg-password-error"
            />
            {f.password && (
              <div className="pw-meter" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? 'on s' + score : ''}></span>)}
              </div>
            )}
            <p className="hint" id="reg-password-hint">
              {t('pw.rule')}{f.password ? ' ' + t('pw.strength', { s: t(STRENGTH[score]) }) : ''}
            </p>
            <p className="field-error" id="reg-password-error">{errors.password || ''}</p>
          </div>

          <div className="field">
            <label htmlFor="reg-password2">{t('f.password2')}</label>
            <PasswordInput
              id="reg-password2"
              autoComplete="new-password"
              value={f.password2}
              onChange={(v) => set('password2', v)}
              invalid={!!errors.password2}
              describedBy="reg-password2-error"
            />
            <p className="field-error" id="reg-password2-error">{errors.password2 || ''}</p>
          </div>

          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                id="reg-terms"
                checked={f.terms}
                aria-describedby="reg-terms-error"
                aria-invalid={errors.terms ? 'true' : undefined}
                onChange={(e) => set('terms', e.target.checked)}
              />
              {t('reg.terms')}
            </label>
            <p className="field-error" id="reg-terms-error">{errors.terms || ''}</p>
          </div>

          {formError && <p className="tx-box tx-fail" role="alert">{formError}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {t(busy ? 'reg.creating' : 'reg.create')}
          </button>
        </form>

        <p className="auth-switch">
          {t('reg.haveAccount')}{' '}
          <button type="button" className="link-btn" onClick={() => onGo('login')}>{t('nav.login')}</button>
        </p>
      </div>
    </div>
  );
}
