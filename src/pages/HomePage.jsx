import { useState } from 'react';
import { getDb, money, validateSearch, todayISO, typeName, typeDesc } from '../db.js';
import { t } from '../i18n/index.js';
import RoomPhoto from '../components/RoomPhoto.jsx';
import { TypeRating } from '../components/Stars.jsx';
import HotelMap from '../components/HotelMap.jsx';
import heroPhoto from '../assets/rooms/view-1.jpg';

const FEATURES = [1, 2, 3];

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
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1 id="home-title" tabIndex={-1} ref={headingRef}>
            {me ? t('home.welcomeBack', { name: me.first_name }) : t('home.title')}
          </h1>
          <p className="home-hero-text">{t('home.lead')}</p>

          <form className="quick-search" noValidate onSubmit={submit} aria-label={t('search.findRoom')}>
            <div className="field">
              <label htmlFor="h-ci">{t('search.checkIn')}</label>
              <input type="date" id="h-ci" min={todayISO()} value={ci} onChange={(e) => setCi(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="h-co">{t('search.checkOut')}</label>
              <input type="date" id="h-co" min={todayISO()} value={co} onChange={(e) => setCo(e.target.value)} />
            </div>
            <div className="field field-narrow">
              <label htmlFor="h-guests">{t('search.guests')}</label>
              <input type="number" id="h-guests" min={1} max={10} value={guests} onChange={(e) => setGuests(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary">{t('home.searchBtn')}</button>
            <p className="form-error dark" role="alert">{error}</p>
          </form>
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2>{t('home.rooms')}</h2>
          <button type="button" className="link-btn" onClick={() => onGo('book')}>{t('home.seeAvailability')}</button>
        </div>
        <div className="type-grid">
          {db.room_type.map((rt) => (
            <article className="type-card" key={rt.room_type_id}>
              <RoomPhoto kind="bed" typeId={rt.room_type_id} label={t('room.photoOf', { type: typeName(rt) })} />
              <div className="type-card-body">
                <div className="type-card-head">
                  <h3>{typeName(rt)}</h3>
                  <span className="type-price">{money(rt.price_per_night)}<small> {t('price.perNightShort')}</small></span>
                </div>
                <TypeRating typeId={rt.room_type_id} onClick={() => onDetails(rt.room_type_id)} />
                <p className="muted">{typeDesc(rt)}</p>
                <p className="muted">{t('room.sleeps', { n: rt.capacity })}</p>
                <button type="button" className="link-btn" onClick={() => onDetails(rt.room_type_id)}>{t('room.detailsLink')}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section">
        <h2>{t('home.why')}</h2>
        <div className="feature-grid">
          {FEATURES.map((n) => (
            <div className="feature" key={n}>
              <span className="feature-num" aria-hidden="true">0{n}</span>
              <h3>{t('home.f' + n + '.title')}</h3>
              <p className="muted">{t('home.f' + n + '.text')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-map-title">
        <div className="section-head">
          <h2 id="home-map-title">{t('home.mapTitle')}</h2>
          <button type="button" className="link-btn" onClick={() => onGo('about')}>{t('home.contacts')}</button>
        </div>
        <HotelMap compact />
      </section>

      {!me && (
        <section className="home-cta">
          <div>
            <h2>{t('home.ctaTitle')}</h2>
            <p>{t('home.ctaText')}</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-light" onClick={() => onGo('register')}>{t('nav.signup')}</button>
            <button type="button" className="btn btn-outline-light" onClick={() => onGo('login')}>{t('home.haveAccount')}</button>
          </div>
        </section>
      )}
    </>
  );
}
