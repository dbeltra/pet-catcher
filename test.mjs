import assert from 'node:assert/strict';
import { PASTELS, pastelFor, randomName, pickAnimal, placeName, speciesCounts, cleanSpecies, emojiFor, UNKNOWN, maskValueAt, maskBBox, applyMask } from './lib.mjs';

assert.equal(randomName(() => 0), 'Don Galleta');
assert.match(randomName(), /^\S+ \S+$/);

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

console.log('ok');
