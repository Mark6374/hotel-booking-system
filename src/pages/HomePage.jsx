import { useState } from 'react';
import { getDb, money, validateSearch, todayISO } from '../db.js';
import RoomPhoto from '../components/RoomPhoto.jsx';
import { TypeRating } from '../components/Stars.jsx';
import heroPhoto from '../assets/rooms/view-1.jpg';

const FEATURES = [
  { title: 'Honest availability', text: 'The rooms you see are read from the same tables the front desk uses. No overbooking.' },
  { title: 'Pay once, all or nothing', text: 'Your booking, rooms and payment are saved in one transaction, or not at all.' },
  { title: 'Your account, your stays', text: 'Log in to see every booking, cancel upcoming ones and keep your details up to date.' }
];

export default function HomePage({ headingRef, me, search, onSearch, onDetails, onGo }) {
  const db = getDb();
  const [ci, setCi] = useState(search.ci);
  const [co, setCo] = useState(search.co);
  const [guests, setGuests] = useState(search.guests);
  const [error, setError] = useState('');

  function submit(e) {
    e.preventDefault();
    const s = { ci, co, guests: parseInt(guests, 10) };
    const err = validateSearch(s);
    setError(err);
    if (!err) onSearch(s);
  }

  return (
    <>
      <section className="home-hero" style={{ backgroundImage: `url(${heroPhoto})` }}>
        <div className="home-hero-inner">
          <p className="eyebrow">Boutique hotel · Almaty city centre</p>
          <h1 id="home-title" tabIndex={-1} ref={headingRef}>
            {me ? `Welcome back, ${me.first_name}.` : 'Six rooms. Zero surprises.'}
          </h1>
          <p className="home-hero-text">
            A small independent hotel with a booking system you can trust: see what is really free, book in a minute,
            manage your stay from your account.
          </p>

          <form className="quick-search" noValidate onSubmit={submit} aria-label="Find a room">
            <div className="field">
              <label htmlFor="h-ci">Check-in</label>
              <input type="date" id="h-ci" min={todayISO()} value={ci} onChange={(e) => setCi(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="h-co">Check-out</label>
              <input type="date" id="h-co" min={todayISO()} value={co} onChange={(e) => setCo(e.target.value)} />
            </div>
            <div className="field field-narrow">
              <label htmlFor="h-guests">Guests</label>
              <input type="number" id="h-guests" min={1} max={10} value={guests} onChange={(e) => setGuests(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary">Search rooms</button>
            <p className="form-error dark" role="alert">{error}</p>
          </form>
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2>Our rooms</h2>
          <button type="button" className="link-btn" onClick={() => onGo('book')}>See availability</button>
        </div>
        <div className="type-grid">
          {db.room_type.map((t) => (
            <article className="type-card" key={t.room_type_id}>
              <RoomPhoto kind="bed" typeId={t.room_type_id} label={t.type_name + ' room'} />
              <div className="type-card-body">
                <div className="type-card-head">
                  <h3>{t.type_name}</h3>
                  <span className="type-price">{money(t.price_per_night)}<small> / night</small></span>
                </div>
                <TypeRating typeId={t.room_type_id} onClick={() => onDetails(t.room_type_id)} />
                <p className="muted">{t.description}</p>
                <p className="muted">Sleeps {t.capacity}</p>
                <button type="button" className="link-btn" onClick={() => onDetails(t.room_type_id)}>Photos, details and reviews</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section">
        <h2>Why guests book with us</h2>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <div className="feature" key={f.title}>
              <span className="feature-num" aria-hidden="true">0{i + 1}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {!me && (
        <section className="home-cta">
          <div>
            <h2>Create a free account</h2>
            <p>Book faster with saved details, and see or cancel your stays any time.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-light" onClick={() => onGo('register')}>Sign up</button>
            <button type="button" className="btn btn-outline-light" onClick={() => onGo('login')}>I already have an account</button>
          </div>
        </section>
      )}
    </>
  );
}
