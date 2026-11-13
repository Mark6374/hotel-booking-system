import { useState } from 'react';

/* Password field with a show/hide toggle. */
export default function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        type={shown ? 'text' : 'password'}
        id={id}
        autoComplete={autoComplete}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="pw-toggle"
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown(!shown)}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
