import { FilesetResolver, ObjectDetector, InteractiveSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
import { COCO_ES, EMOJI, UNKNOWN, emojiFor, cleanSpecies, randomName, pickAnimal, placeName, speciesCounts, maskValueAt, maskBBox, applyMask } from './lib.mjs';

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
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
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
    p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => res(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
});

// Only the place name is kept. Coordinates stay on the record just until a lookup succeeds
// (no signal at catch time): renderList retries, then drops them.
async function resolvePlace(a) {
  if (a.place || !a.location || !navigator.onLine) return false;
  try {
    const { lat, lon } = a.location;
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${lat}&lon=${lon}`,
      { signal: AbortSignal.timeout(8000) });
    a.place = placeName(await r.json()) ?? 'Un lugar sin nombre';
    delete a.location;
    return true;
  } catch { return false; }
}

// ---------- UI ----------

let urls = [];
const blobUrl = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

const status = t => { $('#status').textContent = t; $('#status').hidden = !t; };
const fmtWhen = t => new Date(t).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const fmtWhere = a => a.place ?? (a.location ? 'Buscando el nombre del lugar…' : 'Lugar desconocido');

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

// Suggestions for the species field: the built-in list plus every species already caught.
async function fillSpeciesList() {
  const used = (await getAll()).map(a => a.species);
  $('#species-list').replaceChildren(...[...new Set([...Object.keys(EMOJI), ...used])]
    .filter(s => s !== UNKNOWN).sort().map(s => new Option(s)));
}

// Big card, used for the new-catch preview and for the detail view.
function renderCard(a, actions) {
  const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const q = s => card.querySelector(s);
  q('.sticker').src = blobUrl(a.sticker);
  q('.name').value = a.name;
  q('.species').value = a.species === UNKNOWN ? '' : a.species;
  q('.species').placeholder = '¿Qué bichito es?';
  q('.emoji').textContent = emojiFor(a.species);
  q('.species').oninput = () => { q('.emoji').textContent = emojiFor(cleanSpecies(q('.species').value)); };
  q('.when').textContent = fmtWhen(a.takenAt);
  q('.where').textContent = fmtWhere(a);
  q('.actions').append(...actions);
  $('#card').replaceChildren(card);
  fillSpeciesList();
  return { name: q('.name'), species: q('.species'), where: q('.where') };
}

let filter = null; // species shown in the list, null = all

async function renderList() {
  freeUrls();
  const all = (await getAll()).sort((a, b) => b.takenAt - a.takenAt);
  const counts = speciesCounts(all);
  if (!counts.some(([s]) => s === filter)) filter = null;

  $('#count').textContent = all.length ? `${all.length} ${all.length === 1 ? 'atrapado' : 'atrapados'}` : '';
  $('#empty').hidden = all.length > 0;
  $('#filters').hidden = counts.length < 2;
  const chip = (label, value) => button(label, () => { filter = value; renderList(); }, `chip${filter === value ? ' on' : ''}`);
  $('#filters').replaceChildren(chip(`✨ Todos ${all.length}`, null),
    ...counts.map(([s, n]) => chip(`${emojiFor(s)} ${s} ${n}`, s)));

  $('#grid').replaceChildren(...all.filter(a => !filter || a.species === filter).map(a => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector('img').src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.meta').textContent = `${emojiFor(a.species)} ${a.species}`;
    el.onclick = () => openDetail(a);
    return el;
  }));

  // Name the places of catches made without signal. One at a time: Nominatim allows 1 request/s.
  for (const a of all) if (await resolvePlace(a)) await put(a);
}

function backToList() { showView('list'); renderList(); }

function openDetail(a) {
  showView('view');
  const f = renderCard(a, [
    button('Volver', backToList),
    button('Liberar', async () => {
      if (!confirm(`¿Liberar a ${a.name}? Se borrará de tu colección.`)) return;
      await remove(a.id);
      backToList();
    }, 'danger'),
  ]);
  f.name.onchange = () => { a.name = f.name.value.trim() || randomName(); f.name.value = a.name; put(a); };
  f.species.onchange = () => { a.species = cleanSpecies(f.species.value); put(a); };
}

async function onPhoto(file) {
  showView('view');
  const where = getLocation(); // ask early, it runs while the models work
  const takenAt = Date.now();
  try {
    status('Despertando al detector de bichitos… (◕‿◕) La primera vez descarga unos 13 MB.');
    const img = await toCanvas(file);
    img.className = 'photo';
    const { detector, segmenter } = await loadModels();

    status('Buscando al bichito… (・・ ) ?');
    const hit = pickAnimal(detector.detect(img).detections);
    const species = hit ? COCO_ES[hit.name] : UNKNOWN;
    let point = hit ? boxCenter(hit.box, img) : await askTap(img, 'No lo encuentro (｡•́︿•̀｡) Toca al animal en la foto.');

    status('Recortando con cuidado… ✂️');
    let sticker = await cutout(segmenter, img, point);
    while (!sticker) {
      point = await askTap(img, 'Ups, no he podido recortarlo. Toca al animal otra vez.');
      sticker = await cutout(segmenter, img, point);
    }

    const a = { id: crypto.randomUUID(), name: randomName(), species, sticker, takenAt, place: null, location: await where };
    status('');
    const placed = resolvePlace(a);
    const showPreview = () => {
      const f = renderCard(a, [
        button('Descartar', backToList),
        button('Recortar otra vez', async () => {
          $('#card').replaceChildren();
          const p = await askTap(img, 'Toca al animal para recortarlo otra vez.');
          a.sticker = (await cutout(segmenter, img, p)) ?? a.sticker;
          status('');
          showPreview();
        }),
        button('¡Me lo quedo! 💖', async () => {
          a.name = f.name.value.trim() || a.name;
          a.species = cleanSpecies(f.species.value);
          await put(a); // if the place lookup is still running, renderList retries it
          navigator.storage?.persist?.();
          backToList();
        }, 'primary'),
      ]);
      placed.then(ok => { f.where.textContent = ok || !a.location ? fmtWhere(a) : 'Sin conexión: le pondré nombre más tarde 📡'; });
    };
    showPreview();
  } catch (e) {
    console.error(e);
    status(`Algo ha ido mal (╥﹏╥) ${e.message ?? e}`);
    $('#card').replaceChildren(button('Volver', backToList));
  }
}

$('#file').onchange = e => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (file) onPhoto(file);
};

$('#version').textContent = `v${self.VERSION}`;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); // else GitHub Pages' 10 min HTTP cache delays updates
renderList();
