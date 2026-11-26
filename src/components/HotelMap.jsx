import { HOTEL, mapLinks, osmEmbedUrl } from '../hotel.js';
import { t } from '../i18n/index.js';

/* Map with a pin on the hotel, plus links that open the place in a map app for directions. */
export default function HotelMap({ compact }) {
  const links = mapLinks(HOTEL);
  return (
    <div className={'hotel-map' + (compact ? ' hotel-map-compact' : '')}>
      <div className="map-frame">
        <iframe
          title={t('map.title', { name: t('hotel.name'), address: t('hotel.address') })}
          src={osmEmbedUrl(HOTEL)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
      <div className="map-info">
        <div>
          <strong>{t('hotel.name')}</strong>
          <p className="muted">{t('hotel.address')}<br />{t('hotel.city')}</p>
        </div>
        <div className="map-links" role="group" aria-label={t('map.open')}>
          <a className="btn btn-sm btn-primary" href={links.twoGis} target="_blank" rel="noopener noreferrer">2GIS</a>
          <a className="btn btn-sm btn-ghost" href={links.google} target="_blank" rel="noopener noreferrer">Google Maps</a>
          <a className="btn btn-sm btn-ghost" href={links.osm} target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
        </div>
        <p className="hint">{t('map.hint')}</p>
      </div>
    </div>
  );
}
