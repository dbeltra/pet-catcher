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
export const normalize = a => ({ fav: false, traits: [], visits: [], memory: false, shiny: false, gender: 'x', nameAuto: false, ...a });

// Gender: 'm' male, 'f' female, 'x' unknown (the default). Names and traits follow it.
export const GENDERS = { m: 'Macho', f: 'Hembra', x: 'No sé' };
export const GENDER_ICONS = { m: 'male', f: 'female', x: 'question-mark' }; // assets/icons/*.png

// Shiny: any new catch (not a Recuerdo) has this chance of a sparkling rainbow foil, whatever its species.
export const SHINY_CHANCE = 1 / 15;
export const rollShiny = (rnd = Math.random) => rnd() < SHINY_CHANCE;

// Her past pets ("recuerdos"). Fixed ids: re-added on every start if missing, never deletable, and a
// restore never duplicates them. Memories have no catch date; their place is where they lived.
// `photo` counts versions of the seed file: 1 = the emoji placeholder, 2 = the real photo (v0.11.2).
// Both lived in Martos (Jaén).
const MARTOS = { location: { lat: 37.719658366690034, lon: -3.9696664869193734 }, place: 'Martos, Jaén' };
export const SEEDS = [
  { id: 'seed-kurko', name: 'Kurko', species: 'perro', gender: 'm', file: 'seed/kurko.png', photo: 2, ...MARTOS },
  { id: 'seed-kiffy', name: 'Kiffy', species: 'gato', gender: 'm', file: 'seed/kiffy.png', photo: 2, ...MARTOS },
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
// Traits are stored in their masculine form (`name`) and shown by gender: Glotón / Glotona / Glotón/a.
// Words that don't change (Valiente, Elegante, Veloz) and traits she typed herself are shown as stored.
const TRAIT_F = {
  Dormilón: 'Dormilona', Glotón: 'Glotona', Juguetón: 'Juguetona', Mimoso: 'Mimosa', Curioso: 'Curiosa', Tímido: 'Tímida',
  Travieso: 'Traviesa', Gruñón: 'Gruñona', Presumido: 'Presumida', Aventurero: 'Aventurera', Cariñoso: 'Cariñosa',
  Charlatán: 'Charlatana', Despistado: 'Despistada',
};
export const traitLabel = (name, g) => (!TRAIT_F[name] || g === 'm' ? name : g === 'f' ? TRAIT_F[name] : `${name}/a`);
// What she typed → what to store: any gendered form of a known trait becomes its masculine form.
export const traitKey = text => {
  const t = text.trim();
  return Object.keys(TRAIT_F).find(m => [m, TRAIT_F[m], `${m}/a`].includes(t)) ?? t;
};
export function randomTraits(rnd = Math.random) {
  const pool = [...TRAITS];
  return Array.from({ length: 3 }, () => ({ name: pool.splice(Math.floor(rnd() * pool.length), 1)[0], stars: 1 + Math.floor(rnd() * 5) }));
}

// Re-encounters: each visit is { at, location, place }. The catch itself counts as the first sighting.
export const timesSeen = a => 1 + a.visits.length;
export const lastSeen = a => Math.max(a.takenAt ?? 0, ...a.visits.map(v => v.at));

// Achievements (feminine forms: they are for Mari). Her Recuerdos never count as catches.
const hour = t => new Date(t).getHours();
const catches = all => all.filter(a => !a.memory && !String(a.id).startsWith('seed-')); // her Recuerdos never count, also if a record lost its flag
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
  { id: 'night', emoji: '🌙', title: 'Atrapadora nocturna', desc: 'Una captura entre las 22 y las 6', test: all => sightings(all).some(t => hour(t) >= 22 || hour(t) < 6) },
  { id: 'early', emoji: '🌅', title: 'Madrugadora', desc: 'Una captura entre las 6 y las 8', test: all => sightings(all).some(t => hour(t) >= 6 && hour(t) < 8) },
  { id: 'travel', emoji: '🧭', title: 'Viajera', desc: 'Capturas en 3 lugares', test: all => places(all).size >= 3 },
  { id: 'world', emoji: '✈️', title: 'Trotamundos', desc: 'Capturas en 10 lugares', test: all => places(all).size >= 10 },
  { id: 'loyal', emoji: '🔁', title: 'Amiga fiel', desc: 'Ve al mismo bichito 3 veces', test: all => catches(all).some(a => timesSeen(a) >= 3) },
  { id: 'shiny', emoji: '🌈', title: '¡Un shiny!', desc: 'Atrapa un bichito shiny', test: all => catches(all).some(a => a.shiny) },
  { id: 'heart', emoji: '💖', title: 'Corazón blando', desc: '5 favoritos', test: all => all.filter(a => a.fav).length >= 5 },
];
export const unlockedIds = all => ACHIEVEMENTS.filter(x => x.test(all)).map(x => x.id);

