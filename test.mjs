import assert from 'node:assert/strict';
import { FRIEND_LEVELS, friendshipOf, nextFriendship, NOTES, DATE_NOTES, dueNotes, noteText, noteWhy, PATTERNS, patternFor, FOILS, foilFor, timeOfDay, isMilestone, keepComponent, readExif, numberAll, fmtNo, SEEDS, SHINY_CHANCE, rollShiny, ACHIEVEMENTS, unlockedIds, timesSeen, lastSeen, RARITIES, rarityOf, rarityFor, albumSlots, TRAITS, randomTraits, traitLabel, traitKey, normalize, byNewest, parseBackup, PASTELS, pastelFor, randomName, pickAnimal, placeName, speciesCounts, cleanSpecies, emojiFor, UNKNOWN, maskValueAt, maskBBox, applyMask } from './lib.mjs';

assert.equal(randomName('m', () => 0), 'Don Galleta');
assert.equal(randomName('f', () => 0), 'Doña Galleta');
assert.equal(randomName('x', () => 0), 'Mini Galleta');
assert.equal(randomName(undefined, () => 0), 'Mini Galleta');
assert.match(randomName(), /^\S+ \S+$/);
assert.deepEqual(['m', 'f', 'x'].map(g => traitLabel('Glotón', g)), ['Glotón', 'Glotona', 'Glotón/a']);
assert.deepEqual(['m', 'f', 'x'].map(g => traitLabel('Valiente', g)), ['Valiente', 'Valiente', 'Valiente']);
assert.equal(traitLabel('Saltarín', 'f'), 'Saltarín'); // typed by her: shown as stored
assert.deepEqual(['Glotón', 'Glotona', 'Glotón/a', ' Dormilona '].map(traitKey), ['Glotón', 'Glotón', 'Glotón', 'Dormilón']);
assert.equal(traitKey('Saltarina'), 'Saltarina');

assert.deepEqual(normalize({ id: 'x', fav: true }), { fav: true, traits: [], visits: [], memory: false, shiny: false, gender: 'x', nameAuto: false, id: 'x' });
{
  const recs = [{ id: 'c2', takenAt: 20 }, { id: 'seed-kiffy', memory: true }, { id: 'c1', takenAt: 10 }, { id: 'seed-kurko', memory: true }].map(normalize);
  assert.equal(numberAll(recs).length, 4);
  assert.deepEqual(Object.fromEntries(recs.map(a => [a.id, a.no])), { 'seed-kurko': 1, 'seed-kiffy': 2, c1: 3, c2: 4 });
  assert.deepEqual([...recs].sort(byNewest).map(a => a.id), ['seed-kurko', 'seed-kiffy', 'c2', 'c1']);
  recs.push(normalize({ id: 'c3', takenAt: 30 }));
  assert.deepEqual(numberAll(recs).map(a => [a.id, a.no]), [['c3', 5]]); // existing numbers never change
  assert.equal(fmtNo(5), '#005');
}
assert.ok(SEEDS.every(s => s.gender === 'm'));
assert.ok(SEEDS.every(s => s.place === 'Martos, Jaén' && Math.abs(s.location.lat - 37.7197) < 1e-3 && Math.abs(s.location.lon + 3.9697) < 1e-3));
assert.equal(rollShiny(() => SHINY_CHANCE - 0.001), true);
assert.equal(rollShiny(() => SHINY_CHANCE), false);

assert.deepEqual([{ id: 'old', takenAt: 1 }, { id: 'mem', memory: true, takenAt: null }, { id: 'new', takenAt: 5 }]
  .map(normalize).sort(byNewest).map(a => a.id), ['mem', 'new', 'old']);
assert.equal(parseBackup(JSON.stringify({ app: 'pet-catcher', animals: [{ id: 'a', sticker: 'data:image/png;base64,AA' }] })).animals.length, 1);
assert.throws(() => parseBackup('not json'), /no es una copia/);
assert.throws(() => parseBackup('{"app":"other","animals":[]}'), /no es una copia/);
assert.throws(() => parseBackup('{"app":"pet-catcher","animals":[{"id":"a","sticker":"http://x"}]}'), /no es una copia/);

