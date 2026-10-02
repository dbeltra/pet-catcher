// Pure helpers, no DOM. Tested by test.mjs (node test.mjs).

// COCO animal classes EfficientDet knows → the Spanish name we show and store. "teddy bear" is left out on purpose.
export const COCO_ES = {
  bird: 'pájaro', cat: 'gato', dog: 'perro', horse: 'caballo', sheep: 'oveja',
  cow: 'vaca', elephant: 'elefante', bear: 'oso', zebra: 'cebra', giraffe: 'jirafa',
};

export const UNKNOWN = 'bichito misterioso';

// Emoji per species. The keys double as suggestions when the user types a species.
export const EMOJI = {
  pájaro: '🐦', gato: '🐱', perro: '🐶', caballo: '🐴', oveja: '🐑', vaca: '🐮', elefante: '🐘',
  oso: '🐻', cebra: '🦓', jirafa: '🦒', ciervo: '🦌', conejo: '🐰', ardilla: '🐿️', pato: '🦆',
  gallina: '🐔', paloma: '🕊️', búho: '🦉', tortuga: '🐢', rana: '🐸', zorro: '🦊', jabalí: '🐗',
  erizo: '🦔', cerdo: '🐷', cabra: '🐐', mono: '🐒', pez: '🐟', mariposa: '🦋', abeja: '🐝',
  lagartija: '🦎', caracol: '🐌', ratón: '🐭', [UNKNOWN]: '❓',
};
export const emojiFor = species => EMOJI[species] ?? '🐾';

// Pastel per animal, stable across filters and reloads (hash of the id). The tile and its big card share it.
export const PASTELS = ['#fff0bf', '#dcf4e4', '#dcedff', '#ffe4cc', '#e9f2d2'];
export const pastelFor = id => PASTELS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % PASTELS.length];

// Fills the fields newer versions added, so records from any older version keep working.
export const normalize = a => ({ fav: false, note: '', traits: [], visits: [], memory: false, ...a });

// Her past pets ("recuerdos"). Fixed ids: re-added on every start if missing, never deletable, and a
// restore never duplicates them. Memories have no catch date or place.
export const SEEDS = [
  { id: 'seed-kurko', name: 'Kurko', species: 'perro', file: 'seed/kurko.png' },
  { id: 'seed-kiffy', name: 'Kiffy', species: 'gato', file: 'seed/kiffy.png' },
];

// Memories first, then newest first.
export const byNewest = (a, b) => (b.memory - a.memory) || ((b.takenAt ?? 0) - (a.takenAt ?? 0));

// Validates a backup file's text. Throws a message meant for the user.
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('El archivo no es una copia de Pet Catcher.'); }
  if (d?.app !== 'pet-catcher' || !Array.isArray(d.animals)
    || !d.animals.every(a => typeof a.id === 'string' && /^data:image\//.test(a.sticker))) {
    throw new Error('El archivo no es una copia de Pet Catcher.');
  }
  return d;
}

export const cleanSpecies = s => s.trim().toLowerCase() || UNKNOWN;

const TITLE = ['Don', 'Doña', 'Capitán', 'Princesa', 'Profe', 'Mini', 'Sir', 'Lady', 'Bebé', 'Señorito', 'Gran', 'Pequeño'];
const NOUN = ['Galleta', 'Churro', 'Pepinillo', 'Fideo', 'Gofre', 'Croqueta', 'Mochi', 'Bollito', 'Nube', 'Garbanzo', 'Turrón', 'Chispa'];

export const randomName = (rnd = Math.random) =>
  `${TITLE[Math.floor(rnd() * TITLE.length)]} ${NOUN[Math.floor(rnd() * NOUN.length)]}`;

// Best-scoring animal across all detections, or null.
export function pickAnimal(detections) {
  const hits = detections.flatMap(d =>
    d.categories.filter(c => c.categoryName in COCO_ES)
      .map(c => ({ name: c.categoryName, score: c.score, box: d.boundingBox })));
  return hits.sort((a, b) => b.score - a.score)[0] ?? null;
}

// Short place name from a Nominatim reverse-geocode response: "Sitges, Garraf", "Carxol, Begues", "Sol, Madrid".
export function placeName(r) {
  const a = r.address ?? {};
  const town = a.city ?? a.town ?? a.village ?? a.municipality;
  const first = r.name || town || a.county || a.state;
  if (!first) return null;
  const second = [town, a.county, a.state_district, a.state].find(v => v && v !== first);
  return second ? `${first}, ${second}` : first;
}

// Species → count, most common first.
export function speciesCounts(animals) {
  const m = new Map();
  for (const a of animals) m.set(a.species, (m.get(a.species) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

// Mask value at a normalized point. That value is the object the segmenter picked.
export const maskValueAt = (mask, w, h, p) =>
  mask[Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w))];

// Bounding box of the pixels equal to fg, in mask coordinates, or null.
// Null too when fg covers more than maxShare of the mask: then the point hit the background.
export function maskBBox(mask, w, h, fg, maxShare = 0.9) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x] !== fg) continue;
    n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 || n > maxShare * w * h ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Make every RGBA pixel outside the mask transparent. The mask may be a different size than the image.
export function applyMask(rgba, W, H, mask, w, h, fg) {
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y * h / H) * w;
    for (let x = 0; x < W; x++) {
      if (mask[row + Math.floor(x * w / W)] !== fg) rgba[(y * W + x) * 4 + 3] = 0;
    }
  }
}