export const cleanSpecies = s => s.trim().toLowerCase() || UNKNOWN;

// The title carries the gender ("Don", "Doña", "Mini").
const TITLES = {
  m: ['Don', 'Capitán', 'Sir', 'Señorito', 'Pequeño', 'Príncipe', 'Profe', 'Gran'],
  f: ['Doña', 'Capitana', 'Lady', 'Señorita', 'Pequeña', 'Princesa', 'Profe', 'Gran'],
  x: ['Mini', 'Bebé', 'Peque', 'Súper', 'Profe', 'Gran'],
};
// The word matches the title's grammatical gender ("Don Churro", "Doña Galleta"); unknown gender takes any word.
const WORDS = {
  m: ['Churro', 'Pepinillo', 'Fideo', 'Gofre', 'Mochi', 'Bollito', 'Garbanzo', 'Turrón',
    'Copito', 'Pompón', 'Bigotes', 'Polvorón', 'Bombón', 'Calcetín', 'Pantuflo', 'Cascabel'],
  f: ['Galleta', 'Croqueta', 'Nube', 'Chispa', 'Pelusa', 'Motita', 'Manchitas', 'Canela',
    'Trufa', 'Magdalena', 'Bellota', 'Rosquilla', 'Ensaimada', 'Almendra', 'Pipa', 'Mandarina'],
};

export const randomName = (g = 'x', rnd = Math.random) => {
  const titles = TITLES[g] ?? TITLES.x, words = WORDS[g] ?? [...WORDS.m, ...WORDS.f];
  return `${titles[Math.floor(rnd() * titles.length)]} ${words[Math.floor(rnd() * words.length)]}`;
};

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
  const second = [town, a.county, a.province, a.state_district, a.state].find(v => v && v !== first);
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

// Photo date (DateTimeOriginal, else DateTime) and GPS position from a JPEG's EXIF. Each is null when missing
// (phones often strip GPS from gallery picks). Never throws: a broken EXIF just gives nulls.
export function readExif(buf) {
  const out = { takenAt: null, location: null };
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return out;
    for (let p = 2; p + 10 < v.byteLength;) {
      const marker = v.getUint16(p);
      if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) return readTiff(v, p + 10, out); // "Exif"
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break; // start of image data: no EXIF
      p += 2 + v.getUint16(p + 2);
    }
  } catch {}
  return out;
}

function readTiff(v, t, out) {
  const le = v.getUint16(t) === 0x4949; // "II" = little endian
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const ifd = o => {
    const tags = {};
    for (let i = 0, n = u16(o); i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; }
    return tags;
  };
  const ascii = tag => {
    const off = tag.count > 4 ? u32(tag.at) : tag.at;
    return Array.from({ length: tag.count - 1 }, (_, i) => String.fromCharCode(v.getUint8(t + off + i))).join('');
  };
  const dms = tag => { const off = u32(tag.at), r = i => u32(off + i * 8) / u32(off + i * 8 + 4); return r(0) + r(1) / 60 + r(2) / 3600; };
  const ifd0 = ifd(u32(4));
  const exif = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].at)) : {};
  const date = exif[0x9003] ?? ifd0[0x0132];
  const m = date && ascii(date).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (m) out.takenAt = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  const gps = ifd0[0x8825] ? ifd(u32(ifd0[0x8825].at)) : {};
  if (gps[2] && gps[4]) {
    const lat = dms(gps[2]) * (gps[1] && ascii(gps[1]) === 'S' ? -1 : 1);
    const lon = dms(gps[4]) * (gps[3] && ascii(gps[3]) === 'W' ? -1 : 1);
    if (lat || lon) out.location = { lat, lon };
  }
  return out;
}

// Cleans a cutout mask: keeps the region under the point, plus any other region of the same value at least
// `minShare` of its size (a tail or leg the model split off), and drops the small isolated bits.
// Returns a new mask with 1 = keep, 0 = drop.
export function keepComponent(mask, w, h, p, minShare = 0.15) {
  const v = maskValueAt(mask, w, h, p);
  const label = new Int32Array(w * h).fill(-1), sizes = [], stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== v || label[i] >= 0) continue;
    const id = sizes.length;
    let top = 0, n = 0;
    stack[top++] = i; label[i] = id;
    while (top) {
      const j = stack[--top], x = j % w;
      n++;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < w * h && label[k] < 0 && mask[k] === v) { label[k] = id; stack[top++] = k; }
      }
    }
    sizes.push(n);
  }
  const seed = label[Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w))];
  const keep = sizes.map((n, id) => id === seed || n >= minShare * sizes[seed]);
  return Uint8Array.from(label, id => (id >= 0 && keep[id] ? 1 : 0));
}

