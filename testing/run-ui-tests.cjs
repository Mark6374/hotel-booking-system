// =====================================================================
//  HOTEL BOOKING SYSTEM  -  AUTOMATED WEBSITE TESTS (UI-01 ... UI-26)
//  Version 2: React site + Django API + MySQL, with accounts and roles
//
//  Tester : 24B032036
//  What   : opens the website in a real Chrome browser and does the steps
//           from testing/test-cases.md like a user. Prints PASS/FAIL and
//           saves a screenshot of every test to testing/screenshots/.
//
//  Before running:
//     1) MySQL with the demo data, Django on :8000
//        (cd backend && python manage.py runserver)
//     2) the website: npm run dev   (http://localhost:5173)
//     3) once: npm install --no-save playwright && npx playwright install chromium
//  Run:  node testing/run-ui-tests.cjs
//        (other address: set BASE_URL, e.g. BASE_URL=http://localhost:5174/)
//
//  Before EVERY test the demo data is restored through the admin API
//  (POST /api/admin/reset-demo/), so every test starts from the same data.
//  Logged-in tests put the account's token into the browser, the same
//  thing the site does after "Log in" with "Keep me logged in".
// =====================================================================

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173/').replace(/\/?$/, '/');
const API = BASE_URL + 'api';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const ACCOUNTS = {
  admin: { email: 'admin@junipercourt.example', password: 'Admin12345' },
  staff: { email: 'staff@junipercourt.example', password: 'Staff12345' },
  amina: { email: 'amina@example.com', password: 'demo12345' },
  daniel: { email: 'daniel@example.com', password: 'demo12345' },
};
const TOKEN_KEY = 'juniper-court-token-v2';

// ---------- API helpers (only for setup, not for the checks) ----------

const tokens = {};
async function tokenOf(who) {
  if (tokens[who]) return tokens[who];
  const r = await fetch(API + '/auth/login/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ACCOUNTS[who]),
  });
  if (!r.ok) throw new Error('cannot log in ' + who + ': HTTP ' + r.status);
  tokens[who] = (await r.json()).token;
  return tokens[who];
}

async function resetDemo() {
  const r = await fetch(API + '/admin/reset-demo/', {
    method: 'POST', headers: { Authorization: 'Bearer ' + (await tokenOf('admin')) },
  });
  if (!r.ok) throw new Error('reset-demo failed: HTTP ' + r.status);
}

// ---------- browser helpers ----------

async function openAs(browser, who) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (who) {
    const t = await tokenOf(who);
    await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, [TOKEN_KEY, t]);
  }
  const page = await context.newPage();
  return { context, page };
}

