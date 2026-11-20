/* Where the hotel is. Change the coordinates here and the map, the pin and the
   "Open in 2GIS / Google Maps" links all follow.
   Tip: in Google Maps, right-click a place and click the numbers to copy "lat, lon". */
export const HOTEL = {
  name: 'Juniper Court Hotel',
  address: '14 Juniper Court, Almaty 050000',
  city: 'Almaty, Kazakhstan',
  lat: 43.2588,
  lon: 76.9531
};

export function mapLinks({ lat, lon }) {
  return {
    twoGis: `https://2gis.kz/almaty/geo/${lon},${lat}`,
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`
  };
}

/* OpenStreetMap embed: no API key, no extra package. */
export function osmEmbedUrl({ lat, lon }, zoomSpan = 0.006) {
  const bbox = [lon - zoomSpan * 1.6, lat - zoomSpan, lon + zoomSpan * 1.6, lat + zoomSpan].map((n) => n.toFixed(5)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}
