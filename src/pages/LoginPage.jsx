import { useState } from 'react';

export default function LoginPage({ headingRef, onLogin }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  function submit(e) {
    e.preventDefault();
    const v = email.trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError('Enter an email like name@example.com.');
      return;
    }
    onLogin(v);
  }

  return (
    <>
      <div className="page-head">
        <h1 id="login-title" tabIndex={-1} ref={headingRef}>Log in</h1>
        <p className="lead">
          This prototype has no passwords: enter the email you book with and we remember it on this device, so
          My bookings opens straight to your bookings next time. Try <strong>amina@example.com</strong>.
        </p>
      </div>

      <form className="login-card" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            type="email"
            id="login-email"
            autoComplete="email"
            aria-describedby="login-error"
            aria-invalid={error ? 'true' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="field-error" id="login-error">{error}</p>
        </div>
        <button type="submit" className="btn btn-primary">Log in</button>
      </form>
    </>
  );
}
