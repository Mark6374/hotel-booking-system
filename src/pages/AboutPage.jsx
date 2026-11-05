const reviews = [
  { stars: 5, quote: 'Checked in without a single piece of paper changing hands. The Deluxe room view over the courtyard was worth every cent.', author: 'Amina S.' },
  { stars: 5, quote: 'Front desk resolved a date mix-up in under a minute because they could see the same booking I could. Rare these days.', author: 'Daniel B.' },
  { stars: 4, quote: 'Suite was spacious and quiet. Only gripe is the elevator queue at breakfast time.', author: 'Mei T.' }
];

function Stars({ n }) {
  return <p className="review-stars" aria-label={`${n} out of 5 stars`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</p>;
}

export default function AboutPage({ headingRef }) {
  return (
    <>
      <div className="page-head">
        <h1 id="about-title" tabIndex={-1} ref={headingRef}>About Juniper Court</h1>
        <p className="lead">A small, independent hotel in the city centre, run on the same booking tables you see in Staff view.</p>
      </div>

      <section className="about-section">
        <h2>Our story</h2>
        <p className="lead">
          Juniper Court opened in 2014 with six rooms spread across three floors. We kept it small on purpose: every
          booking is handled by a front desk that can see exactly what you see when you search for a room, down to
          the same availability query. No overbooking, no surprises at check-in.
        </p>
      </section>

      <section className="about-section">
        <h2>Contact</h2>
        <div className="contact-grid">
          <div className="contact-card">
            <strong>Address</strong>
            <span>14 Juniper Court, Almaty 050000</span>
          </div>
          <div className="contact-card">
            <strong>Phone</strong>
            <a href="tel:+77001112233">+7 700 111 2233</a>
          </div>
          <div className="contact-card">
            <strong>Email</strong>
            <a href="mailto:front-desk@junipercourt.example">front-desk@junipercourt.example</a>
          </div>
          <div className="contact-card">
            <strong>Front desk hours</strong>
            <span>24/7</span>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>Guest reviews</h2>
        <div className="review-grid">
          {reviews.map((r, idx) => (
            <article className="review-card" key={idx}>
              <Stars n={r.stars} />
              <p className="review-quote">&ldquo;{r.quote}&rdquo;</p>
              <p className="review-author">{r.author}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
