import { useState } from 'react';
import { register, passwordProblem, passwordScore, EMAIL_RE, PHONE_RE, PHONE_MESSAGE } from '../auth.js';
import PasswordInput from '../components/PasswordInput.jsx';

const STRENGTH = ['Too weak', 'Weak', 'Okay', 'Good', 'Strong'];
const ORDER = ['first_name', 'last_name', 'email', 'phone', 'password', 'password2', 'terms'];

export default function RegisterPage({ headingRef, onRegistered, onGo }) {
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '', password2: '', terms: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(name, value) { setF((prev) => ({ ...prev, [name]: value })); }

  function validate() {
    const e = {};
    if (!f.first_name.trim()) e.first_name = 'Enter your first name.';
    if (!f.last_name.trim()) e.last_name = 'Enter your last name.';
    if (!f.email.trim()) e.email = 'Enter your email.';
    else if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter an email like name@example.com.';
    if (!f.phone.trim()) e.phone = 'Enter your phone number.';
    else if (!PHONE_RE.test(f.phone.trim())) e.phone = PHONE_MESSAGE;
    const pw = passwordProblem(f.password);
    if (pw) e.password = pw;
    if (!f.password2) e.password2 = 'Repeat your password.';
    else if (f.password2 !== f.password) e.password2 = 'The passwords do not match.';
    if (!f.terms) e.terms = 'Accept the terms to create an account.';
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
          <h1 id="register-title" tabIndex={-1} ref={headingRef}>Create an account</h1>
          <p className="muted">It takes a minute. Your details are filled in for you at checkout.</p>
        </div>

        <form className="auth-form" noValidate onSubmit={submit}>
          <div className="row-2">
            {textField('first_name', 'First name', 'text', 'given-name', 50)}
            {textField('last_name', 'Last name', 'text', 'family-name', 50)}
          </div>
          <div className="row-2">
            {textField('email', 'Email', 'email', 'email', 100)}
            {textField('phone', 'Phone', 'tel', 'tel', 20)}
          </div>

          <div className="field">
            <label htmlFor="reg-password">Password</label>
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
              At least 8 characters with a letter and a digit.{f.password ? ` Strength: ${STRENGTH[score]}.` : ''}
            </p>
            <p className="field-error" id="reg-password-error">{errors.password || ''}</p>
          </div>

          <div className="field">
            <label htmlFor="reg-password2">Repeat password</label>
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
              I agree to the hotel terms and the privacy policy
            </label>
            <p className="field-error" id="reg-terms-error">{errors.terms || ''}</p>
          </div>

          {formError && <p className="tx-box tx-fail" role="alert">{formError}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{' '}
          <button type="button" className="link-btn" onClick={() => onGo('login')}>Log in</button>
        </p>
      </div>
    </div>
  );
}