// ---------- card treatments (v0.18): all fixed per animal, so a card always looks the same ----------
const hashOf = (id, salt) => [...`${salt}${id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// A soft pattern over the pastel, picked independently of the colour.
export const PATTERNS = ['dots', 'stripes', 'gingham', 'waves', 'hearts', 'paws', 'stars'];
export const patternFor = id => PATTERNS[hashOf(id, 'pattern') % PATTERNS.length];

// Finish of the foil on shinies and legendarios (épico keeps its soft rainbow).
export const FOILS = ['rainbow', 'galaxy', 'gold'];
export const foilFor = a => (a.memory ? 'gold' // her Recuerdos always shine gold
  : a.shiny || rarityFor(a) === 'legendario' ? FOILS[hashOf(a.id, 'foil') % FOILS.length] : null);

// Time of the catch → the photo background. Memories (no catch time) have none.
export function timeOfDay(t) {
  if (!t) return null;
  const h = new Date(t).getHours();
  return h >= 6 && h < 12 ? 'mañana' : h >= 12 && h < 19 ? 'tarde' : h >= 19 && h < 22 ? 'atardecer' : 'noche';
}

// Milestone numbers get a gold stamp: #010, #025, #050, #100, then every hundred.
export const isMilestone = no => [10, 25, 50].includes(no) || (no >= 100 && no % 100 === 0);

// ---------- friendship (v0.19): seeing the same animal again makes you closer ----------
export const FRIEND_LEVELS = [
  { key: 'oro', at: 10, medal: '🥇', label: 'Oro' },
  { key: 'plata', at: 5, medal: '🥈', label: 'Plata' },
  { key: 'bronce', at: 3, medal: '🥉', label: 'Bronce' },
];
export const friendshipOf = a => FRIEND_LEVELS.find(l => timesSeen(a) >= l.at) ?? null;
// The next level and how many more sightings it needs, or null at gold.
export function nextFriendship(a) {
  const next = [...FRIEND_LEVELS].reverse().find(l => timesSeen(a) < l.at);
  return next ? { ...next, left: next.at - timesSeen(a) } : null;
}

// ---------- David's letters (v0.19): unlocked by a moment or a date, opened as an envelope ----------
// Texts are David's, word for word. Moments never count her Recuerdos.
const inJapan = all => catches(all).some(a => a.country === 'jp' || a.visits.some(v => v.country === 'jp'));
export const NOTES = [
  { id: 'first', why: 'Tu primera captura', text: 'Tu primer bichito! Espero que te entretengas mucho con esta app 🙌🏻', test: all => catches(all).length >= 1 },
  { id: 'ten', why: '10 capturas', text: '10 ya! Aún sigues usando la app?', test: all => catches(all).length >= 10 },
  { id: 'fifty', why: '50 capturas', text: 'A este paso tienes mas fotos de bichitos que mías 🤔', test: all => catches(all).length >= 50 },
  { id: 'shiny', why: 'Tu primer shiny', text: 'A quien no le gusta un poco de brilli brilli? ✨', test: all => catches(all).some(a => a.shiny) },
  { id: 'legend', why: 'Tu primer legendario', text: 'Legendario. Será que hoy es tu dia de suerte?', test: all => catches(all).some(a => rarityOf(a.species) === 'legendario') },
  { id: 'night', why: 'Una captura de madrugada', text: 'Que haces fotografiando bichos a estas horas? A la camaaaa', test: all => sightings(all).some(t => hour(t) >= 23 || hour(t) < 6) },
  { id: 'early', why: 'Una captura al amanecer', text: 'Despierta a estas horas seguro que no eres Mari, devuélvele el telefono!', test: all => sightings(all).some(t => hour(t) === 6) },
  { id: 'friend', why: 'Tu primera amistad de oro', text: 'Vas a ser más amiga de éste bichito que de mi? 😱', test: all => catches(all).some(a => friendshipOf(a)?.key === 'oro') },
  { id: 'fav', why: 'Tu primer favorito', text: 'Tu también eres mi favorita', test: all => catches(all).some(a => a.fav) },
  { id: 'japan', why: 'Tu primera captura en Japón', text: 'Quien te iba a decir que volveriamos? 🇯🇵', test: inJapan },
];
// Every year on these days (month 1-12). `skip`: years without it (2026: her birthday greeting already says it).
export const DATE_NOTES = [
  { key: 'santjordi', why: 'Sant Jordi', month: 4, day: 23, text: 'Feliç Sant Jordi! Te quiero ❤️' },
  { key: 'navidad', why: 'Navidad', month: 12, day: 25, text: 'Feliz Navidad! 🎄' },
  { key: 'anonuevo', why: 'Año nuevo', month: 1, day: 1, text: 'Feliz año nuevo! Por muchos mas a tu lado!' },
  { key: 'cumple', why: 'Tu cumpleaños', month: 10, day: 15, text: 'Feliz cumpleaños! 🎁', skip: [2026] },
  { key: 'aniversario', why: 'Nuestro aniversario', month: 4, day: 18, text: 'Feliz aniversario! ❤️' },
];
// Letters that are due now and not opened yet: [{ id, text }]. Date letters get the year in their id.
export function dueNotes(all, now, opened) {
  const d = new Date(now), y = d.getFullYear();
  return [
    ...NOTES.filter(n => n.test(all)).map(n => ({ id: n.id, why: n.why, text: n.text })),
    ...DATE_NOTES.filter(n => n.month === d.getMonth() + 1 && n.day === d.getDate() && !n.skip?.includes(y))
      .map(n => ({ id: `${n.key}-${y}`, why: `${n.why} ${y}`, text: n.text })),
  ].filter(n => !opened.includes(n.id));
}
// The text of an opened letter, by id (for the "Cartas" list).
export const noteText = id => (NOTES.find(n => n.id === id) ?? DATE_NOTES.find(n => id.startsWith(`${n.key}-`)))?.text ?? '';
// Why a letter arrived: "Tu primer shiny", "Sant Jordi 2027"…
export function noteWhy(id) {
  const n = NOTES.find(x => x.id === id);
  if (n) return n.why;
  const d = DATE_NOTES.find(x => id.startsWith(`${x.key}-`));
  return d ? `${d.why} ${id.slice(d.key.length + 1)}` : '';
}

// ---------- sorting the collection (v0.19.8). Her Recuerdos stay first in every order (Kurko, Kiffy). ----------
export const SORTS = { recent: 'Recientes', no: 'Número', name: 'Nombre', rarity: 'Rareza', friend: 'Amistad' };
const ORDER = {
  recent: (a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0),
  no: (a, b) => (a.no ?? 1e9) - (b.no ?? 1e9),
  name: (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  rarity: (a, b) => RARITIES.indexOf(rarityFor(b)) - RARITIES.indexOf(rarityFor(a)) || b.shiny - a.shiny,
  friend: (a, b) => timesSeen(b) - timesSeen(a),
};
export function sortAnimals(list, key = 'recent') {
  const by = ORDER[key] ?? ORDER.recent;
  return [...list].sort((a, b) => (b.memory - a.memory) || (a.memory ? (a.no ?? 0) - (b.no ?? 0) : by(a, b) || ORDER.recent(a, b)));
}

// ---------- backup reminder (v0.20) ----------
// Her data lives only on the phone. Ask (gently) to save a copy after 20 new catches, or a month after the last copy
// (or after her first catch, if she never saved one) when there is something new. "Ahora no" snoozes it for a week.
// backup: { at, count } of the last copy; firstAt: her first catch; snoozeUntil: a time.
export function needsBackupReminder({ count, backup, firstAt, snoozeUntil = 0, now }) {
  const DAY = 864e5;
  if (count < 3 || now < snoozeUntil) return false;
  const since = count - (backup?.count ?? 0);
  if (since <= 0) return false;
  return since >= 20 || now - (backup?.at ?? firstAt ?? now) >= 30 * DAY;
}
export const catchCount = all => catches(all).length;

// ---------- map pin groups (v0.20) ----------
// Points in screen pixels { x, y, ...} → groups of points closer than `radius` (greedy, in the given order).
export function clusterPoints(points, radius = 44) {
  const groups = [];
  for (const p of points) {
    const g = groups.find(g => Math.hypot(g.x - p.x, g.y - p.y) < radius);
    if (g) { g.items.push(p); g.x = (g.x * (g.items.length - 1) + p.x) / g.items.length; g.y = (g.y * (g.items.length - 1) + p.y) / g.items.length; }
    else groups.push({ x: p.x, y: p.y, items: [p] });
  }
  return groups;
}