async function go(page, view) {
  // goto + reload: always load fresh data from the server (a change of the
  // #hash alone does not reload the page)
  await page.goto(BASE_URL + '#' + view);
  await page.reload();
  await page.waitForFunction(() => {
    const h = document.querySelector('main h1');
    return h && !/Loading/.test(h.textContent);
  });
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const heading = async (page) => clean(await page.locator('main h1').first().textContent());

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function plusDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

async function search(page, ci, co, guests) {
  if (ci) await page.fill('#ci', ci);
  if (co) await page.fill('#co', co);
  if (guests) await page.fill('#guests', String(guests));
  await page.click('text=Show available rooms');
}

async function freeRooms(page) {
  await go(page, 'book');
  const rows = await page.$$eval('.rt', (els) =>
    els.map((e) => e.querySelector('h3').textContent + ': ' + e.querySelector('.left').textContent));
  return rows.join(' | ');
}
const standardLeft = async (page) => (await freeRooms(page)).split(' | ')[0];

async function addRoom(page, type) { await page.click(`[aria-label="Add one ${type} room"]`); }

// Logged-in user: pick 1 Standard room and open the checkout form
async function toCheckout(page, dates) {
  await go(page, 'book');
  if (dates) await search(page, dates[0], dates[1], 2);
  await addRoom(page, 'Standard');
  await page.click('text=Continue to guest details');
  await page.waitForSelector('#card');
}

async function pay(page, card) {
  await page.fill('#card', card);
  await page.click('text=Confirm and pay');
  await page.waitForFunction(() => /Booking confirmed/.test(document.querySelector('main h1')?.textContent || '')
    || document.querySelector('.tx-fail') || document.querySelector('#err-card')?.textContent);
}

async function myBookingRefs(page) {
  await go(page, 'account');
  return page.$$eval('.booking-card .ref', (e) => e.map((x) => x.textContent));
}

async function register(page, f) {
  await go(page, 'register');
  await page.fill('#reg-first_name', f.first);
  await page.fill('#reg-last_name', f.last);
  await page.fill('#reg-email', f.email);
  await page.fill('#reg-phone', f.phone);
  await page.fill('#reg-password', f.password);
  await page.fill('#reg-password2', f.password);
  await page.check('#reg-terms');
  await page.locator('form').getByRole('button', { name: /create|sign up/i }).click();
  await page.waitForTimeout(800);
}
const NEW_USER = { first: 'Aru', last: 'Test', email: 'aru@example.com', phone: '+7 701 123 4567', password: 'Hotel2026a' };

async function staffRow(page, ref) {
  return page.locator('table tbody tr', { hasText: ref });
}

// ---------- the 26 test cases ----------
// fn(page, t) returns { actual, pass }. t.shot() saves the screenshot now,
// t.as(who) opens a second browser (who = null for a visitor without login).

const TESTS = [
  // ----- UC-01 / UC-02  Search and rooms (visitor, no login) -----
  ['UI-01', 'Booking page opens with the default search', null, async (page) => {
    await go(page, 'book');
    const v = [await page.inputValue('#ci'), await page.inputValue('#co'), await page.inputValue('#guests')];
    return { actual: `check-in ${v[0]}, check-out ${v[1]}, guests ${v[2]}`,
      pass: v[0] === '2026-12-10' && v[1] === '2026-12-13' && v[2] === '2' };
  }],

  ['UI-02', 'Free rooms are counted correctly', null, async (page) => {
    const t = await freeRooms(page);
    const plusOff = await page.isDisabled('[aria-label="Add one Deluxe room"]');
    return { actual: t + (plusOff ? ' (Deluxe + disabled)' : ' (Deluxe + ENABLED)'),
      pass: t === 'Standard: 2 of 3 left | Deluxe: Sold out for these dates | Suite: 1 of 1 left' && plusOff };
  }],

  ['UI-03', 'Check-out before check-in', null, async (page) => {
    await go(page, 'book'); await search(page, '2026-12-20', '2026-12-18');
    const e = clean(await page.textContent('.search .form-error'));
    return { actual: e, pass: e === 'Check-out must be after check-in.' };
  }],

  ['UI-04', 'Check-in in the past', null, async (page) => {
    await go(page, 'book'); await search(page, '2026-01-10', '2026-01-12');
    const e = clean(await page.textContent('.search .form-error'));
    return { actual: e, pass: e === 'Check-in cannot be in the past.' };
  }],

  ['UI-05', 'Too many guests', null, async (page) => {
    await go(page, 'book'); await search(page, null, null, 11);
    const e = clean(await page.textContent('.search .form-error'));
    return { actual: e, pass: e === 'Guests must be between 1 and 10.' };
  }],

  ['UI-06', 'Room details window', null, async (page, t) => {
    await go(page, 'book');
    await page.click('.rt:has-text("Suite") >> text=See photos and details');
    const d = clean(await page.textContent('[role=dialog]'));
    await t.shot();
    await page.locator('[role=dialog]').getByRole('button', { name: 'Close' }).last().click();
    const closed = (await page.locator('[role=dialog]').count()) === 0;
    return { actual: d.slice(0, 80) + (closed ? ' | closed' : ' | NOT closed'),
      pass: d.includes('Sleeps 4') && d.includes('$150') && closed };
  }],

  ['UI-07', 'Price is calculated', null, async (page) => {
    await go(page, 'book'); await addRoom(page, 'Standard');
    const total = clean(await page.textContent('.summary .sum-total'));
    const btn = page.locator('.summary .btn-primary');
    return { actual: `Total ${total}, button "${clean(await btn.textContent())}" ${(await btn.isDisabled()) ? 'disabled' : 'active'}`,
      pass: total === '$180' && !(await btn.isDisabled()) };
  }],

  ['UI-08', 'Rooms too small for the group', null, async (page) => {
    await go(page, 'book'); await search(page, null, null, 4); await addRoom(page, 'Standard');
    const note = clean(await page.textContent('.summary .note'));
    const disabled = await page.locator('.summary .btn-primary').isDisabled();
    return { actual: note.slice(0, 60) + '… | button ' + (disabled ? 'disabled' : 'ACTIVE'),
      pass: note.startsWith('These rooms sleep 2, but you are booking for 4') && disabled };
  }],

  // ----- UC-04  Account: sign up and log in -----
  ['UI-09', 'Sign up with valid data', null, async (page) => {
    await register(page, NEW_USER);
    const h = await heading(page);
    const nav = clean(await page.textContent('nav'));
    return { actual: `page "${h}", header: ${nav.includes('Log out') ? 'logged in' : 'NOT logged in'}`,
      pass: h === 'Aru Test' && nav.includes('Log out') };
  }],

  ['UI-10', 'Sign up with an email that already exists', null, async (page) => {
    await register(page, { ...NEW_USER, email: 'AMINA@EXAMPLE.COM' });
    const body = clean(await page.textContent('main'));
    const ok = body.includes('An account with this email already exists.');
    return { actual: ok ? '"An account with this email already exists."' : 'no error, page: ' + (await heading(page)), pass: ok };
  }],

  ['UI-11', 'Sign up with a password of only digits', null, async (page) => {
    await register(page, { ...NEW_USER, password: '12345678' });
    const e = clean(await page.textContent('#reg-password-error'));
    const stillHere = (await heading(page)) === 'Create an account';
    return { actual: e || 'no error', pass: e.length > 0 && stillHere };
  }],

  ['UI-12', 'Sign up with a phone without digits', null, async (page) => {
    await register(page, { ...NEW_USER, phone: '((((((' });
    const h = await heading(page);
    const e = h === 'Create an account' ? clean(await page.textContent('#reg-phone-error').catch(() => '')) : '';
    return { actual: h === 'Create an account' ? 'refused: ' + e : `account CREATED with phone "((((((" (page "${h}")`,
      pass: h === 'Create an account' && e.length > 0 };
  }],

  ['UI-13', 'Log in with a wrong password', null, async (page) => {
    await go(page, 'login');
    await page.fill('#login-email', 'amina@example.com');
    await page.fill('#login-password', 'wrongpass1');
    await page.locator('form.auth-form').getByRole('button', { name: 'Log in' }).click();
    await page.waitForSelector('.tx-fail');
    const e = clean(await page.textContent('.tx-fail'));
    return { actual: e, pass: e === 'Invalid email or password.' };
  }],

  ['UI-14', 'Log in and see my bookings', null, async (page) => {
    await go(page, 'login');
    await page.fill('#login-email', 'amina@example.com');
    await page.fill('#login-password', 'demo12345');
    await page.locator('form.auth-form').getByRole('button', { name: 'Log in' }).click();
    await page.waitForFunction(() => /Amina/.test(document.querySelector('main h1')?.textContent || ''));
    const refs = (await page.$$eval('.booking-card .ref', (e) => e.map((x) => x.textContent))).sort().join(',');
    return { actual: `page "${await heading(page)}", bookings ${refs}`, pass: refs === 'HB-0001,HB-0003' };
  }],

  // ----- UC-03  Book rooms and pay -----
  ['UI-15', 'Booking needs an account (rooms are kept)', null, async (page, t) => {
    await go(page, 'book'); await addRoom(page, 'Standard');
    await page.click('text=Log in to continue');
    await page.waitForSelector('#login-email');
    const notice = clean(await page.textContent('main .note'));
    await t.shot();
    await page.fill('#login-email', 'amina@example.com');
    await page.fill('#login-password', 'demo12345');
    await page.locator('form.auth-form').getByRole('button', { name: 'Log in' }).click();
    await page.waitForSelector('#card');
    const sum = clean(await page.textContent('.summary'));
    return { actual: `"${notice}" → after login: ${await heading(page)}, ${sum.includes('1 × Standard') ? '1 × Standard kept' : 'rooms LOST'}`,
      pass: notice.startsWith('Log in or create an account to finish your booking') && sum.includes('1 × Standard') };
  }],

  ['UI-16', 'Short card number', 'amina', async (page) => {
    await toCheckout(page); await pay(page, '4242 4242 4242 424');
    const e = clean(await page.textContent('#err-card'));
    return { actual: e, pass: e === 'Enter a 16-digit card number.' };
  }],

  ['UI-17', 'Successful booking (main process)', 'amina', async (page, t) => {
    await toCheckout(page); await pay(page, '4242 4242 4242 4242');
    const card = clean(await page.textContent('.confirm-card'));
    await t.shot();
    const after = await standardLeft(page);
    const ok = card.includes('HB-0006') && card.includes('102 (Standard)') && card.includes('$180') && card.includes('COMMIT');
    return { actual: `${card.slice(0, 70)}… | then ${after}`, pass: ok && after === 'Standard: 1 of 3 left' };
  }],

  ['UI-18', 'Card declined → rollback', 'amina', async (page, t) => {
    await toCheckout(page); await pay(page, '4242 4242 4242 0000');
    const box = clean(await page.textContent('.tx-fail'));
    await t.shot();
    const after = await standardLeft(page);
    const ok = box.includes('The bank declined this card.') && box.includes('ROLLBACK');
    return { actual: `"The bank declined this card.", ROLLBACK: ${ok ? 'yes' : 'NO'} | then ${after}`,
      pass: ok && after === 'Standard: 2 of 3 left' };
  }],

  ['UI-19', 'A booking is visible in another browser (real database)', 'amina', async (page, t) => {
    await toCheckout(page); await pay(page, '4242 4242 4242 4242');
    const other = await t.as(null);
    const seen = await standardLeft(other);
    await other.screenshot({ path: path.join(SHOTS, 'UI-19.png') }); t.shotTaken = true;
    return { actual: `second browser (no login): ${seen}`, pass: seen === 'Standard: 1 of 3 left' };
  }],

  // ----- UC-05 / UC-06  My bookings, cancel -----
  ['UI-20', 'Cancel my booking', 'amina', async (page, t) => {
    await go(page, 'account');
    await page.click('text=Cancel booking HB-0001');
    await page.waitForFunction(() => /cancelled/.test(document.querySelector('main .status')?.textContent || ''));
    const status = clean(await page.textContent('main .status'));
    await t.shot();
    const after = await standardLeft(page);
    return { actual: `${status} | then ${after}`,
      pass: status === 'Booking HB-0001 cancelled. The payment is marked as refunded.' && after === 'Standard: 3 of 3 left' };
  }],

  ['UI-21', "A guest sees only her own bookings", 'daniel', async (page) => {
    const refs = (await myBookingRefs(page)).sort().join(',');
    return { actual: `Daniel sees ${refs || 'nothing'}`, pass: refs === 'HB-0002,HB-0005' };
  }],

  // ----- UC-07 / UC-08  Front desk (staff) -----
  ['UI-22', 'Front desk is closed to visitors and guests', 'amina', async (page, t) => {
    await go(page, 'staff');
    const asGuest = await heading(page);
    await t.shot();
    const visitor = await t.as(null);
    await go(visitor, 'staff');
    const note = clean(await visitor.textContent('main .note').catch(() => ''));
    return { actual: `guest: "${asGuest}"; visitor: "${note}"`,
      pass: asGuest === 'This page is not for your account' && note.startsWith('The front desk is for hotel staff') };
  }],

  ['UI-23', 'Staff sees which room is booked by whom', 'staff', async (page) => {
    await go(page, 'staff');
    const rooms = await page.$$eval('.room', (els) => els.map((e) =>
      e.querySelector('strong').textContent.replace('Room ', '') + ' ' + e.querySelector('small').textContent));
    const want = ['101 Booked by Amina Sadykova (HB-0001)', '102 Free for these dates', '103 Free for these dates',
      '201 Booked by Daniel Brooks (HB-0002)', '202 Booked by Daniel Brooks (HB-0005)', '301 Free for these dates'];
    return { actual: rooms.join('; '), pass: JSON.stringify(rooms) === JSON.stringify(want) };
  }],

  ['UI-24', 'Staff closes a room for maintenance', 'staff', async (page, t) => {
    await go(page, 'staff');
    await page.click('.room:has-text("Room 103") >> text=Close for maintenance');
    await page.waitForSelector('.room:has-text("Room 103") >> text=Reopen room');
    const visitor = await t.as(null);
    const closed = await standardLeft(visitor);
    await page.click('.room:has-text("Room 103") >> text=Reopen room');
    await page.waitForSelector('.room:has-text("Room 103") >> text=Close for maintenance');
    const reopened = await standardLeft(visitor);
    return { actual: `guests see after closing: ${closed}; after reopening: ${reopened}`,
      pass: closed === 'Standard: 1 of 3 left' && reopened === 'Standard: 2 of 3 left' };
  }],

  ['UI-25', 'Staff checks a guest in and out', 'amina', async (page, t) => {
    const today = todayISO();
    await toCheckout(page, [today, plusDays(today, 1)]); await pay(page, '4242 4242 4242 4242');
    const staff = await t.as('staff');
    await go(staff, 'staff');
    const row = await staffRow(staff, 'HB-0006');
    await row.getByRole('button', { name: 'Check in' }).click();
    await staff.waitForFunction(() => /checked in/.test(document.querySelector('main .status')?.textContent || ''));
    const s1 = clean(await row.locator('.badge').first().textContent());
    await row.getByRole('button', { name: 'Check out' }).click();
    await staff.waitForFunction(() => /checked out/.test(document.querySelector('main .status')?.textContent || ''));
    const s2 = clean(await row.locator('.badge').first().textContent());
    await staff.screenshot({ path: path.join(SHOTS, 'UI-25.png') }); t.shotTaken = true;
    return { actual: `HB-0006 today: Confirmed → ${s1} → ${s2}`, pass: /Checked in/i.test(s1) && s2 === 'Completed' };
  }],

  // ----- Admin -----
  ['UI-26', 'Admin changes a room price', 'admin', async (page, t) => {
    await go(page, 'admin');
    await page.click('.admin-side >> text=Room prices');
    await page.fill('#price-1', '70');
    await page.locator('.price-row', { hasText: 'Standard' }).getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => /now costs/.test(document.querySelector('main .status')?.textContent || ''));
    const status = clean(await page.textContent('main .status'));
    await t.shot();
    const visitor = await t.as(null);
    await go(visitor, 'book');
    const price = clean(await visitor.textContent('.rt:has-text("Standard") .price'));
    const amina = await t.as('amina');
    await go(amina, 'account');
    const old = clean(await amina.locator('.booking-card', { hasText: 'HB-0001' }).textContent());
    return { actual: `${status} | guests see "${price.slice(0, 30)}" | HB-0001 total ${(old.match(/\$\d+/) || ['?'])[0]}`,
      pass: status.startsWith('Standard now costs $70') && price.includes('$70 per night') && old.includes('$180') };
  }],
];

