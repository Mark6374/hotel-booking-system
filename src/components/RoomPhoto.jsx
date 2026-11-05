import standardPhoto from '../assets/rooms/standard-1.jpg';
import deluxePhoto from '../assets/rooms/deluxe-1.jpg';
import suitePhoto from '../assets/rooms/suite-1.jpg';
import bathroomPhoto from '../assets/rooms/bathroom-1.jpg';
import viewPhoto from '../assets/rooms/view-1.jpg';

/* Free-license photos (Unsplash) standing in for real property photography.
   One bed/room shot per room type, plus a shared bathroom and window-view
   shot used across all three in the details modal gallery. */

const BED_PHOTOS = { 1: standardPhoto, 2: deluxePhoto, 3: suitePhoto };

export default function RoomPhoto({ kind, typeId, label }) {
  const src = kind === 'bath' ? bathroomPhoto : kind === 'view' ? viewPhoto : (BED_PHOTOS[typeId] || standardPhoto);
  return (
    <div className="room-photo">
      <img src={src} alt={label || kind} loading="lazy" />
    </div>
  );
}
