export default function StatusBadge({ status }) {
  const cls = status === 'Confirmed' || status === 'CheckedIn' || status === 'Paid' ? 'good'
    : status === 'Cancelled' || status === 'Failed' ? 'bad'
    : status === 'Refunded' ? 'warn' : '';
  const label = status === 'CheckedIn' ? 'Checked in' : status;
  return <span className={'badge ' + cls}>{label}</span>;
}
