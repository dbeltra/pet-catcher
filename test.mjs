import assert from 'node:assert/strict';
import { randomName, pickAnimal, maskValueAt, maskBBox, applyMask } from './lib.mjs';

assert.equal(randomName(() => 0), 'Sir Biscuit');
assert.match(randomName(), /^\w+ \w+$/);

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

// 8x6 image over the 4x3 mask: the mask scales 2x.
const rgba = new Uint8ClampedArray(8 * 6 * 4).fill(255);
applyMask(rgba, 8, 6, mask, 4, 3, 7);
const alpha = (x, y) => rgba[(y * 8 + x) * 4 + 3];
assert.equal(alpha(0, 0), 0);
assert.equal(alpha(2, 2), 255);
assert.equal(alpha(5, 5), 255);
assert.equal(alpha(6, 5), 0);

console.log('ok');