assert.equal(rarityOf('gato'), 'común');
assert.equal(rarityOf('ciervo'), 'épico');
assert.equal(rarityOf('dragón'), 'raro'); // custom species
assert.equal(rarityFor({ species: 'gato', memory: true }), 'legendario');
const slots = albumSlots([{ species: 'gato', id: 'new' }, { species: 'gato', id: 'old' }, { species: 'dragón', id: 'd' }]);
assert.equal(slots.find(s => s.species === 'gato').count, 2);
assert.equal(slots.find(s => s.species === 'gato').latest.id, 'new'); // input is newest first
assert.equal(slots.at(-1).species, 'dragón'); // custom species go last
assert.equal(slots.find(s => s.species === 'zorro').count, 0);
assert.ok(!slots.some(s => s.species === 'bichito misterioso'));
assert.deepEqual([...new Set(slots.map(s => s.rarity))], RARITIES); // grouped by rarity
const tr = randomTraits();
assert.equal(tr.length, 3);
assert.equal(new Set(tr.map(t => t.name)).size, 3);
assert.ok(tr.every(t => TRAITS.includes(t.name) && t.stars >= 1 && t.stars <= 5));

const at = h => new Date(2026, 9, 2, h).getTime();
const cat = (o = {}) => normalize({ id: Math.random().toString(), species: 'gato', takenAt: at(12), ...o });
assert.deepEqual(unlockedIds([cat({ memory: true, takenAt: null })]), []); // memories never count
assert.deepEqual(unlockedIds([cat()]), ['first']);
assert.ok(unlockedIds([cat({ takenAt: at(23) })]).includes('night'));
assert.ok(unlockedIds([cat({ visits: [{ at: at(7) }] })]).includes('early')); // visits count as sightings
assert.ok(unlockedIds([cat({ species: 'ciervo' })]).includes('epic'));
assert.ok(unlockedIds([cat({ shiny: true })]).includes('shiny'));
assert.ok(!unlockedIds([cat({ shiny: true, memory: true })]).includes('shiny'));
assert.ok(unlockedIds(['a', 'b', 'c'].map(p => cat({ place: p }))).includes('travel'));
assert.ok(unlockedIds([cat({ visits: [{ at: 1 }, { at: 2 }] })]).includes('loyal'));
assert.ok(unlockedIds(Array.from({ length: 5 }, () => cat())).includes('cats'));
assert.equal(new Set(ACHIEVEMENTS.map(x => x.id)).size, ACHIEVEMENTS.length);
assert.equal(timesSeen(cat({ visits: [{ at: 1 }] })), 2);
assert.equal(lastSeen(cat({ takenAt: 5, visits: [{ at: 9 }, { at: 7 }] })), 9);

assert.equal(pastelFor('abc'), pastelFor('abc'));
assert.ok(PASTELS.includes(pastelFor(crypto.randomUUID())));
assert.equal(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(pastelFor)).size > 1, true);

assert.equal(cleanSpecies('  Ciervo '), 'ciervo');
assert.equal(cleanSpecies(''), UNKNOWN);
assert.equal(emojiFor('ciervo'), '🦌');
assert.equal(emojiFor('dragón'), '🐾');

// Real Nominatim responses (trimmed).
assert.equal(placeName({ name: 'Sitges', address: { town: 'Sitges', county: 'Garraf', state: 'Cataluña' } }), 'Sitges, Garraf');
assert.equal(placeName({ name: 'Carxol', address: { hamlet: 'Carxol', village: 'Begues', county: 'Bajo Llobregat' } }), 'Carxol, Begues');
assert.equal(placeName({ name: 'Sol', address: { quarter: 'Sol', city: 'Madrid', state: 'Comunidad de Madrid' } }), 'Sol, Madrid');
assert.equal(placeName({ name: '', address: { county: 'Garraf', state: 'Cataluña' } }), 'Garraf, Cataluña');
assert.equal(placeName({ name: 'Martos', address: { town: 'Martos', province: 'Jaén', state: 'Andalucía' } }), 'Martos, Jaén');
assert.equal(placeName({ error: 'Unable to geocode' }), null);

assert.deepEqual(speciesCounts([{ species: 'gato' }, { species: 'perro' }, { species: 'gato' }, { species: 'ciervo' }]),
  [['gato', 2], ['ciervo', 1], ['perro', 1]]);

const box = { originX: 1, originY: 2, width: 3, height: 4 };
assert.equal(pickAnimal([]), null);
assert.equal(pickAnimal([{ categories: [{ categoryName: 'teddy bear', score: 0.9 }], boundingBox: box }]), null);
assert.deepEqual(
  pickAnimal([
    { categories: [{ categoryName: 'person', score: 0.99 }], boundingBox: box },
    { categories: [{ categoryName: 'cat', score: 0.5 }], boundingBox: box },
    { categories: [{ categoryName: 'dog', score: 0.8 }], boundingBox: box },
  ]),
  { name: 'dog', score: 0.8, box });

