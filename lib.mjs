// Pure helpers, no DOM. Tested by test.mjs (node test.mjs).

// The COCO animal classes EfficientDet knows. "teddy bear" is left out on purpose.
export const ANIMALS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);

const ADJ = ['Sir', 'Captain', 'Little', 'Fluffy', 'Grumpy', 'Sneaky', 'Lady', 'Professor', 'Tiny', 'Mighty', 'Sleepy', 'Wild'];
const NOUN = ['Biscuit', 'Pickles', 'Noodle', 'Waffles', 'Pebble', 'Muffin', 'Taco', 'Bean', 'Sprout', 'Nugget', 'Pudding', 'Ziggy'];

export const randomName = (rnd = Math.random) =>
  `${ADJ[Math.floor(rnd() * ADJ.length)]} ${NOUN[Math.floor(rnd() * NOUN.length)]}`;

// Best-scoring animal across all detections, or null.
export function pickAnimal(detections) {
  const hits = detections.flatMap(d =>
    d.categories.filter(c => ANIMALS.has(c.categoryName))
      .map(c => ({ name: c.categoryName, score: c.score, box: d.boundingBox })));
  return hits.sort((a, b) => b.score - a.score)[0] ?? null;
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
