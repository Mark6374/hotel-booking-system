import { useSyncExternalStore } from 'react';
import { subscribeToasts, getToasts, dismissToast } from '../toast.js';

const ICON = { success: '✓', error: '!', info: 'i' };

export default function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind}>
          <span className="toast-icon" aria-hidden="true">{ICON[t.kind] || ICON.info}</span>
          <span className="toast-text">{t.message}</span>
          <button type="button" className="toast-close" aria-label="Close notification" onClick={() => dismissToast(t.id)}>&times;</button>
        </div>
      ))}
    </div>
  );
}