// 4x3 mask, object (value 7) in the middle two columns of the bottom two rows.
const mask = Uint8Array.from([0, 0, 0, 0, 0, 7, 7, 0, 0, 7, 7, 0]);
assert.equal(maskValueAt(mask, 4, 3, { x: 0.5, y: 0.9 }), 7);
assert.equal(maskValueAt(mask, 4, 3, { x: 1, y: 1 }), 0); // clamps the edge
assert.deepEqual(maskBBox(mask, 4, 3, 7), { x: 1, y: 1, w: 2, h: 2 });
assert.equal(maskBBox(mask, 4, 3, 9), null);
assert.equal(maskBBox(mask, 4, 3, 0, 0.5), null); // 8/12 of the mask > 0.5: the point hit background
assert.ok(maskBBox(mask, 4, 3, 0, 0.9)); // 8/12 < 0.9: still a valid object

// 8x6 image over the 4x3 mask: the mask scales 2x.
const rgba = new Uint8ClampedArray(8 * 6 * 4).fill(255);
applyMask(rgba, 8, 6, mask, 4, 3, 7);
const alpha = (x, y) => rgba[(y * 8 + x) * 4 + 3];
assert.equal(alpha(0, 0), 0);
assert.equal(alpha(2, 2), 255);
assert.equal(alpha(5, 5), 255);
assert.equal(alpha(6, 5), 0);

// A hand-made little-endian JPEG: IFD0 → Exif IFD (DateTimeOriginal) and GPS IFD (37°43'10.8"N 3°58'10.8"W).
{
  const tiff = [];
  const w16 = (o, x) => { tiff[o] = x & 255; tiff[o + 1] = x >> 8; };
  const w32 = (o, x) => { for (let i = 0; i < 4; i++) tiff[o + i] = (x >>> (8 * i)) & 255; };
  const entry = (o, tag, type, count, value) => { w16(o, tag); w16(o + 2, type); w32(o + 4, count); w32(o + 8, value); };
  w16(0, 0x4949); w16(2, 42); w32(4, 8);
  w16(8, 2); entry(10, 0x8769, 4, 1, 38); entry(22, 0x8825, 4, 1, 56); w32(34, 0);  // IFD0 at 8
  w16(38, 1); entry(40, 0x9003, 2, 20, 120); w32(52, 0);                           // Exif IFD at 38
  w16(56, 4); entry(58, 1, 2, 2, 0x4e); entry(70, 2, 5, 3, 160); entry(82, 3, 2, 2, 0x57); entry(94, 4, 5, 3, 184); w32(106, 0); // GPS IFD at 56
  [...'2024:05:17 21:30:05\0'].forEach((c, i) => { tiff[120 + i] = c.charCodeAt(0); });
  [[37, 1], [43, 1], [108, 10], [3, 1], [58, 1], [108, 10]].forEach(([n, d], i) => { w32(160 + i * 8, n); w32(164 + i * 8, d); });
  const body = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat(Array.from({ length: 208 }, (_, i) => tiff[i] ?? 0));
  const jpeg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body, 0xFF, 0xD9]);
  const x = readExif(jpeg.buffer);
  assert.equal(x.takenAt, new Date(2024, 4, 17, 21, 30, 5).getTime());
  assert.ok(Math.abs(x.location.lat - 37.7197) < 1e-3 && Math.abs(x.location.lon + 3.9697) < 1e-3, JSON.stringify(x.location));
  assert.deepEqual(readExif(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xDA, 0, 2, 0, 0, 0, 0, 0, 0]).buffer), { takenAt: null, location: null });
  assert.deepEqual(readExif(new ArrayBuffer(4)), { takenAt: null, location: null });
}

// 6x4 mask: the pet (7) is a 2x3 block plus a 1-pixel speck far away and a 1-pixel bit touching it.
{
  const m = Uint8Array.from([
    7, 7, 0, 0, 0, 7,
    7, 7, 7, 0, 0, 0,
    7, 7, 0, 0, 0, 0,
    0, 0, 0, 0, 7, 7,
  ]);
  const k = keepComponent(m, 6, 4, { x: 0.1, y: 0.1 });
  assert.deepEqual([...k], [1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]); // 1-px speck dropped, 2-px piece kept (2 ≥ 15% of 7)
  assert.equal(keepComponent(m, 6, 4, { x: 0.1, y: 0.1 }, 0.5)[22], 0); // with a stricter share it goes too
}