// ---------- runner ----------

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const [id, title, who, fn] of TESTS) {
    let r;
    const extra = [];
    let main = null;
    try {
      await resetDemo();
      main = await openAs(browser, who);
      const page = main.page;
      const t = {
        shotTaken: false,
        async shot() { await page.screenshot({ path: path.join(SHOTS, `${id}.png`) }); this.shotTaken = true; },
        async as(other) { const o = await openAs(browser, other); extra.push(o.context); return o.page; },
      };
      r = await fn(page, t);
      if (!t.shotTaken) await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
    } catch (err) {
      r = { actual: 'ERROR: ' + err.message.split('\n')[0], pass: false };
      if (main) await main.page.screenshot({ path: path.join(SHOTS, `${id}.png`) }).catch(() => {});
    }
    for (const c of extra) await c.close();
    if (main) await main.context.close();
    results.push({ id, title, status: r.pass ? 'PASS' : 'FAIL', actual: r.actual });
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${id}  ${title}\n      actual: ${r.actual}`);
  }
  await browser.close();
  await resetDemo().catch(() => {});

  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\nTOTAL ${results.length}   PASS ${pass}   FAIL ${results.length - pass}`);
  fs.writeFileSync(path.join(__dirname, 'ui-test-results.json'), JSON.stringify(results, null, 2));
})();
