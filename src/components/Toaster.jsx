import { useSyncExternalStore } from 'react';
import { subscribeToasts, getToasts, dismissToast } from '../toast.js';
import { t } from '../i18n/index.js';

const ICON = { success: '✓', error: '!', info: 'i' };

export default function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className={'toast toast-' + it.kind}>
          <span className="toast-icon" aria-hidden="true">{ICON[it.kind] || ICON.info}</span>
          <span className="toast-text">{it.message}</span>
          <button type="button" className="toast-close" aria-label={t('toast.close')} onClick={() => dismissToast(it.id)}>&times;</button>
        </div>
      ))}
    </div>
  );
}