{
  const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
  assert.equal(patternFor('abc'), patternFor('abc'));
  assert.deepEqual(new Set(ids.map(patternFor)).size, PATTERNS.length); // every pattern is used
  assert.equal(foilFor(normalize({ id: 'x', species: 'gato' })), null);
  assert.ok(FOILS.includes(foilFor(normalize({ id: 'x', species: 'gato', shiny: true }))));
  assert.ok(FOILS.includes(foilFor(normalize({ id: 'x', species: 'jirafa' }))));
  assert.equal(foilFor(normalize({ id: 'x', species: 'zorro' })), null); // épico: soft rainbow only
  assert.ok(ids.every(id => foilFor(normalize({ id, species: 'perro', memory: true })) === 'gold'));
  assert.deepEqual(new Set(ids.map(id => foilFor(normalize({ id, species: 'gato', shiny: true })))).size, FOILS.length);
  const at = h => new Date(2026, 9, 5, h).getTime();
  assert.deepEqual([6, 11, 12, 18, 19, 21, 22, 3].map(h => timeOfDay(at(h))), ['mañana', 'mañana', 'tarde', 'tarde', 'atardecer', 'atardecer', 'noche', 'noche']);
  assert.equal(timeOfDay(null), null);
  assert.deepEqual([9, 10, 25, 50, 99, 100, 150, 200].map(isMilestone), [false, true, true, true, false, true, false, true]);
}

{
  const seen = n => normalize({ id: 'f', species: 'gato', takenAt: 1, visits: Array.from({ length: n - 1 }, (_, i) => ({ at: i + 2 })) });
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 15].map(n => friendshipOf(seen(n))?.key ?? null), [null, null, 'bronce', 'bronce', 'plata', 'plata', 'oro', 'oro']);
  assert.deepEqual(nextFriendship(seen(4)), { ...FRIEND_LEVELS[1], left: 1 });
  assert.equal(nextFriendship(seen(10)), null);

  const at = (m, d, h = 12, y = 2026) => new Date(y, m - 1, d, h).getTime();
  const c = (o = {}) => normalize({ id: Math.random().toString(), species: 'gato', takenAt: at(10, 20), ...o });
  const ids = (all, now = at(10, 20), opened = []) => dueNotes(all, now, opened).map(n => n.id);
  assert.deepEqual(ids([normalize({ id: 'seed-kurko', species: 'perro', memory: true, fav: true })]), []); // memories don't count
  assert.deepEqual(ids([c()]), ['first']);
  assert.deepEqual(ids([c()], at(10, 20), ['first']), []); // opened: never again
  assert.ok(ids([c({ fav: true })]).includes('fav'));
  assert.ok(ids([c({ shiny: true })]).includes('shiny'));
  assert.ok(ids([c({ species: 'jirafa' })]).includes('legend'));
  assert.ok(ids([c({ takenAt: at(10, 20, 23) })]).includes('night'));
  assert.ok(ids([c({ takenAt: at(10, 20, 2) })]).includes('night'));
  assert.ok(!ids([c({ takenAt: at(10, 20, 22) })]).includes('night'));
  assert.ok(ids([c({ visits: [{ at: at(10, 21, 6) }] })]).includes('early'));
  assert.ok(!ids([c({ takenAt: at(10, 20, 7) })]).includes('early'));
  assert.ok(ids([c({ country: 'jp' })]).includes('japan'));
  assert.ok(ids([c({ visits: [{ at: 5, country: 'jp' }] })]).includes('japan'));
  assert.ok(ids(Array.from({ length: 10 }, () => c())).includes('ten'));
  assert.ok(ids([seen(10)]).includes('friend'));
  // dates: every year, the birthday skips 2026
  assert.deepEqual(ids([], at(4, 23, 9, 2027)), ['santjordi-2027']);
  assert.deepEqual(ids([], at(10, 15, 9, 2026)), []);
  assert.deepEqual(ids([], at(10, 15, 9, 2027)), ['cumple-2027']);
  assert.deepEqual(ids([], at(4, 18, 9, 2027), ['aniversario-2027']), []);
  assert.equal(noteText('cumple-2027'), 'Feliz cumpleaños! 🎁');
  assert.equal(noteText('first'), NOTES[0].text);
  assert.equal(DATE_NOTES.length, 5);
  assert.equal(noteWhy('shiny'), 'Tu primer shiny');
  assert.equal(noteWhy('santjordi-2027'), 'Sant Jordi 2027');
  assert.equal(dueNotes([], at(4, 23, 9, 2027), [])[0].why, 'Sant Jordi 2027');
  assert.ok([...NOTES, ...DATE_NOTES].every(n => n.why));
}

console.log('ok');
