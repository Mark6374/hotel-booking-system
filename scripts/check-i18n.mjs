// Checks the translations: every key used in src/ exists in en, ru and kk,
// and every language has the same keys (and the same {placeholders}).
// Run: node scripts/check-i18n.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NS = ['common', 'nav', 'theme', 'lang', 'toast', 'gate', 'notice', 'net', 'footer', 'home', 'search', 'room', 'price',
  'book', 'sum', 'n', 'pay', 'v', 'f', 'method', 'log', 'confirm', 'bk', 'forbidden', 'pw', 'about', 'hotel', 'map', 'stars',
  'reg', 'reset', 'login', 'acc', 'photo', 'rev', 'staff', 'th', 'admin', 'mod', 'chat', 'cal', 'status', 'role', 'srv',
  'roomType', 'roomDesc', 'meta'];
const keyRe = new RegExp(`'((?:${NS.join('|')})\\.[A-Za-z0-9_.]+)'(?!\\s*\\+)`, 'g');

// keys built at run time: 'status.' + x and so on
const DYNAMIC = [
  'home.f1.title', 'home.f1.text', 'home.f2.title', 'home.f2.text', 'home.f3.title', 'home.f3.text',
  ...['Confirmed', 'CheckedIn', 'Completed', 'Cancelled', 'Paid', 'Refunded', 'Failed', 'Pending', 'Published', 'Hidden', 'Available', 'Maintenance'].map((s) => 'status.' + s),
  'role.guest', 'role.staff', 'role.admin', 'method.Card', 'method.Cash', 'method.Transfer',
  'roomType.Standard', 'roomType.Deluxe', 'roomType.Suite', 'roomDesc.Standard', 'roomDesc.Deluxe', 'roomDesc.Suite'
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : walk(p);
    return /\.(js|jsx)$/.test(e.name) ? [p] : [];
  });
}

const used = new Set(DYNAMIC);
for (const file of walk(root)) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(keyRe)) used.add(m[1]);
}
// keys used by the server-message table in i18n/index.js
for (const m of fs.readFileSync(path.join(root, 'i18n', 'index.js'), 'utf8').matchAll(keyRe)) used.add(m[1]);

const dicts = {};
for (const lang of ['en', 'ru', 'kk']) dicts[lang] = (await import(path.join(root, 'i18n', lang + '.js'))).default;

const vars = (v) => JSON.stringify(v).match(/\{\w+\}/g)?.sort().filter((x, i, a) => a.indexOf(x) === i).join(',') || '';
let problems = 0;
for (const key of [...used].sort()) {
  for (const lang of Object.keys(dicts)) {
    if (dicts[lang][key] === undefined) { console.log(`missing  ${lang}  ${key}`); problems++; }
  }
}
for (const lang of ['ru', 'kk']) {
  for (const key of Object.keys(dicts.en)) {
    if (dicts[lang][key] !== undefined && vars(dicts[lang][key]) !== vars(dicts.en[key])) {
      console.log(`placeholders differ  ${lang}  ${key}: en ${vars(dicts.en[key])} / ${lang} ${vars(dicts[lang][key])}`);
      problems++;
    }
  }
  for (const key of Object.keys(dicts[lang])) if (dicts.en[key] === undefined) { console.log(`extra  ${lang}  ${key}`); problems++; }
}
const unused = Object.keys(dicts.en).filter((k) => !used.has(k));
if (unused.length) console.log('unused in code (fine, but check):', unused.join(', '));
console.log(`${used.size} keys used, ${Object.keys(dicts.en).length} in en, ${problems} problem(s).`);
process.exit(problems ? 1 : 0);
