import { useState } from 'react';
import { getSelection, validateSearch, money, runBookingTransaction, fmtDate, getDb, typeName } from '../db.js';
import { PHONE_RE } from '../auth.js';
import { t, tn, serverText } from '../i18n/index.js';

function SummaryDates({ s, n }) {
  return (
    <dl>
      <div><dt>{t('search.checkIn')}</dt><dd>{fmtDate(s.ci)}</dd></div>
      <div><dt>{t('search.checkOut')}</dt><dd>{fmtDate(s.co)}</dd></div>
      <div><dt>{t('sum.nights')}</dt><dd>{n}</dd></div>
      <div><dt>{t('search.guests')}</dt><dd>{s.guests}</dd></div>
    </dl>
  );
}

export function RenderLog({ log }) {
  return (
    <ol className="txlog">
      {log.map((i, idx) => (
        <li className={(i.ok ? 'ok' : 'fail') + (i.final ? ' final' : '')} key={idx}>
          <span className="mark" aria-hidden="true">{i.ok ? '✓' : '✗'}</span>
          <span>
            <span className="sr">{t(i.ok ? 'log.done' : 'log.failed')} </span>
            {serverText(i.label)}
            {i.detail ? <small>{serverText(i.detail)}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

const emptyErrors = {};

export default function CheckoutPage({ headingRef, me, search, sel, onBack, onPaid }) {
  const db = getDb();
  const sel2 = getSelection(db, search, sel);

  // Prefilled from the logged-in account; the booking is always made under its email.
  const [first_name, setFirstName] = useState(me.first_name);
  const [last_name, setLastName] = useState(me.last_name);
  const email = me.email;
  const [phone, setPhone] = useState(me.phone);
  const [method, setMethod] = useState('Card');
  const [card, setCard] = useState('');
  const [errors, setErrors] = useState(emptyErrors);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setFailure(null);

    const v = {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      method,
      cardDigits: card.replace(/[\s-]/g, '')
    };

    const errs = {};
    if (!v.first_name) errs.first_name = t('v.firstName');
    if (!v.last_name) errs.last_name = t('v.lastName');
    if (!v.email) errs.email = t('v.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = t('v.email');
    if (!v.phone) errs.phone = t('v.phoneRequired');
    else if (!PHONE_RE.test(v.phone)) errs.phone = t('v.phone');
    if (!v.method) errs.method = t('v.method');
    if (v.method === 'Card' && !/^\d{16}$/.test(v.cardDigits)) errs.card = t('v.card');

    setErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      const target = document.getElementById(firstBad === 'method' ? 'first_name' : firstBad);
      if (target) target.focus();
      return;
    }

    const searchErr = validateSearch(search);
    if (searchErr || !sel2.lines.length || sel2.cap < search.guests) {
      setFailure({ message: searchErr || t('pay.roomsGone'), log: [] });
      return;
    }

    let remaining = search.guests;
    const rooms = [];
    sel2.lines.forEach((l) => {
      l.rooms.forEach((r) => {
        const g = Math.max(1, Math.min(l.type.capacity, remaining));
        remaining = Math.max(0, remaining - g);
        rooms.push({ room_id: r.room_id, room_number: r.room_number, price: l.type.price_per_night, guests_count: g });
      });
    });

    setBusy(true);
    const result = await runBookingTransaction({
      guest: { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone },
      ci: search.ci,
      co: search.co,
      rooms,
      total: sel2.total,
      method: v.method,
      cardDigits: v.cardDigits
    });

    setBusy(false);
    if (result.ok) {
      onPaid(result, v.email);
    } else {
      setFailure(result);
    }
  }

  return (
    <>
      <div className="page-head">
        <button type="button" className="link-btn" onClick={onBack}>{t('pay.back')}</button>
        <h1 id="checkout-title" tabIndex={-1} ref={headingRef}>{t('pay.title')}</h1>
      </div>

      <div className="checkout-grid">
        <form id="checkout-form" noValidate onSubmit={submit}>
          <fieldset>
            <legend>{t('pay.who')}</legend>
            <div className="row-2">
              <div className="field">
                <label htmlFor="first_name">{t('f.firstName')}</label>
                <input type="text" id="first_name" maxLength={50} autoComplete="given-name" aria-describedby="err-first_name"
                  aria-invalid={errors.first_name ? 'true' : undefined} value={first_name} onChange={(e) => setFirstName(e.target.value)} />
                <p className="field-error" id="err-first_name">{errors.first_name || ''}</p>
              </div>
              <div className="field">
                <label htmlFor="last_name">{t('f.lastName')}</label>
                <input type="text" id="last_name" maxLength={50} autoComplete="family-name" aria-describedby="err-last_name"
                  aria-invalid={errors.last_name ? 'true' : undefined} value={last_name} onChange={(e) => setLastName(e.target.value)} />
                <p className="field-error" id="err-last_name">{errors.last_name || ''}</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="email">{t('f.email')}</label>
              <input type="email" id="email" maxLength={100} autoComplete="email" aria-describedby="err-email"
                aria-invalid={errors.email ? 'true' : undefined} value={email} readOnly />
              <p className="hint">{t('pay.savedToAccount')}</p>
              <p className="field-error" id="err-email">{errors.email || ''}</p>
            </div>
            <div className="field">
              <label htmlFor="phone">{t('f.phone')}</label>
              <input type="tel" id="phone" maxLength={20} autoComplete="tel" aria-describedby="err-phone"
                aria-invalid={errors.phone ? 'true' : undefined} value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="field-error" id="err-phone">{errors.phone || ''}</p>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t('pay.how')}</legend>
            <div className="radio-row" role="radiogroup" aria-describedby="err-method">
              {['Card', 'Cash', 'Transfer'].map((m) => (
                <label className="radio" key={m}>
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} />
                  {t('method.' + m)}
                </label>
              ))}
            </div>
            <p className="field-error" id="err-method">{errors.method || ''}</p>
            {method === 'Card' && (
              <div className="field" id="card-field">
                <label htmlFor="card">{t('pay.cardNumber')}</label>
                <input type="text" id="card" inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242"
                  aria-describedby="card-hint err-card" aria-invalid={errors.card ? 'true' : undefined}
                  value={card} onChange={(e) => setCard(e.target.value)} />
                <p className="hint" id="card-hint">{t('pay.cardHint')}</p>
                <p className="field-error" id="err-card">{errors.card || ''}</p>
              </div>
            )}
          </fieldset>

          {failure && (
            <div className="tx-box tx-fail" role="alert">
              <h3>{t('pay.notSaved')}</h3>
              <p>{failure.message}</p>
              {failure.log && failure.log.length ? <RenderLog log={failure.log} /> : null}
              <div className="actions"><button type="button" className="btn btn-ghost" onClick={onBack}>{t('pay.searchAgain')}</button></div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}>{t(busy ? 'pay.saving' : 'pay.confirm')}</button>
        </form>

        <aside className="summary" aria-label={t('sum.label')}>
          <h2>{t('sum.title')}</h2>
          <SummaryDates s={search} n={sel2.n} />
          <hr />
          {sel2.lines.map((l) => (
            <div className="sum-line" key={l.type.room_type_id}>
              <div>{l.rooms.length} &times; {typeName(l.type)}<small>{t('sum.nightsAt', { nights: tn('n.nights', sel2.n), price: money(l.type.price_per_night) })}</small></div>
              <strong>{money(l.subtotal)}</strong>
            </div>
          ))}
          <hr />
          <div className="sum-line"><span>{t('sum.total')}</span><span className="sum-total">{money(sel2.total)}</span></div>
        </aside>
      </div>
    </>
  );
}
