import { t, has } from '../i18n/index.js';

export default function StatusBadge({ status }) {
  const cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' || status === 'Published' ? 'good'
    : status === 'Cancelled' || status === 'Failed' || status === 'Hidden' ? 'bad'
    : status === 'Refunded' || status === 'Pending' ? 'warn' : '';
  const label = has('status.' + status) ? t('status.' + status) : status;
  return <span className={'badge ' + cls}>{label}</span>;
}
