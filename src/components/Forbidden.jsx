import { ROLE_LABEL } from '../auth.js';

export default function Forbidden({ headingRef, me, needed, onHome, onLogout }) {
  const names = needed.map((r) => ROLE_LABEL[r].toLowerCase()).join(' or ');
  return (
    <div className="gate">
      <p className="gate-code">403</p>
      <h1 tabIndex={-1} ref={headingRef}>This page is not for your account</h1>
      <p className="lead">
        You are logged in as <strong>{me.email}</strong> ({ROLE_LABEL[me.role]}). This page is only for {names} accounts. Log out and log in with another account, or go back to your own page.
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onHome}>Go to my page</button>
        <button type="button" className="btn btn-ghost" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
