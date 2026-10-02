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
export const normalize = a => ({ fav: false, note: '', traits: [], visits: [], memory: false, shiny: false, ...a });

// Shiny: any new catch (not a Recuerdo) has this chance of a sparkling rainbow foil, whatever its species.
export const SHINY_CHANCE = 1 / 15;
export const rollShiny = (rnd = Math.random) => rnd() < SHINY_CHANCE;

// Her past pets ("recuerdos"). Fixed ids: re-added on every start if missing, never deletable, and a
// restore never duplicates them. Memories have no catch date; their place is where they lived.
// `photo` counts versions of the seed file: 1 = the emoji placeholder, 2 = the real photo (v0.11.2).
// Both lived in Martos (Jaén).
const MARTOS = { location: { lat: 37.719658366690034, lon: -3.9696664869193734 }, place: 'Martos, Jaén' };
export const SEEDS = [
  { id: 'seed-kurko', name: 'Kurko', species: 'perro', file: 'seed/kurko.png', photo: 2, ...MARTOS },
  { id: 'seed-kiffy', name: 'Kiffy', species: 'gato', file: 'seed/kiffy.png', photo: 2, ...MARTOS },
];

// Memories first, in their number order (Kurko, then Kiffy); then newest first.
export const byNewest = (a, b) => (b.memory - a.memory)
  || (a.memory ? (a.no ?? 0) - (b.no ?? 0) : (b.takenAt ?? 0) - (a.takenAt ?? 0));

// Collection number, in catch order: the memories first (in SEEDS order), then by catch time.
// Gives a `no` to every record without one and returns those records (to save).
export function numberAll(all) {
  let next = Math.max(0, ...all.map(a => a.no ?? 0)) + 1;
  const seedOrder = id => SEEDS.findIndex(s => s.id === id);
  return all.filter(a => !a.no)
    .sort((x, y) => (y.memory - x.memory) || (seedOrder(x.id) - seedOrder(y.id)) || ((x.takenAt ?? 0) - (y.takenAt ?? 0)))
    .map(a => Object.assign(a, { no: next++ }));
}
export const fmtNo = n => `#${String(n).padStart(3, '0')}`;

// Validates a backup file's text. Throws a message meant for the user.
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('El archivo no es una copia de Bichidex.'); }
  if (d?.app !== 'pet-catcher' || !Array.isArray(d.animals)
    || !d.animals.every(a => typeof a.id === 'string' && /^data:image\//.test(a.sticker))) {
    throw new Error('El archivo no es una copia de Bichidex.');
  }
  return d;
}

// Rarity per species. Custom species are 'raro'; her past pets are always 'legendario'.
const TIERS = {
  común: ['gato', 'perro', 'pájaro', 'paloma', 'gallina', 'pez', 'ratón', 'vaca', 'oveja', 'caballo', 'cerdo', 'caracol', 'abeja', UNKNOWN],
  raro: ['conejo', 'pato', 'ardilla', 'cabra', 'tortuga', 'rana', 'mariposa', 'lagartija'],
  épico: ['zorro', 'búho', 'erizo', 'ciervo', 'jabalí', 'mono'],
  legendario: ['elefante', 'oso', 'cebra', 'jirafa'],
};
export const RARITIES = Object.keys(TIERS);
export const RARITY_LABEL = { común: 'Común', raro: '★ Raro', épico: '★★ Épico', legendario: '★★★ Legendario' };
const TIER_OF = Object.fromEntries(Object.entries(TIERS).flatMap(([t, list]) => list.map(s => [s, t])));
export const rarityOf = species => TIER_OF[species] ?? 'raro';
export const rarityFor = a => (a.memory ? 'legendario' : rarityOf(a.species));

// Album: one slot per known species (by rarity, then name) plus any custom species already caught.
export function albumSlots(animals) {
  const known = Object.keys(EMOJI).filter(s => s !== UNKNOWN)
    .sort((x, y) => RARITIES.indexOf(rarityOf(x)) - RARITIES.indexOf(rarityOf(y)) || x.localeCompare(y));
  const custom = [...new Set(animals.map(a => a.species))].filter(s => s !== UNKNOWN && !known.includes(s)).sort();
  return [...known, ...custom].map(species => {
    const mine = animals.filter(a => a.species === species);
    return { species, emoji: emojiFor(species), rarity: rarityOf(species), count: mine.length, latest: mine[0] ?? null };
  });
}

