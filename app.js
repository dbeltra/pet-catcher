import { FilesetResolver, ObjectDetector, InteractiveSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
import { COCO_ES, EMOJI, UNKNOWN, SEEDS, rollShiny, ACHIEVEMENTS, unlockedIds, timesSeen, lastSeen, RARITY_LABEL, rarityFor, albumSlots, TRAITS, randomTraits, emojiFor, pastelFor, cleanSpecies, normalize, byNewest, parseBackup, randomName, pickAnimal, placeName, speciesCounts, maskValueAt, maskBBox, applyMask } from './lib.mjs';

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

// ---------- storage (IndexedDB: `animals`, and `meta` for small app state) ----------

const db = new Promise((res, rej) => {
  const r = indexedDB.open('pet-catcher', 2);
  r.onupgradeneeded = () => { // create only what is missing: never drop `animals`
    const d = r.result;
    if (!d.objectStoreNames.contains('animals')) d.createObjectStore('animals', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function store(name, mode, fn) {
  const s = (await db).transaction(name, mode).objectStore(name);
  return new Promise((res, rej) => { const r = fn(s); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const getAll = async () => (await store('animals', 'readonly', s => s.getAll())).map(normalize);
const put = a => store('animals', 'readwrite', s => s.put(a));
const remove = id => store('animals', 'readwrite', s => s.delete(id));
const getMeta = k => store('meta', 'readonly', s => s.get(k));
const setMeta = (k, v) => store('meta', 'readwrite', s => s.put(v, k));
async function getAllMeta() {
  const [keys, values] = await Promise.all([store('meta', 'readonly', s => s.getAllKeys()), store('meta', 'readonly', s => s.getAll())]);
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

// Her past pets are part of the app: any that is missing (first open, cleared data) comes back.
// A memory still showing an older seed photo (the emoji placeholder) gets the new one, unless the photo was
// changed by hand ("📷 Foto" sets `customPhoto`).
async function ensureMemories() {
  const have = new Map((await getAll()).map(a => [a.id, a]));
  for (const s of SEEDS) {
    const a = have.get(s.id);
    if (a && (a.customPhoto || (a.seedPhoto ?? 1) >= s.photo)) continue;
    const sticker = await (await fetch(s.file)).blob();
    await put(a ? { ...a, sticker, seedPhoto: s.photo }
      : normalize({ id: s.id, name: s.name, species: s.species, sticker, seedPhoto: s.photo, memory: true, fav: true, takenAt: null, place: null, location: null, traits: randomTraits() }));
  }
}

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

// The card shows only the place name; the coordinates are kept for the map.
// No signal at catch time: renderList retries the lookup.
async function resolvePlace(a) {
  if (a.place || !a.location || !navigator.onLine) return false;
  try {
    const { lat, lon } = a.location;
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${lat}&lon=${lon}`,
      { signal: AbortSignal.timeout(8000) });
    a.place = placeName(await r.json()) ?? 'Un lugar sin nombre';
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

let toastTimer;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function showView(name) {
  $('#tabs').hidden = name !== 'list';
  $('#list').hidden = name !== 'list';
  $('#view').hidden = name !== 'view';
  $('#shoot').hidden = name !== 'list';
  $('#footer').hidden = name !== 'list';
  if (name === 'view') { $('#stage').replaceChildren(); $('#card').replaceChildren(); status(''); $('#view').scrollTop = 0; }
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

// Big card, used for the new-catch preview and for the detail view. `save` runs after each edit (detail only).
// `close`: what a swipe down does (detail only; a new catch is never discarded by a swipe).
function renderCard(a, actions, save = () => {}, close = null) {
  const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const q = s => card.querySelector(s);
  card.style.setProperty('--pastel', pastelFor(a.id)); // same colour as its tile
  card.classList.toggle('memory', a.memory);
  const paintRarity = () => {
    card.dataset.rarity = rarityFor(a);
    q('.rarity').textContent = RARITY_LABEL[rarityFor(a)] + (a.shiny ? ' · ✨ Shiny' : '');
  };
  card.classList.toggle('shiny', a.shiny);
  paintRarity();
  q('.sticker').src = blobUrl(a.sticker);
  tag(card, true);
  q('.name').value = a.name;
  q('.species').value = a.species === UNKNOWN ? '' : a.species;
  q('.species').placeholder = '¿Qué bichito es?';
  q('.emoji').textContent = emojiFor(a.species);
  // The species field is as wide as its text, so the emoji and the word sit centred together.
  const fitSpecies = () => { q('.species').style.width = `${(q('.species').value || q('.species').placeholder).length + 1}ch`; };
  q('.species').oninput = () => { q('.emoji').textContent = emojiFor(cleanSpecies(q('.species').value)); fitSpecies(); };
  fitSpecies();
  q('.when').textContent = a.memory ? 'Un recuerdo para siempre' : fmtWhen(a.takenAt);
  q('.where').textContent = fmtWhere(a);
  q('.where').hidden = a.memory && !a.place;
  q('.seen').hidden = !a.visits.length;
  if (a.visits.length) {
    const last = a.visits.reduce((x, y) => (y.at > x.at ? y : x));
    q('.seen').textContent = `Visto ${timesSeen(a)} veces · la última el ${new Date(lastSeen(a)).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`
      + (last.place ? ` en ${last.place}` : '');
  }
  q('.note').value = a.note;
  const fav = q('.fav');
  const paintFav = () => { fav.textContent = a.fav ? '❤️' : '🤍'; fav.classList.toggle('on', a.fav); };
  paintFav();
  fav.onclick = () => {
    a.fav = !a.fav;
    paintFav();
    if (a.fav) fav.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    save();
  };
  q('.name').onchange = () => { a.name = q('.name').value.trim() || a.name; q('.name').value = a.name; save(); };
  q('.species').onchange = () => {
    a.species = cleanSpecies(q('.species').value);
    paintRarity();
    save();
  };
  q('.note').onchange = () => { a.note = q('.note').value.trim(); save(); };
  q('.actions').append(...actions);

  q('.sticker-wrap').onclick = () => flip(card, a, save); // tap = the same as a sideways swipe
  swipes(card, dir => flip(card, a, save, dir), close);
  const hint = Object.assign(document.createElement('p'), { className: 'swipe-hint',
    textContent: close ? '↔️ Desliza la tarjeta para girarla · ⬇️ para cerrarla' : '↔️ Desliza la tarjeta para ver sus rasgos' });
  $('#card').replaceChildren(card, hint);
  renderTraits(card, a, save);
  q('.sticker').addEventListener('load', () => evenFaces(card), { once: true });
  fillSpeciesList();
  return { where: q('.where'), sticker: q('.sticker') };
}

// Touch gestures on the big card. Sideways: the card turns with the finger, past 60 px it flips.
// Down (only with the card layer scrolled to the top, and only if `onClose`): it follows the finger, past 110 px it closes.
// Anything else gives the touch back to the browser (scrolling). Works from anywhere on the card, inputs included.
function swipes(card, onFlip, onClose) {
  let x0, y0, dx, dy, mode;
  const spring = () => {
    card.animate([{ transform: card.style.transform || 'none' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    card.style.transform = '';
    card.style.removeProperty('--turn');
  };
  card.addEventListener('touchstart', e => {
    mode = e.touches.length > 1 ? 'off' : null; // also from inputs: a tap still edits, only a real swipe flips
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = dy = 0;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (mode === 'off') return;
    dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
    if (!mode && Math.hypot(dx, dy) > 12) {
      mode = Math.abs(dx) > Math.abs(dy) ? 'flip' : dy > 0 && onClose && $('#view').scrollTop <= 0 ? 'close' : 'off';
    }
    if (mode === 'flip') {
      e.preventDefault();
      const deg = Math.max(-40, Math.min(40, dx * .3));
      card.style.setProperty('--turn', deg);
      card.style.transform = `perspective(900px) rotateY(${deg}deg)`;
    } else if (mode === 'close') {
      e.preventDefault(); // also stops pull-to-refresh
      card.style.transform = `translateY(${dy * .6}px) scale(${1 - Math.min(dy, 300) / 1500})`;
    }
  }, { passive: false });
  card.addEventListener('touchend', () => {
    const m = mode;
    mode = null;
    if (m === 'flip' && Math.abs(dx) > 60) { document.activeElement?.blur(); onFlip(dx > 0 ? 1 : -1); } // blur: close the keyboard
    else if (m === 'flip') spring();
    else if (m === 'close') dy > 110 ? onClose() : spring(); // closing morphs from where the finger left the card
  });
}

// Both faces get the height of the taller one, so the card never changes size when it turns.
// Measured by switching faces without a paint in between (no flicker). Called on open, image load and trait edits.
function evenFaces(card) {
  card.style.minHeight = '';
  const shown = card.offsetHeight;
  card.classList.toggle('show-back');
  const other = card.offsetHeight;
  card.classList.toggle('show-back');
  card.style.minHeight = `${Math.max(shown, other)}px`;
}

// Card flip: turn to 90°, swap faces, turn back from -90°. The back has the traits and the note, all editable.
// dir: 1 or -1, the way the finger swiped. A swipe hands over the angle it already reached (--turn).
async function flip(card, a, save, dir = 1) {
  const back = !card.classList.contains('show-back');
  const start = parseFloat(card.style.getPropertyValue('--turn')) || 0;
  card.style.transform = '';
  card.style.removeProperty('--turn');
  await turnCard(card, dir, start, () => {
    card.classList.toggle('show-back', back);
    if (back) card.querySelector('.back h3').textContent = `Así es ${a.name}`; // the name may have been edited
  });
}

// The two halves of a turn, swapping faces when the card is edge-on. `base`: a transform to keep
// (where a swipe down left the card), so closing from the back turns in place instead of jumping.
async function turnCard(card, dir, start, swap, { base = '', ms = 170 } = {}) {
  const turn = (from, to, easing) => card.animate([{ transform: `${base} perspective(900px) rotateY(${from}deg)` },
    { transform: `${base} perspective(900px) rotateY(${to}deg)` }], { duration: ms, easing }).finished;
  await turn(start, 90 * dir, 'ease-in');
  swap();
  await turn(-90 * dir, 0, base ? 'ease-out' : 'cubic-bezier(.34, 1.56, .64, 1)');
}

// Edits change rows in place: rebuilding the list replayed the pop-in and looked like flicker.
function renderTraits(card, a, save) {
  const list = card.querySelector('.traits');
  card.querySelector('.back h3').textContent = `Así es ${a.name}`;
  const empty = () => { if (!a.traits.length) list.replaceChildren(Object.assign(document.createElement('li'), { className: 'none', textContent: 'Todavía sin rasgos (・・ )' })); };
  const row = (t, isNew = false) => {
    const li = document.createElement('li');
    li.classList.toggle('new', isNew); // only an added trait pops in: on a flip the rows are simply there
    const name = Object.assign(document.createElement('input'), { value: t.name, maxLength: 20, ariaLabel: 'Rasgo' });
    name.setAttribute('list', 'traits-list');
    name.onchange = () => { t.name = name.value.trim() || t.name; name.value = t.name; save(); };
    const stars = [1, 2, 3, 4, 5].map(n => {
      const b = button('', () => { t.stars = n; paint(); save(); }, 'star');
      b.setAttribute('aria-label', `${n} estrellas`);
      return b;
    });
    const paint = () => stars.forEach((b, i) => { b.textContent = i < t.stars ? '★' : '☆'; });
    paint();
    li.append(name, ...stars, button('✕', () => { a.traits.splice(a.traits.indexOf(t), 1); li.remove(); empty(); evenFaces(card); save(); }, 'drop'));
    return li;
  };
  list.replaceChildren(...a.traits.map(t => row(t)));
  empty();
  card.querySelector('.add-trait').onclick = () => {
    const used = new Set(a.traits.map(t => t.name));
    const t = { name: TRAITS.find(n => !used.has(n)) ?? 'Especial', stars: 3 };
    a.traits.push(t);
    list.querySelector('.none')?.remove();
    const li = row(t, true);
    list.append(li);
    li.querySelector('input').select();
    evenFaces(card);
    save();
  };
  card.querySelector('.back h3').onclick = () => flip(card, a, save);
  evenFaces(card);
}

const FAV = 'fav'; // filter value for favourites; species are stored lowercase Spanish, so no clash with a real one
let filter = null; // species (or FAV) shown in the list and the map, null = all
const TABS = ['grid', 'album', 'map'];
let tab = 'grid';

function goTab(to) {
  if (tab === to) return;
  const dir = TABS.indexOf(to) > TABS.indexOf(tab) ? 'slide-left' : 'slide-right';
  return transition(() => { tab = to; return renderList(); }, dir);
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => goTab(b.dataset.tab);

let map, pins;
async function renderMap(animals) {
  const L = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  if (!map) {
    map = L.map('map', { zoomControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    pins = L.layerGroup().addTo(map);
  }
  map.invalidateSize(); // the map was hidden, Leaflet must measure it again
  pins.clearLayers();
  // ponytail: catches at the same spot stack on top of each other; add marker clustering if that gets crowded
  // One pin per catch, and a smaller one per re-encounter. All open the same card.
  const spots = animals.flatMap(a => [
    ...(a.location ? [{ a, loc: a.location, size: 56 }] : []),
    ...a.visits.filter(v => v.location).map(v => ({ a, loc: v.location, size: 40 })),
  ]);
  for (const { a, loc, size } of spots) {
    const icon = L.divIcon({ className: 'pin', html: `<img src="${blobUrl(a.sticker)}" data-id="${a.id}" alt="">`, iconSize: [size, size], iconAnchor: [size / 2, size - 4] });
    L.marker([loc.lat, loc.lon], { icon, title: a.name, zIndexOffset: size })
      .on('click', e => openDetail(a, e.target.getElement().querySelector('img'))).addTo(pins);
  }
  $('#map-empty').hidden = spots.length > 0;
  if (spots.length) map.fitBounds(spots.map(s => [s.loc.lat, s.loc.lon]), { padding: [48, 48], maxZoom: 16 });
  else map.setView([40.4, -3.7], 5);
}

async function renderList() {
  freeUrls();
  const all = (await getAll()).sort(byNewest);
  const counts = speciesCounts(all);
  const favs = all.filter(a => a.fav).length;
  if (filter === FAV ? !favs : !counts.some(([s]) => s === filter)) filter = null;

  $('#count').textContent = all.length ? `${all.length} ${all.length === 1 ? 'atrapado' : 'atrapados'}` : '';
  $('#empty').hidden = all.length > 0;
  $('#filters').hidden = tab === 'album' || (counts.length < 2 && !favs);
  const chip = (label, value) => button(label, () => transition(() => { filter = value; return renderList(); }, 'filter'),
    `chip${filter === value ? ' on' : ''}`);
  $('#filters').replaceChildren(chip(`✨ Todos ${all.length}`, null),
    ...(favs ? [chip(`❤️ Favoritos ${favs}`, FAV)] : []),
    ...counts.map(([s, n]) => chip(`${emojiFor(s)} ${s} ${n}`, s)));

  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#grid').hidden = tab !== 'grid';
  $('#album').hidden = tab !== 'album';
  $('#map-wrap').hidden = tab !== 'map';
  if (tab === 'album') renderAlbum(all);
  const shown = all.filter(a => !filter || (filter === FAV ? a.fav : a.species === filter));
  if (tab === 'map') await renderMap(shown); // awaited so a transition snapshots the pins

  $('#grid').replaceChildren(...shown.map(a => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector('img').src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.meta').textContent = `${emojiFor(a.species)} ${a.species}` + (a.shiny ? ' ✨' : '') + (a.visits.length ? ` · 👀${timesSeen(a)}` : '');
    el.dataset.rarity = rarityFor(a);
    el.classList.toggle('shiny', a.shiny);
    el.querySelector('.heart').hidden = !a.fav;
    el.classList.toggle('memory', a.memory);
    el.dataset.id = a.id;
    el.style.setProperty('--pastel', pastelFor(a.id));
    el.onclick = () => openDetail(a, el);
    return el;
  }));

  // Name the places of catches made without signal. One at a time: Nominatim allows 1 request/s.
  // Not awaited, so a view transition never waits on the network.
  (async () => {
    for (const a of all) {
      let changed = await resolvePlace(a);
      for (const v of a.visits) changed = (await resolvePlace(v)) || changed;
      if (changed) await put(a);
    }
  })();
}

// Album: progress, then one slot per species. A caught slot shows the newest sticker; tapping it
// opens the collection filtered to that species.
function renderAlbum(all) {
  const slots = albumSlots(all);
  const got = slots.filter(s => s.count).length;
  $('#album-progress').textContent = `${got} / ${slots.length} especies`;
  $('#album-bar').style.setProperty('--p', `${(got / slots.length) * 100}%`);
  const unlocked = new Set(unlockedIds(all));
  $('#badges-title').textContent = `🏅 Logros ${unlocked.size} / ${ACHIEVEMENTS.length}`;
  $('#badges').replaceChildren(...ACHIEVEMENTS.map(x => {
    const el = $('#badge-tpl').content.firstElementChild.cloneNode(true);
    el.classList.toggle('got', unlocked.has(x.id));
    el.querySelector('.emoji').textContent = x.emoji;
    el.querySelector('.title').textContent = x.title;
    el.querySelector('.desc').textContent = x.desc;
    return el;
  }));
  $('#album-grid').replaceChildren(...slots.map(s => {
    const el = $('#slot-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.rarity = s.rarity;
    el.classList.toggle('got', !!s.count);
    if (s.latest) {
      el.querySelector('img').src = blobUrl(s.latest.sticker);
      el.querySelector('.n').textContent = `×${s.count}`;
      el.onclick = () => { filter = s.species; goTab('grid'); };
    } else {
      el.querySelector('img').remove();
      el.querySelector('.n').remove();
      el.disabled = true;
    }
    el.querySelector('.emoji').textContent = s.emoji;
    el.querySelector('.label').textContent = s.count ? s.species : '???';
    return el;
  }));
}

// View Transitions. `type` sets html[data-vt], which style.css uses to pick the animation
// (open / close = a card, slide-left / slide-right = tabs, filter). Without the API (iOS < 18) views just swap.
async function transition(fn, type) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return fn();
  if (type) document.documentElement.dataset.vt = type;
  await document.startViewTransition(fn).finished.catch(() => {});
  delete document.documentElement.dataset.vt;
}

// A tile (or the big card) morphs as `card`, its sticker as `sticker` and its foil as `foil`; a map pin has
// only a sticker. Only one visible element may hold each name, so names are set just for the transition.
function tag(el, on) {
  if (!el) return;
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (img !== el) {
    el.style.viewTransitionName = on ? 'card' : '';
    el.querySelector(':scope > .foil').style.viewTransitionName = on ? 'foil' : '';
  }
  img.style.viewTransitionName = on ? 'sticker' : '';
}
const decoded = el => (el?.tagName === 'IMG' ? el : el?.querySelector('img'))?.decode().catch(() => {});

let listScroll = 0;

// id: the animal whose tile (or map pin) the card shrinks back into.
async function backToList(id) {
  // The browser freezes the old screen until the update below is done, which looked like a stop before the
  // shrink. So the list is rebuilt and the target decoded first, while still hidden. (The map needs to be
  // visible to lay out, so on that tab it still renders inside the update.)
  // Closing from the back: turn to the front first (while the list renders), then shrink.
  const open = $('#view:not([hidden]) .card');
  const front = open?.classList.contains('show-back')
    ? turnCard(open, 1, 0, () => open.classList.remove('show-back'), { base: open.style.transform, ms: 130 }) : null;
  if (tab !== 'map') {
    await renderList();
    // every tile image, not just the target: undecoded images made the first paint of the list slow
    await Promise.all([...$('#grid').querySelectorAll('img')].map(i => i.decode().catch(() => {})));
  }
  await front;
  // The card's text and buttons go at once, so the shrinking card is just its colour, sticker and foil
  // (a scaled-down snapshot of the text looked messy; a 150 ms fade first also felt like a stop).
  $('#view:not([hidden]) .card')?.classList.add('leaving');
  let target;
  await transition(async () => {
    showView('list');
    if (tab === 'map') await renderList();
    scrollTo(0, listScroll);
    target = id && document.querySelector(`.tile[data-id="${id}"], .pin img[data-id="${id}"]`);
    tag(target, true);
    await decoded(target);
  }, 'close');
  tag(target, false);
}

// The detail view is a history entry, so the phone's Back gesture closes it, like the swipe down.
let openId = null;
addEventListener('popstate', () => {
  if (!openId) return;
  const id = openId;
  openId = null;
  backToList(id);
});
const closeDetail = () => history.back();

function detailCard(a) {
  return renderCard(a, [
    ...(a.memory ? [] : [button('👀 ¡Otra vez!', () => seenAgain(a))]),
    button('📷 Foto', () => { rephotoTarget = a; $('#refile').click(); }),
    // Memories (her past pets) cannot be released.
    ...(a.memory ? [] : [button('🕊️ Liberar', async () => {
      if (!confirm(`¿Liberar a ${a.name}? Se borrará de tu colección.`)) return;
      await remove(a.id);
      closeDetail();
    }, 'danger')]),
  ], async () => { await put(a); checkAchievements(); }, closeDetail);
}

// Re-encounter without a photo: the visit is now and here.
async function seenAgain(a) {
  toast('📍 Apuntando dónde lo has visto…');
  const visit = { at: Date.now(), location: await getLocation(), place: null };
  await resolvePlace(visit); // if it fails, renderList retries it
  a.visits.push(visit);
  await put(a);
  toast(`👀 ¡${a.name}, visto ${timesSeen(a)} veces!`);
  detailCard(a);
  checkAchievements();
}

// "Ya lo tenía": the new photo is an animal already in the collection. Its time and place become a visit.
async function pickExisting(caught, placed, back) {
  const others = (await getAll()).filter(a => !a.memory).sort((x, y) => (y.species === caught.species) - (x.species === caught.species) || byNewest(x, y));
  status('¿Cuál es? Toca a tu bichito 👇');
  const grid = Object.assign(document.createElement('div'), { className: 'pick' });
  grid.append(...others.map(a => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector('img').src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.meta').textContent = `${emojiFor(a.species)} ${a.species}`;
    el.querySelector('.heart').hidden = !a.fav;
    el.dataset.rarity = rarityFor(a);
    el.classList.toggle('shiny', a.shiny);
    el.style.setProperty('--pastel', pastelFor(a.id));
    el.onclick = async () => {
      await placed;
      a.visits.push({ at: caught.takenAt, location: caught.location, place: caught.place });
      await put(a);
      toast(`👀 ¡${a.name}, visto ${timesSeen(a)} veces!`);
      backToList(a.id);
      checkAchievements();
    };
    return el;
  }));
  if (!others.length) grid.append(Object.assign(document.createElement('p'), { textContent: 'Todavía no tienes ninguno (・・ )' }));
  $('#card').replaceChildren(grid, button('Cancelar', () => { status(''); back(); }));
}

// from: the tile or pin image that was tapped.
function openDetail(a, from) {
  listScroll = scrollY;
  if (!openId) history.pushState({ card: a.id }, '');
  openId = a.id;
  tag(from, true);
  transition(async () => {
    tag(from, false);
    showView('view');
    $('#view').scrollTop = 0;
    await decoded(detailCard(a).sticker);
  }, 'open');
}

// Photo → sticker: detect the animal, or let the user tap it, then cut it out. Uses #view's status and stage.
async function stickerFrom(file) {
  status('Despertando al detector de bichitos… (◕‿◕) La primera vez descarga unos 13 MB.');
  const img = await toCanvas(file);
  img.className = 'photo';
  const { detector, segmenter } = await loadModels();

  status('Buscando al bichito… (・・ ) ?');
  const hit = pickAnimal(detector.detect(img).detections);
  let point = hit ? boxCenter(hit.box, img) : await askTap(img, 'No lo encuentro (｡•́︿•̀｡) Toca al animal en la foto.');

  status('Recortando con cuidado… ✂️');
  let sticker = await cutout(segmenter, img, point);
  while (!sticker) {
    point = await askTap(img, 'Ups, no he podido recortarlo. Toca al animal otra vez.');
    sticker = await cutout(segmenter, img, point);
  }
  status('');
  const recut = async () => {
    const p = await askTap(img, 'Toca al animal para recortarlo otra vez.');
    status('');
    return (await cutout(segmenter, img, p)) ?? sticker;
  };
  return { sticker, species: hit ? COCO_ES[hit.name] : UNKNOWN, recut };
}

function failed(e) {
  console.error(e);
  status(`Algo ha ido mal (╥﹏╥) ${e.message ?? e}`);
  $('#card').replaceChildren(button('Volver', () => backToList()));
}

async function onPhoto(file) {
  showView('view');
  const where = getLocation(); // ask early, it runs while the models work
  const takenAt = Date.now();
  try {
    const cut = await stickerFrom(file);
    const a = normalize({ id: crypto.randomUUID(), name: randomName(), species: cut.species, sticker: cut.sticker, takenAt, place: null, location: await where, traits: randomTraits(), shiny: rollShiny() });
    const placed = resolvePlace(a);
    const showPreview = () => {
      const f = renderCard(a, [
        button('Descartar', () => backToList()),
        button('🔁 Ya lo tenía', () => pickExisting(a, placed, showPreview)),
        button('Recortar otra vez', async () => {
          $('#card').replaceChildren();
          a.sticker = await cut.recut();
          showPreview();
        }),
        button('¡Me lo quedo! ⭐', async () => {
          await put(a); // if the place lookup is still running, renderList retries it
          navigator.storage?.persist?.();
          await backToList(a.id);
          checkAchievements();
        }, 'primary'),
      ]);
      placed.then(ok => { f.where.textContent = ok || !a.location ? fmtWhere(a) : 'Sin conexión: le pondré nombre más tarde 📡'; });
    };
    showPreview();
    if (a.shiny) {
      toast('✨🌈 ¡Increíble, es un bichito SHINY! 🌈✨');
      confetti($('#burst'), 80);
      setTimeout(() => $('#burst').replaceChildren(), 4500);
    }
  } catch (e) { failed(e); }
}

// New photo for an existing card (e.g. the placeholder of a memory). Keeps everything else.
async function rePhoto(a, file) {
  showView('view');
  try {
    a.sticker = (await stickerFrom(file)).sticker;
    a.customPhoto = true; // a later seed photo never overwrites this
    await put(a);
    detailCard(a);
  } catch (e) { failed(e); }
}

let rephotoTarget;
const onFile = fn => e => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (file) fn(file);
};
$('#file').onchange = onFile(onPhoto);
$('#refile').onchange = onFile(file => rePhoto(rephotoTarget, file));

// ---------- backup / restore ----------

const toDataUrl = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

$('#backup').onclick = async () => {
  const animals = await Promise.all((await getAll()).map(async a => ({ ...a, sticker: await toDataUrl(a.sticker) })));
  const day = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify({ app: 'pet-catcher', version: self.VERSION, savedAt: Date.now(), animals, meta: await getAllMeta() })],
    `bichidex-${day}.json`, { type: 'application/json' });
  // Share sheet first: on phones (iOS standalone above all) a plain download is unreliable.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Bichidex' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

// Merges by id: nothing already on the phone is deleted.
$('#restore').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = parseBackup(await file.text());
    $('#settings').close();
    if (!confirm(`¿Recuperar ${data.animals.length} bichitos de la copia? Los que ya tienes se quedan.`)) return;
    for (const a of data.animals) await put(normalize({ ...a, sticker: await (await fetch(a.sticker)).blob() }));
    for (const [k, v] of Object.entries(data.meta ?? {})) await setMeta(k, v);
    await renderList();
    toast(`¡Listo! ${data.animals.length} bichitos recuperados 🐾`);
    checkAchievements();
  } catch (err) { toast(err.message); }
};

// ---------- birthday surprise ----------

function confetti(box = $('#confetti'), n = 90) {
  const colors = ['#f7d98b', '#ffb27a', '#9fd8b4', '#9cc7f0', '#f5a3b5', '#c9b6f2'];
  box.replaceChildren(...Array.from({ length: n }, () => {
    const c = document.createElement('i');
    c.style.cssText = `--x:${Math.random() * 100}vw;--d:${2.5 + Math.random() * 2.5}s;--delay:${Math.random() * 1.5}s;`
      + `--r:${Math.random() * 720 - 360}deg;--drift:${Math.random() * 30 - 15}vw;background:${colors[Math.floor(Math.random() * colors.length)]}`;
    return c;
  }));
}

function showBirthday() {
  $('#bday').hidden = false;
  confetti();
}
$('#bday button').onclick = () => {
  try { localStorage.setItem('bday-seen', '1'); } catch {}
  // The tilt of holographic cards needs this on iOS, and it must come from a tap.
  globalThis.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
  $('#bday').hidden = true;
  $('#confetti').replaceChildren();
};
$('.sparkle').onclick = showBirthday; // replay: tap the ✿ next to the title, or "Ver la felicitación" in settings

// ---------- settings ----------
$('#open-settings').onclick = () => { $('#settings-version').textContent = `Bichidex v${self.VERSION}`; $('#settings').showModal(); };
$('#replay-bday').onclick = () => { $('#settings').close(); showBirthday(); };

// ---------- achievements ----------
// The first run only records what is already unlocked (her Recuerdos), so nothing pops during the birthday.
async function checkAchievements() {
  const now = unlockedIds(await getAll());
  const before = await getMeta('unlocked');
  await setMeta('unlocked', now);
  if (!before) return;
  const fresh = ACHIEVEMENTS.filter(x => now.includes(x.id) && !before.includes(x.id));
  if (!fresh.length) return;
  toast(`🏅 ¡Logro desbloqueado! ${fresh.map(x => `${x.emoji} ${x.title}`).join(' · ')}`);
  confetti($('#burst'), 60);
  setTimeout(() => $('#burst').replaceChildren(), 4500);
}

// ---------- holographic tilt ----------
// Rare cards shine with a rainbow that follows the phone's tilt. Without sensor data it drifts by itself.
let tiltFrame;
addEventListener('deviceorientation', e => {
  if (e.gamma == null || tiltFrame) return;
  tiltFrame = requestAnimationFrame(() => {
    tiltFrame = null;
    const root = document.documentElement;
    root.classList.add('tilt');
    root.style.setProperty('--hx', `${50 + Math.max(-45, Math.min(45, e.gamma)) * 1.1}%`);
    root.style.setProperty('--hy', `${50 + Math.max(-45, Math.min(45, e.beta - 45)) * 1.1}%`);
  });
});

// ---------- start ----------

$('#version').textContent = `v${self.VERSION}`;
$('#traits-list').replaceChildren(...TRAITS.map(t => new Option(t)));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); // else GitHub Pages' 10 min HTTP cache delays updates
let seen = false;
try { seen = localStorage.getItem('bday-seen') === '1'; } catch {}
if (!seen || new URLSearchParams(location.search).has('cumple')) showBirthday();
ensureMemories().catch(console.error).finally(() => { renderList(); checkAchievements(); });
