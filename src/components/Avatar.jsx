import { useState } from 'react';
import { mediaUrl } from '../api.js';

/* Profile photo, or the initials when there is no photo (or it fails to load). */
export default function Avatar({ person, size = '', className = '' }) {
  const [broken, setBroken] = useState('');
  const url = person && person.photo_url;
  const first = (person && person.first_name) || '';
  const last = (person && person.last_name) || '';
  const cls = ['avatar', size && 'avatar-' + size, className].filter(Boolean).join(' ');
  if (url && broken !== url) {
    return <img className={cls + ' avatar-img'} src={mediaUrl(url)} alt="" aria-hidden="true" onError={() => setBroken(url)} />;
  }
  return <span className={cls} aria-hidden="true">{(first[0] || '?').toUpperCase()}{(last[0] || '').toUpperCase()}</span>;
}
