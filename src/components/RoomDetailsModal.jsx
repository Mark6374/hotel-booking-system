import { useEffect, useRef } from 'react';
import { getDb, money } from '../db.js';
import RoomPhoto from './RoomPhoto.jsx';

export default function RoomDetailsModal({ typeId, onClose }) {
  const db = getDb();
  const t = db.room_type.filter((x) => x.room_type_id === typeId)[0];
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!t) return null;

  const roomCount = db.room.filter((r) => r.room_type_id === typeId).length;

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{t.type_name}</h2>
          <button type="button" className="modal-close" ref={closeRef} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="modal-gallery">
          <RoomPhoto kind="bed" typeId={t.room_type_id} label="Bed and window" />
          <RoomPhoto kind="bath" typeId={t.room_type_id} label="Bathroom" />
          <RoomPhoto kind="view" typeId={t.room_type_id} label="Room view" />
        </div>

        <p>{t.description}</p>

        <div className="modal-facts">
          <span>Sleeps <strong>{t.capacity}</strong></span>
          <span>Price <strong>{money(t.price_per_night)}</strong> / night</span>
          <span>Rooms of this type <strong>{roomCount}</strong></span>
        </div>

        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
