import HotelMap from '../components/HotelMap.jsx';
import { t } from '../i18n/index.js';

const REVIEWS = [
  { stars: 5, key: 'about.r1', author: 'Amina S.' },
  { stars: 5, key: 'about.r2', author: 'Daniel B.' },
  { stars: 4, key: 'about.r3', author: 'Mei T.' }
];

function Stars({ n }) {
  return <p className="review-stars" aria-label={t('stars.label', { n })}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</p>;
}

export default function AboutPage({ headingRef }) {
  return (
    <>
      <div className="page-head">
        <h1 id="about-title" tabIndex={-1} ref={headingRef}>{t('about.title')}</h1>
        <p className="lead">{t('about.lead')}</p>
      </div>

      <section className="about-section">
        <h2>{t('about.storyTitle')}</h2>
        <p className="lead">{t('about.story')}</p>
      </section>

      <section className="about-section">
        <h2>{t('about.contact')}</h2>
        <div className="contact-grid">
          <div className="contact-card">
            <strong>{t('about.address')}</strong>
            <span>{t('hotel.address')}</span>
          </div>
          <div className="contact-card">
            <strong>{t('f.phone')}</strong>
            <a href="tel:+77001112233">+7 700 111 2233</a>
          </div>
          <div className="contact-card">
            <strong>{t('f.email')}</strong>
            <a href="mailto:front-desk@junipercourt.example">front-desk@junipercourt.example</a>
          </div>
          <div className="contact-card">
            <strong>{t('about.hours')}</strong>
            <span>{t('about.hours247')}</span>
          </div>
        </div>
      </section>

      <section className="about-section" aria-labelledby="map-title">
        <h2 id="map-title">{t('about.where')}</h2>
        <HotelMap />
      </section>

      <section className="about-section">
        <h2>{t('about.reviews')}</h2>
        <div className="review-grid">
          {REVIEWS.map((r) => (
            <article className="review-card" key={r.key}>
              <Stars n={r.stars} />
              <p className="review-quote">&ldquo;{t(r.key)}&rdquo;</p>
              <p className="review-author">{r.author}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