// Trading-card personality: 3 random traits with 1-5 stars. All editable on the back of the card.
export const TRAITS = ['Dormilón', 'Glotón', 'Juguetón', 'Mimoso', 'Curioso', 'Valiente', 'Tímido', 'Travieso',
  'Elegante', 'Gruñón', 'Presumido', 'Aventurero', 'Cariñoso', 'Charlatán', 'Despistado', 'Veloz'];
export function randomTraits(rnd = Math.random) {
  const pool = [...TRAITS];
  return Array.from({ length: 3 }, () => ({ name: pool.splice(Math.floor(rnd() * pool.length), 1)[0], stars: 1 + Math.floor(rnd() * 5) }));
}

// Re-encounters: each visit is { at, location, place }. The catch itself counts as the first sighting.
export const timesSeen = a => 1 + a.visits.length;
export const lastSeen = a => Math.max(a.takenAt ?? 0, ...a.visits.map(v => v.at));

// Achievements (feminine forms: they are for Mari). Her Recuerdos never count as catches.
const hour = t => new Date(t).getHours();
const catches = all => all.filter(a => !a.memory);
const sightings = all => catches(all).flatMap(a => [a.takenAt, ...a.visits.map(v => v.at)]).filter(Boolean);
const places = all => new Set(catches(all).flatMap(a => [a.place, ...a.visits.map(v => v.place)]).filter(Boolean));
const speciesCount = all => new Set(catches(all).map(a => a.species).filter(s => s !== UNKNOWN)).size;
const ofSpecies = (all, s) => catches(all).filter(a => a.species === s).length;
export const ACHIEVEMENTS = [
  { id: 'first', emoji: '🐾', title: 'Primera captura', desc: 'Atrapa tu primer bichito', test: all => catches(all).length >= 1 },
  { id: 'ten', emoji: '🏅', title: 'Coleccionista', desc: '10 capturas', test: all => catches(all).length >= 10 },
  { id: 'fifty', emoji: '🏆', title: 'Gran coleccionista', desc: '50 capturas', test: all => catches(all).length >= 50 },
  { id: 'variety', emoji: '🌈', title: 'Variedad', desc: '5 especies distintas', test: all => speciesCount(all) >= 5 },
  { id: 'half', emoji: '📖', title: 'Medio álbum', desc: '15 especies distintas', test: all => speciesCount(all) >= 15 },
  { id: 'cats', emoji: '🐱', title: 'Amiga de los gatos', desc: '5 gatos', test: all => ofSpecies(all, 'gato') >= 5 },
  { id: 'dogs', emoji: '🐶', title: 'Amiga de los perros', desc: '5 perros', test: all => ofSpecies(all, 'perro') >= 5 },
  { id: 'epic', emoji: '✨', title: 'Épica', desc: 'Atrapa un bichito épico', test: all => catches(all).some(a => rarityOf(a.species) === 'épico') },
  { id: 'legend', emoji: '🌟', title: 'Leyenda', desc: 'Atrapa un bichito legendario', test: all => catches(all).some(a => rarityOf(a.species) === 'legendario') },
  { id: 'mystery', emoji: '❓', title: 'Misterio', desc: 'Un bichito que nadie conoce', test: all => catches(all).some(a => a.species === UNKNOWN) },
  { id: 'night', emoji: '🌙', title: 'Cazadora nocturna', desc: 'Una captura entre las 22 y las 6', test: all => sightings(all).some(t => hour(t) >= 22 || hour(t) < 6) },
  { id: 'early', emoji: '🌅', title: 'Madrugadora', desc: 'Una captura entre las 6 y las 8', test: all => sightings(all).some(t => hour(t) >= 6 && hour(t) < 8) },
  { id: 'travel', emoji: '🧭', title: 'Viajera', desc: 'Capturas en 3 lugares', test: all => places(all).size >= 3 },
  { id: 'world', emoji: '✈️', title: 'Trotamundos', desc: 'Capturas en 10 lugares', test: all => places(all).size >= 10 },
  { id: 'loyal', emoji: '🔁', title: 'Amiga fiel', desc: 'Ve al mismo bichito 3 veces', test: all => catches(all).some(a => timesSeen(a) >= 3) },
  { id: 'shiny', emoji: '🌈', title: '¡Un shiny!', desc: 'Atrapa un bichito shiny', test: all => catches(all).some(a => a.shiny) },
  { id: 'heart', emoji: '💖', title: 'Corazón blando', desc: '5 favoritos', test: all => all.filter(a => a.fav).length >= 5 },
];
export const unlockedIds = all => ACHIEVEMENTS.filter(x => x.test(all)).map(x => x.id);

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
