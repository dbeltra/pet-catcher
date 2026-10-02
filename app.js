import { FilesetResolver, ObjectDetector, InteractiveSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
import { randomName, pickAnimal, maskValueAt, maskBBox, applyMask } from './lib.mjs';

// Pinned to 0.10.x: 1.0 replaced the keypoint API of InteractiveSegmenter with strokes.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const MAX_SIDE = 1024; // photos are scaled down to this before the models see them
const PAD = 16; // transparent margin around the sticker

const $ = s => document.querySelector(s);

// ---------- models ----------

let models;
function loadModels() {
  models ??= (async () => {
    const fs = await FilesetResolver.forVisionTasks(MP);
    const detector = await ObjectDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${MODELS}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite` },
      runningMode: 'IMAGE', scoreThreshold: 0.3, maxResults: 5,
    });
    const segmenter = await InteractiveSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${MODELS}/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite` },
      outputCategoryMask: true, outputConfidenceMasks: false,
    });
    return { detector, segmenter };
  })().catch(e => { models = undefined; throw e; });
  return models;
}

// ---------- storage (IndexedDB, one store) ----------

const db = new Promise((res, rej) => {
  const r = indexedDB.open('pet-catcher', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('animals', { keyPath: 'id' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function store(mode, fn) {
  const s = (await db).transaction('animals', mode).objectStore('animals');
  return new Promise((res, rej) => { const r = fn(s); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const getAll = () => store('readonly', s => s.getAll());
const put = a => store('readwrite', s => s.put(a));
const remove = id => store('readwrite', s => s.delete(id));

// ---------- image work ----------

async function toCanvas(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

// Cut out the object under the normalized point. Resolves to a PNG blob, or null if nothing was found.
function cutout(segmenter, img, point) {
  let mask, w, h;
  segmenter.segment(img, { keypoint: point }, r => {
    mask = r.categoryMask.getAsUint8Array().slice(); // copy: the mask is freed after the callback
    w = r.categoryMask.width;
    h = r.categoryMask.height;
  });
  const fg = maskValueAt(mask, w, h, point);
  const box = maskBBox(mask, w, h, fg);
  if (!box) return Promise.resolve(null);

  const W = img.width, H = img.height;
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  const ctx = full.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H);
  applyMask(px.data, W, H, mask, w, h, fg);
  ctx.putImageData(px, 0, 0);

  const sx = W / w, sy = H / h;
  const bx = Math.floor(box.x * sx), by = Math.floor(box.y * sy);
  const bw = Math.ceil(box.w * sx), bh = Math.ceil(box.h * sy);
  const out = document.createElement('canvas');
  out.width = bw + 2 * PAD; out.height = bh + 2 * PAD;
  out.getContext('2d').drawImage(full, bx, by, bw, bh, PAD, PAD, bw, bh);
  return new Promise(res => out.toBlob(res, 'image/png'));
}

const boxCenter = (b, img) => ({ x: (b.originX + b.width / 2) / img.width, y: (b.originY + b.height / 2) / img.height });

// Show the photo and wait for one tap on the animal.
function askTap(img, text) {
  status(text);
  const stage = $('#stage');
  stage.replaceChildren(img);
  return new Promise(res => {
    img.onclick = e => {
      const r = img.getBoundingClientRect();
      stage.replaceChildren();
      res({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    };
  });
}

const getLocation = () => new Promise(res => {
  if (!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(
    p => res({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
    () => res(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
});

// ---------- UI ----------

let urls = [];
const blobUrl = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

const status = t => { $('#status').textContent = t; $('#status').hidden = !t; };

function showView(name) {
  $('#list').hidden = name !== 'list';
  $('#view').hidden = name !== 'view';
  $('#shoot').hidden = name !== 'list';
  if (name === 'view') { $('#stage').replaceChildren(); $('#card').replaceChildren(); status(''); }
}

function button(text, onclick, cls = '') {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = onclick; b.className = cls;
  return b;
}

function fmtWhere(loc) {
  if (!loc) return document.createTextNode('No location');
  const a = document.createElement('a');
  a.href = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=17/${loc.lat}/${loc.lon}`;
  a.target = '_blank'; a.rel = 'noopener';
  a.textContent = `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (±${loc.accuracy} m)`;
  return a;
}

// Big card, used for the new-catch preview and for the detail view.
function renderCard(a, actions) {
  const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
  card.querySelector('.sticker').src = blobUrl(a.sticker);
  card.querySelector('.name').value = a.name;
  card.querySelector('.species').textContent = a.species;
  card.querySelector('.when').textContent = new Date(a.takenAt).toLocaleString();
  card.querySelector('.where').replaceChildren(fmtWhere(a.location));
  card.querySelector('.actions').append(...actions);
  $('#card').replaceChildren(card);
  return card.querySelector('.name');
}

async function renderList() {
  freeUrls();
  const all = (await getAll()).sort((a, b) => b.takenAt - a.takenAt);
  $('#count').textContent = all.length ? `${all.length} caught` : '';
  $('#empty').hidden = all.length > 0;
  $('#grid').replaceChildren(...all.map(a => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector('img').src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.meta').textContent = `${a.species} · ${new Date(a.takenAt).toLocaleDateString()}`;
    el.onclick = () => openDetail(a);
    return el;
  }));
}

function backToList() { showView('list'); renderList(); }

function openDetail(a) {
  showView('view');
  const name = renderCard(a, [
    button('Back', backToList),
    button('Release', async () => {
      if (!confirm(`Release ${a.name}? This deletes it.`)) return;
      await remove(a.id);
      backToList();
    }, 'danger'),
  ]);
  name.onchange = () => { a.name = name.value.trim() || randomName(); name.value = a.name; put(a); };
}

async function onPhoto(file) {
  showView('view');
  const where = getLocation(); // ask early, it runs while the models work
  const takenAt = Date.now();
  try {
    status('Loading the animal spotter… (about 13 MB the first time)');
    const img = await toCanvas(file);
    img.className = 'photo';
    const { detector, segmenter } = await loadModels();

    status('Looking for an animal…');
    const hit = pickAnimal(detector.detect(img).detections);
    let species = hit?.name ?? 'mystery critter';
    let point = hit ? boxCenter(hit.box, img) : await askTap(img, 'No animal found. Tap the animal in the photo.');

    status('Cutting it out…');
    let sticker = await cutout(segmenter, img, point);
    while (!sticker) {
      point = await askTap(img, 'Could not cut that out. Tap the animal again.');
      sticker = await cutout(segmenter, img, point);
    }

    const a = { id: crypto.randomUUID(), name: randomName(), species, sticker, takenAt, location: await where };
    status('');
    const showPreview = () => {
      const name = renderCard(a, [
        button('Discard', backToList),
        button('Re-cut', async () => {
          $('#card').replaceChildren();
          const p = await askTap(img, 'Tap the animal to cut it out again.');
          a.sticker = (await cutout(segmenter, img, p)) ?? a.sticker;
          status('');
          showPreview();
        }),
        button('Keep', async () => {
          a.name = name.value.trim() || a.name;
          await put(a);
          navigator.storage?.persist?.();
          backToList();
        }, 'primary'),
      ]);
    };
    showPreview();
  } catch (e) {
    console.error(e);
    status(`Something went wrong: ${e.message ?? e}`);
    $('#card').replaceChildren(button('Back', backToList));
  }
}

$('#file').onchange = e => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (file) onPhoto(file);
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
renderList();
