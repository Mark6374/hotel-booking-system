/* Illustrated stand-ins for real room photography. No external images or
   network requests: each is a small inline SVG, tinted per room type so the
   three room types read as distinct at a glance. */

const PALETTES = {
  1: { a: '#c7cdf2', b: '#eef0fd', line: '#2438d4' },   // Standard
  2: { a: '#f6dca0', b: '#fdf3df', line: '#8a5a00' },   // Deluxe
  3: { a: '#b9e2cb', b: '#e7f6ee', line: '#0f6b3e' }    // Suite
};

function palette(typeId) { return PALETTES[typeId] || PALETTES[1]; }

function BedWindow({ p }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-hidden="true">
      <rect width="160" height="120" fill={p.b} />
      <rect x="100" y="14" width="46" height="56" rx="3" fill="#fff" stroke={p.line} strokeWidth="2" />
      <line x1="123" y1="14" x2="123" y2="70" stroke={p.line} strokeWidth="2" />
      <line x1="100" y1="42" x2="146" y2="42" stroke={p.line} strokeWidth="2" />
      <rect x="14" y="58" width="90" height="42" rx="6" fill={p.a} stroke={p.line} strokeWidth="2" />
      <rect x="14" y="58" width="90" height="14" rx="6" fill="#fff" stroke={p.line} strokeWidth="2" />
      <rect x="20" y="46" width="22" height="18" rx="4" fill="#fff" stroke={p.line} strokeWidth="2" />
      <rect x="10" y="98" width="100" height="6" rx="2" fill={p.line} opacity="0.25" />
    </svg>
  );
}

function Bathroom({ p }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-hidden="true">
      <rect width="160" height="120" fill={p.b} />
      <rect x="24" y="52" width="112" height="38" rx="16" fill="#fff" stroke={p.line} strokeWidth="2" />
      <rect x="24" y="52" width="112" height="38" rx="16" fill="none" stroke={p.line} strokeWidth="2" />
      <path d="M48 52 V38 a10 10 0 0 1 20 0" fill="none" stroke={p.line} strokeWidth="2" />
      <circle cx="58" cy="30" r="4" fill={p.line} />
      <rect x="106" y="94" width="8" height="10" rx="2" fill={p.line} opacity="0.4" />
      <rect x="40" y="94" width="8" height="10" rx="2" fill={p.line} opacity="0.4" />
      <circle cx="120" cy="66" r="3" fill={p.a} stroke={p.line} strokeWidth="1.5" />
      <circle cx="128" cy="70" r="2" fill={p.a} stroke={p.line} strokeWidth="1.5" />
    </svg>
  );
}

function ViewSkyline({ p }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-hidden="true">
      <rect width="160" height="120" fill={p.b} />
      <rect x="18" y="16" width="124" height="88" rx="4" fill="#fff" stroke={p.line} strokeWidth="2" />
      <rect x="26" y="60" width="18" height="40" fill={p.a} />
      <rect x="50" y="42" width="16" height="58" fill={p.a} />
      <rect x="72" y="68" width="20" height="32" fill={p.a} />
      <rect x="98" y="50" width="14" height="50" fill={p.a} />
      <rect x="118" y="36" width="16" height="64" fill={p.a} />
      <circle cx="108" cy="32" r="9" fill="#ffe9a6" stroke={p.line} strokeWidth="1.5" />
    </svg>
  );
}

const KINDS = { bed: BedWindow, bath: Bathroom, view: ViewSkyline };

export default function RoomPhoto({ kind, typeId, label }) {
  const Illustration = KINDS[kind] || BedWindow;
  const p = palette(typeId);
  return (
    <div className="room-photo" role="img" aria-label={label || kind}>
      <Illustration p={p} />
    </div>
  );
}
