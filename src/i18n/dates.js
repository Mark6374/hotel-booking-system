/* Dates in the chosen language. English and Russian use the browser's Intl;
   Kazakh is written out here, because browsers often have no Kazakh month or weekday
   names (Chrome prints "M12" and "Mon"). All calendar dates are ISO 'YYYY-MM-DD' in UTC. */

import { getLang, locale } from './index.js';

const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const KK_MONTHS_SHORT = ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'];
const KK_DAYS = ['дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі', 'жексенбі'];   // Monday first
const KK_DAYS_SHORT = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс'];

const utc = (iso) => new Date(iso + 'T00:00:00Z');
const kk = () => getLang() === 'kk';
const pad = (n) => (n < 10 ? '0' : '') + n;
const mondayIndex = (d) => (d.getUTCDay() + 6) % 7;

/* 10 Dec 2026 / 10 дек. 2026 г. / 10 жел. 2026 */
export function dateShort(iso) {
  const d = utc(iso);
  if (kk()) return d.getUTCDate() + ' ' + KK_MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/* December 2026 / декабрь 2026 г. / желтоқсан 2026 */
export function monthYear(iso) {
  const d = utc(iso);
  if (kk()) return KK_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/* Thursday 10 December / четверг, 10 декабря / бейсенбі, 10 желтоқсан */
export function dayLong(iso) {
  const d = utc(iso);
  if (kk()) return KK_DAYS[mondayIndex(d)] + ', ' + d.getUTCDate() + ' ' + KK_MONTHS[d.getUTCMonth()];
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

/* Short weekday names, Monday first */
export function weekdaysShort() {
  if (kk()) return KK_DAYS_SHORT;
  const f = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  return [0, 1, 2, 3, 4, 5, 6].map((i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));   // 1 Jan 2024 was a Monday
}

/* Chat time in the viewer's time zone: "14:05" today, "10 Dec, 14:05" on other days */
export function chatTime(dateLike) {
  const d = new Date(dateLike);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (kk()) {
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return sameDay ? hm : d.getDate() + ' ' + KK_MONTHS_SHORT[d.getMonth()] + ', ' + hm;
  }
  return new Intl.DateTimeFormat(locale(), sameDay ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/* Inbox list: time today, otherwise day and month */
export function inboxTime(dateLike) {
  const d = new Date(dateLike);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (kk()) return sameDay ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : d.getDate() + ' ' + KK_MONTHS_SHORT[d.getMonth()];
  return new Intl.DateTimeFormat(locale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
}
