import { FilesetResolver, ObjectDetector, InteractiveSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
import { SORTS, sortAnimals, friendshipOf, nextFriendship, dueNotes, noteText, noteWhy, patternFor, foilFor, timeOfDay, isMilestone, keepComponent, readExif, COCO_ES, EMOJI, UNKNOWN, SEEDS, numberAll, fmtNo, rollShiny, ACHIEVEMENTS, unlockedIds, timesSeen, lastSeen, RARITY_LABEL, rarityFor, albumSlots, TRAITS, randomTraits, traitLabel, traitKey, GENDERS, GENDER_ICONS, emojiFor, pastelFor, cleanSpecies, normalize, byNewest, parseBackup, randomName, pickAnimal, placeName, speciesCounts, maskValueAt, maskBBox, applyMask } from './lib.mjs';

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
    if (a && !a.location) await put(Object.assign(a, { location: s.location, place: s.place })); // memories from before v0.11.3
    if (a && a.gender === 'x') await put(Object.assign(a, { gender: s.gender })); // memories from before v0.15 (both males)
    if (a && (a.customPhoto || (a.seedPhoto ?? 1) >= s.photo)) continue;
    const sticker = await (await fetch(s.file)).blob();
    await put(a ? { ...a, sticker, seedPhoto: s.photo }
      : normalize({ id: s.id, name: s.name, species: s.species, gender: s.gender, sticker, seedPhoto: s.photo, memory: true, fav: true, takenAt: null, place: s.place, location: s.location, traits: randomTraits() }));
  }
}

// Every record gets its collection number once (see numberAll). Run on start, after a keep and a restore.
async function numberRecords() {
  for (const a of numberAll(await getAll())) await put(a);
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
  if (maskBBox(mask, w, h, maskValueAt(mask, w, h, point)) === null) return Promise.resolve(null); // the point hit the background
  mask = keepComponent(mask, w, h, point); // drop the isolated bits that are not part of the pet
  const fg = 1;
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

// Show the photo and wait: a tap on the animal gives { point }, a drag draws a box and gives { area }
// (both normalized to the photo).
function askSpot(img, text) {
  status(text);
  const stage = $('#stage');
  const box = Object.assign(document.createElement('div'), { className: 'area-box', hidden: true });
  stage.replaceChildren(img, box);
  return new Promise(res => {
    let start = null;
    const at = e => { const r = img.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }; };
    const rect = (a, b) => ({ x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)),
      w: Math.min(1, Math.max(a.x, b.x)) - Math.max(0, Math.min(a.x, b.x)), h: Math.min(1, Math.max(a.y, b.y)) - Math.max(0, Math.min(a.y, b.y)) });
    img.onpointerdown = e => { start = at(e); try { img.setPointerCapture(e.pointerId); } catch {} };
    img.onpointermove = e => {
      if (!start) return;
      const p = at(e), q = rect(start, p);
      if (Math.hypot((p.x - start.x) * p.r.width, (p.y - start.y) * p.r.height) < 12) return;
      Object.assign(box.style, { left: `${img.offsetLeft + q.x * p.r.width}px`, top: `${img.offsetTop + q.y * p.r.height}px`,
        width: `${q.w * p.r.width}px`, height: `${q.h * p.r.height}px` });
      box.hidden = false;
    };
    img.onpointerup = e => {
      if (!start) return;
      const p = at(e), q = rect(start, p);
      const dragged = q.w * p.r.width > 30 && q.h * p.r.height > 30;
      start = null;
      if (!dragged && box.hidden === false) { box.hidden = true; return; } // a tiny box: try again
      stage.replaceChildren();
      res(dragged ? { area: q } : { point: { x: p.x, y: p.y } });
    };
  });
}

const cropCanvas = (src, a) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(a.w * src.width)); c.height = Math.max(1, Math.round(a.h * src.height));
  c.getContext('2d').drawImage(src, a.x * src.width, a.y * src.height, c.width, c.height, 0, 0, c.width, c.height);
  c.className = 'photo';
  return c;
};

// Manual cutout: tap the animal, or first draw a box around it (zooms into that area: the cutout can never
// reach outside it) and then tap it inside.
async function pickAndCut(segmenter, img, text) {
  let src = img;
  for (;;) {
    const spot = await askSpot(src, text);
    if (spot.area) { src = cropCanvas(src, spot.area); text = 'Ahora toca al animal dentro del recuadro 👆'; continue; }
    status('Recortando con cuidado… ✂️', true);
    const sticker = await cutout(segmenter, src, spot.point);
    status('');
    if (sticker) return sticker;
    text = 'Ups, no he podido recortarlo. Toca al animal, o rodéalo con un recuadro.';
  }
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
    const j = await r.json();
    a.place = placeName(j) ?? 'Un lugar sin nombre';
    a.country = j.address?.country_code ?? null; // for the Japan letter
    return true;
  } catch { return false; }
}

// ---------- UI ----------

let urls = [];
const blobUrl = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

const status = (t, searching = false) => { $('#status').textContent = t; $('#status').hidden = !t; $('#searching').hidden = !searching; };
// David's icons (assets/icons/*.png, 64 px, flat colour). `off` greys one out (empty heart, empty star).
const icon = (name, off = false) => Object.assign(document.createElement('img'), { className: `ico${off ? ' off' : ''}`, src: `assets/icons/${name}.png`, alt: '' });
const fmtWhen = t => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtWhere = a => a.place ?? (a.location ? 'Buscando el nombre del lugar…' : 'Elegir lugar');

// The app's own question pop-up (in place of the browser's confirm). Resolves true for `yes`; the safe
// answer (`no`) has the focus, and closing it any other way counts as no.
function ask({ title, text, yes, no = 'Cancelar', danger = false, pic = null }) {
  const d = $('#ask');
  d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = text;
  d.querySelector('.ask-pic').hidden = !pic;
  if (pic) d.querySelector('.ask-pic').src = pic;
  const y = d.querySelector('.yes'), n = d.querySelector('.no');
  y.textContent = yes; n.textContent = no;
  y.className = `yes ${danger ? 'danger' : 'primary'}`;
  d.showModal();
  n.focus();
  return new Promise(res => {
    const done = v => { d.onclose = null; d.close(); res(v); };
    y.onclick = () => done(true);
    n.onclick = () => done(false);
    // The close event arrives late: the previous question's close can land after this one opened. Only a real close counts.
    d.onclose = () => { if (!d.open) res(false); };
  });
}

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

// Everything that makes a card look like itself (tiles, the picker and the big card share it): colour, pattern,
// rarity frame, shiny, foil finish, time-of-day photo background, milestone number.
function dress(el, a) {
  el.style.setProperty('--pastel', pastelFor(a.id));
  el.dataset.pattern = patternFor(a.id);
  el.dataset.rarity = rarityFor(a);
  el.classList.toggle('shiny', a.shiny);
  const foil = foilFor(a), time = timeOfDay(a.takenAt);
  if (foil) el.dataset.foil = foil; else delete el.dataset.foil;
  if (time) el.dataset.time = time; else delete el.dataset.time;
  el.classList.toggle('milestone', isMilestone(a.no));
  const fr = friendshipOf(a);
  if (fr) el.dataset.friend = fr.key; else delete el.dataset.friend;
}

// Big card, used for the new-catch preview and for the detail view. `save` runs after each edit (detail only).
// `close`: what a swipe down does (detail only; a new catch is never discarded by a swipe).
function renderCard(a, actions, save = () => {}, close = null) {
  const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const q = s => card.querySelector(s);
  card.classList.toggle('memory', a.memory);
  const paintRarity = () => {
    dress(card, a); // same look as its tile
    const no = Object.assign(document.createElement('span'), { className: 'no', textContent: a.no ? fmtNo(a.no) : '' });
    q('.rarity').replaceChildren(...(a.no ? [no, ' · '] : []), RARITY_LABEL[rarityFor(a)] + (a.shiny ? ' · 🌈 Shiny' : ''));
  };
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
  // Tap the place to set it by hand on a map (a gallery photo often has none, or it may be wrong).
  q('.where').onclick = async () => {
    const ll = await pickLocation(a.location);
    if (!ll) return;
    Object.assign(a, { location: ll, place: null });
    q('.where').textContent = fmtWhere(a);
    await resolvePlace(a); // if it fails, renderList retries it
    q('.where').textContent = fmtWhere(a);
    save();
  };
  // Back of the card: friendship and sightings on one line ("🥉 Bronce, 2 más para plata · 👀 3 veces").
  const fr = friendshipOf(a), nx = nextFriendship(a);
  const bond = [];
  if (fr) bond.push(`${fr.medal} ${fr.label}` + (nx ? `, ${nx.left} más para ${nx.label.toLowerCase()}` : ', ¡la máxima!'));
  else if (a.visits.length) bond.push(`🤝 ${nx.left} más para ser amigos`);
  if (a.visits.length) bond.push(`👀 ${timesSeen(a)} veces`);
  q('.bond').textContent = bond.join(' · ');
  q('.bond').hidden = !bond.length;
  const last = a.visits.reduce((x, y) => (!x || y.at > x.at ? y : x), null);
  q('.last-seen').hidden = !last;
  if (last) q('.last-seen').textContent = `Última vez: ${fmtWhen(last.at)}` + (last.place ? ` · ${last.place}` : '');
  const fav = q('.fav');
  const paintFav = () => { fav.replaceChildren(icon('heart', !a.fav)); fav.classList.toggle('on', a.fav); };
  paintFav();
  fav.onclick = () => {
    a.fav = !a.fav;
    paintFav();
    if (a.fav) fav.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    save();
  };
  // Gender: while the random name is untouched (`nameAuto`), a new one with a matching title replaces it;
  // the traits on the back switch form (Glotón / Glotona / Glotón/a).
  const paintGender = () => q('.gender').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === a.gender));
  // On the back of the card, next to the traits. Her Recuerdos (both males) show it as fixed text.
  if (a.memory) {
    const fixed = Object.assign(document.createElement('span'), { className: 'fixed', textContent: ` ${GENDERS[a.gender]}` });
    fixed.prepend(icon(GENDER_ICONS[a.gender]));
    q('.gender').replaceChildren(fixed);
  }
  else q('.gender').replaceChildren(...Object.entries(GENDERS).map(([g, label]) => {
    const b = button(label, () => {
      if (a.gender === g) return;
      a.gender = g;
      if (a.nameAuto) { a.name = randomName(g); q('.name').value = a.name; }
      paintGender();
      renderTraits(card, a, save);
      save();
    });
    b.dataset.g = g;
    b.prepend(icon(GENDER_ICONS[g]), ' ');
    return b;
  }));
  paintGender();
  q('.name').onchange = () => { a.nameAuto = false; a.name = q('.name').value.trim() || a.name; q('.name').value = a.name; save(); };
  q('.species').onchange = () => {
    a.species = cleanSpecies(q('.species').value);
    paintRarity();
    save();
  };
  // A saved card keeps its buttons on the back (the front is the photo); a new catch keeps them on the front.
  (close ? q('.back-actions') : q('.actions')).append(...actions);

  // Tap the photo = flip (like a sideways swipe); press and hold it = pet the animal.
  let petted = false, pressTimer, px, py;
  const wrap = q('.sticker-wrap');
  wrap.addEventListener('pointerdown', e => { petted = false; px = e.clientX; py = e.clientY; pressTimer = setTimeout(() => { petted = true; pet(wrap); }, 450); });
  wrap.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - px, e.clientY - py) > 10) clearTimeout(pressTimer); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) wrap.addEventListener(ev, () => clearTimeout(pressTimer));
  wrap.oncontextmenu = e => e.preventDefault(); // no "save image" menu on a long press
  wrap.onclick = () => { if (petted) { petted = false; return; } flip(card, a, save); };
  swipes(card, dir => { learned('flip'); flip(card, a, save, dir); }, close && (() => { learned('close'); close(); }));
  $('#card').replaceChildren(card);
  // The same actions without a swipe: the arrows in the hint are buttons, and ← → ↓ work on a keyboard.
  cardKeys = { flip: dir => flip(card, a, save, dir), close };
  if (!remembered('gestures-learned')) {
    const hint = Object.assign(document.createElement('p'), { className: 'swipe-hint' });
    hint.append(button('↔️', () => cardKeys.flip(1), 'arrow'), ' Desliza la tarjeta para ' + (close ? 'girarla · ' : 'ver sus rasgos '));
    if (close) hint.append(button('↕️', close, 'arrow'), ' para cerrarla ');
    hint.append(button('✕', () => { remember('gestures-learned'); hint.remove(); }, 'dismiss'));
    $('#card').append(hint);
  }
  renderTraits(card, a, save);
  fillSpeciesList();
  return { where: q('.where'), sticker: q('.sticker') };
}

// The gesture hint under the card goes away for good when she taps its ✕, or once she has both flipped and
// closed a card with a swipe. Kept in localStorage (a reset brings it back, which is right).
const remembered = k => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const remember = k => { try { localStorage.setItem(k, '1'); } catch {} };
function learned(gesture) {
  remember(`used-${gesture}`);
  if (remembered('used-flip') && remembered('used-close')) remember('gestures-learned');
}

let cardKeys = null; // flip / close of the card on screen, for the keyboard
addEventListener('keydown', e => {
  if ($('#view').hidden || !cardKeys || e.target.closest?.('input, textarea') || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cardKeys.flip(e.key === 'ArrowLeft' ? -1 : 1); }
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && cardKeys.close) { e.preventDefault(); cardKeys.close(); }
});

// Petting: the animal wiggles happily and hearts float up (transform/opacity only), with a tiny buzz on Android.
function pet(wrap) {
  const img = wrap.querySelector('.sticker');
  img.animate([{ transform: 'none' }, { transform: 'rotate(-7deg) scale(1.08)' }, { transform: 'rotate(6deg) scale(1.1)' },
    { transform: 'rotate(-4deg) scale(1.05)' }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
  navigator.vibrate?.(25);
  for (let i = 0; i < 7; i++) {
    const h = icon('heart');
    h.className = 'pet-heart';
    h.style.left = `${30 + Math.random() * 40}%`;
    wrap.append(h);
    h.animate([{ transform: 'translate(-50%, 0) scale(.4)', opacity: 0 }, { opacity: 1, offset: .15 },
      { transform: `translate(${-50 + (Math.random() * 120 - 60)}%, -170px) scale(${.9 + Math.random() * .6})`, opacity: 0 }],
      { duration: 1100 + Math.random() * 400, delay: i * 90, easing: 'ease-out', fill: 'backwards' }).finished.then(() => h.remove());
  }
}

// Booster-pack reveal for a new catch: the card arrives face down, wobbles, flips, and a flash in its rarity colour
// bursts out (a rainbow one for a shiny). Skipped with reduced motion.
async function reveal(card, a) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cover = Object.assign(document.createElement('div'), { className: 'cover' });
  cover.append(Object.assign(document.createElement('span'), { className: 'cover-logo', textContent: 'Bichidex' }),
    Object.assign(document.createElement('span'), { className: 'cover-flower', textContent: '✿' }));
  card.append(cover);
  await card.animate([{ transform: 'scale(.6) rotate(-6deg)', opacity: 0 }, { transform: 'scale(1.03) rotate(2deg)', opacity: 1, offset: .55 },
    { transform: 'none' }], { duration: 500, easing: 'ease-out' }).finished;
  await card.animate([{ transform: 'none' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(-2deg)' },
    { transform: 'none' }], { duration: 550, easing: 'ease-in-out' }).finished;
  await card.animate([{ transform: 'perspective(900px) rotateY(0)' }, { transform: 'perspective(900px) rotateY(90deg)' }], { duration: 180, easing: 'ease-in' }).finished;
  cover.remove();
  const flash = Object.assign(document.createElement('div'), { className: 'flash' });
  flash.dataset.kind = a.shiny ? 'shiny' : rarityFor(a);
  card.append(flash);
  flash.animate([{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 800, easing: 'ease-out' }).finished.then(() => flash.remove());
  await card.animate([{ transform: 'perspective(900px) rotateY(-90deg)' }, { transform: 'perspective(900px) rotateY(0)' }],
    { duration: 320, easing: 'cubic-bezier(.34, 1.56, .64, 1)' }).finished;
}

// Touch gestures on the big card. Sideways: the card turns with the finger, past 60 px it flips.
// Down or up (only if `onClose`, and only when the card layer can't scroll further that way): it follows the finger,
// past 110 px it closes.
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
      const v = $('#view'), atTop = v.scrollTop <= 0, atBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 1;
      mode = Math.abs(dx) > Math.abs(dy) ? 'flip' : onClose && ((dy > 0 && atTop) || (dy < 0 && atBottom)) ? 'close' : 'off';
    }
    if (mode === 'flip') {
      e.preventDefault();
      const deg = Math.max(-40, Math.min(40, dx * .3));
      card.style.setProperty('--turn', deg);
      card.style.transform = `perspective(900px) rotateY(${deg}deg)`;
    } else if (mode === 'close') {
      e.preventDefault(); // also stops pull-to-refresh
      card.style.transform = `translateY(${dy * .6}px) scale(${1 - Math.min(Math.abs(dy), 300) / 1500})`;
    }
  }, { passive: false });
  card.addEventListener('touchend', () => {
    const m = mode;
    mode = null;
    if (m === 'flip' && Math.abs(dx) > 60) { document.activeElement?.blur(); onFlip(dx > 0 ? 1 : -1); } // blur: close the keyboard
    else if (m === 'flip') spring();
    else if (m === 'close') Math.abs(dy) > 110 ? onClose() : spring(); // closing morphs from where the finger left the card
  });
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
// Always exactly 3 traits (they fit the back without scrolling): rename them and set their stars; no adding or
// removing. Older cards with more keep the first 3; with fewer, random ones fill up to 3.
function renderTraits(card, a, save) {
  const list = card.querySelector('.traits');
  card.querySelector('.back h3').textContent = `Así es ${a.name}`;
  $('#traits-list').replaceChildren(...TRAITS.map(t => new Option(traitLabel(t, a.gender)))); // suggestions in her gender
  if (a.traits.length !== 3) {
    const used = new Set(a.traits.map(t => t.name));
    a.traits = [...a.traits, ...randomTraits().filter(t => !used.has(t.name))].slice(0, 3);
    save();
  }
  list.replaceChildren(...a.traits.map(t => {
    const li = document.createElement('li');
    const name = Object.assign(document.createElement('input'), { value: traitLabel(t.name, a.gender), maxLength: 20, ariaLabel: 'Rasgo' });
    name.setAttribute('list', 'traits-list');
    name.onchange = () => { t.name = traitKey(name.value) || t.name; name.value = traitLabel(t.name, a.gender); save(); };
    const stars = [1, 2, 3, 4, 5].map(n => {
      const b = button('', () => { t.stars = n; paint(); save(); }, 'star');
      b.setAttribute('aria-label', `${n} estrellas`);
      return b;
    });
    const paint = () => stars.forEach((b, i) => { b.replaceChildren(icon('star', i >= t.stars)); b.classList.toggle('on', i < t.stars); });
    paint();
    li.append(name, ...stars);
    return li;
  }));
  card.querySelector('.back h3').onclick = () => flip(card, a, save);
}

// Collection order: a small menu above the grid, remembered on this phone.
let sortKey = 'recent';
try { sortKey = localStorage.getItem('sort') in SORTS ? localStorage.getItem('sort') : 'recent'; } catch {}
$('#sort').replaceChildren(...Object.entries(SORTS).map(([k, label]) => new Option(label, k, false, k === sortKey)));
$('#sort').onchange = () => {
  sortKey = $('#sort').value;
  try { localStorage.setItem('sort', sortKey); } catch {}
  transition(() => renderList(), 'filter');
};

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

const leaflet = () => import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
const osmTiles = L => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });

// Location picker (a dialog with a map): tap to place the pin, search a place name, or use the phone's position.
// Resolves to { lat, lon }, or null when cancelled.
let pickMap, pickPin;
async function pickLocation(start) {
  const L = await leaflet();
  const dlg = $('#locpick');
  dlg.showModal();
  if (!pickMap) {
    pickMap = L.map('pickmap', { zoomControl: false });
    osmTiles(L).addTo(pickMap);
    pickPin = L.marker([0, 0], { icon: L.divIcon({ className: 'loc-pin', html: '📍', iconSize: [40, 40], iconAnchor: [20, 38] }) });
    pickMap.on('click', e => pickPin.setLatLng(e.latlng).addTo(pickMap));
  }
  pickMap.invalidateSize(); // the dialog just opened: Leaflet must measure it
  const place = (lat, lon, zoom) => { pickMap.setView([lat, lon], zoom); pickPin.setLatLng([lat, lon]).addTo(pickMap); };
  pickPin.remove();
  $('#loc-q').value = '';
  if (start) place(start.lat, start.lon, 15); else pickMap.setView([40.2, -3.7], 5);
  $('#loc-me').onclick = async () => {
    const p = await getLocation();
    p ? place(p.lat, p.lon, 16) : toast('No he podido saber dónde estás 📡');
  };
  $('#loc-search').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=es&q=${encodeURIComponent($('#loc-q').value)}`,
        { signal: AbortSignal.timeout(8000) })).json();
      r[0] ? place(+r[0].lat, +r[0].lon, 14) : toast('No encuentro ese sitio (・・ )');
    } catch { toast('Sin conexión: toca el mapa para elegir el sitio'); }
  };
  return new Promise(res => {
    const done = v => { dlg.onclose = null; dlg.close(); res(v); };
    $('#loc-ok').onclick = () => {
      const ll = pickMap.hasLayer(pickPin) && pickPin.getLatLng();
      ll ? done({ lat: ll.lat, lon: ll.lng }) : toast('Toca el mapa para poner el sitio 👆');
    };
    $('#loc-cancel').onclick = () => done(null);
    dlg.onclose = () => { if (!dlg.open) res(null); }; // Escape / back (a late close event of the previous use doesn't count)
  });
}

let map, pins;
async function renderMap(animals) {
  const L = await leaflet();
  if (!map) {
    map = L.map('map', { zoomControl: false });
    osmTiles(L).addTo(map);
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
  $('#sortbar').hidden = tab !== 'grid' || all.length < 3; // order only matters in the grid
  const chip = (label, value, ico) => {
    const b = button(label, () => transition(() => { filter = value; return renderList(); }, 'filter'), `chip${filter === value ? ' on' : ''}`);
    if (ico) b.prepend(icon(ico), ' ');
    return b;
  };
  $('#filters').replaceChildren(chip(`Todos ${all.length}`, null, 'shine'),
    ...(favs ? [chip(`Favoritos ${favs}`, FAV, 'heart')] : []),
    ...counts.map(([s, n]) => chip(`${emojiFor(s)} ${s} ${n}`, s)));

  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#grid').hidden = tab !== 'grid';
  $('#album').hidden = tab !== 'album';
  $('#map-wrap').hidden = tab !== 'map';
  if (tab === 'album') renderAlbum(all);
  const shown = all.filter(a => !filter || (filter === FAV ? a.fav : a.species === filter));
  if (tab === 'map') await renderMap(shown); // awaited so a transition snapshots the pins

  $('#grid').replaceChildren(...sortAnimals(shown, sortKey).map((a, i) => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector(STICKER).src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.no').textContent = (a.no ? fmtNo(a.no) : '') + (friendshipOf(a) ? ` ${friendshipOf(a).medal}` : '');
    el.querySelector('.meta').textContent = `${emojiFor(a.species)} ${a.species}` + (a.shiny ? ' 🌈' : '') + (a.visits.length ? ` · 👀${timesSeen(a)}` : '');
    dress(el, a);
    el.querySelector('.heart').hidden = !a.fav;
    el.classList.toggle('memory', a.memory);
    el.dataset.id = a.id;
    el.style.setProperty('--foil-delay', foilDelay(i));
    el.onclick = () => openDetail(a, el);
    return el;
  }));

  // Name the places of catches made without signal. One at a time: Nominatim allows 1 request/s.
  // Not awaited, so a view transition never waits on the network.
  (async () => {
    for (const a of all) {
      let changed = await resolvePlace(a);
      for (const v of a.visits) changed = (await resolvePlace(v)) || changed;
      if (changed) { await put(a); checkNotes(); } // a place resolved late can unlock a letter (Japan)
    }
  })();
}

// The foil shine starts at a different point on each card (a negative delay), so neighbours never shine together.
const foilDelay = i => `${-((i * 1.7) % 5).toFixed(1)}s`;

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
  $('#album-grid').replaceChildren(...slots.map((s, i) => {
    const el = $('#slot-tpl').content.firstElementChild.cloneNode(true);
    el.style.setProperty('--foil-delay', foilDelay(i));
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

// The sticker image of a tile or card (a tile also holds the heart icon, so never just 'img').
const STICKER = '.pic img, img.sticker';

// A tile (or the big card) morphs as `card`, its sticker as `sticker`, its foil as `foil` and its ribbon as `ribbon`; a map pin has
// only a sticker. Only one visible element may hold each name, so names are set just for the transition.
function tag(el, on) {
  if (!el) return;
  const img = el.tagName === 'IMG' ? el : el.querySelector(STICKER);
  if (img !== el) {
    el.style.viewTransitionName = on ? 'card' : '';
    el.querySelector(':scope > .foil').style.viewTransitionName = on ? 'foil' : '';
    // The "Recuerdo" ribbon too: inside the card snapshot it slid under the flying sticker, then popped back on top
    el.querySelector('.ribbon').style.viewTransitionName = on ? 'ribbon' : '';
  }
  img.style.viewTransitionName = on ? 'sticker' : '';
}
const decoded = el => (el?.tagName === 'IMG' ? el : el?.querySelector(STICKER))?.decode().catch(() => {});

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
  checkNotes(); // letters wait for the list screen
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
      const card = $('#view .card');
      if (!await ask({ title: `¿Liberar a ${a.name}?`, text: 'Volverá a su vida libre y saldrá de tu colección. No se puede deshacer.',
        yes: '🕊️ Liberar', no: 'Quedármelo', danger: true, pic: card.querySelector('.sticker').src })) return;
      // It flies away before the view closes.
      await card.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-70vh) rotate(-10deg) scale(.6)', opacity: 0 }],
        { duration: 650, easing: 'cubic-bezier(.5, -.4, .7, .4)', fill: 'forwards' }).finished;
      toast(`🕊️ ${a.name} vuela libre`);
      await remove(a.id);
      closeDetail();
    }, 'danger')]),
  ], async () => { await put(a); checkAchievements(); }, closeDetail);
}

// A new friendship level: a toast (and confetti at gold). Returns false when the level did not change.
function friendToast(a, before) {
  const now = friendshipOf(a);
  if (!now || now.key === before?.key) return false;
  toast(`${now.medal} ¡${a.name} y tú ya sois amigos de ${now.label.toLowerCase()}!`);
  if (now.key === 'oro') { confetti($('#burst'), 70); setTimeout(() => $('#burst').replaceChildren(), 4500); }
  return true;
}

// Re-encounter without a photo: the visit is now and here.
async function seenAgain(a) {
  toast('📍 Apuntando dónde lo has visto…');
  const visit = { at: Date.now(), location: await getLocation(), place: null };
  await resolvePlace(visit); // if it fails, renderList retries it
  const before = friendshipOf(a);
  a.visits.push(visit);
  await put(a);
  friendToast(a, before) || toast(`👀 ¡${a.name}, visto ${timesSeen(a)} veces!`);
  // Redraw on the same side: the button is on the back, so the card must not jump to the front.
  const wasBack = $('#view .card')?.classList.contains('show-back');
  detailCard(a);
  if (wasBack) $('#view .card').classList.add('show-back');
  checkAchievements();
}

// "Ya lo tenía": the new photo is an animal already in the collection. Its time and place become a visit.
async function pickExisting(caught, placed, back) {
  const others = (await getAll()).filter(a => !a.memory).sort((x, y) => (y.species === caught.species) - (x.species === caught.species) || byNewest(x, y));
  status('¿Cuál es? Toca a tu bichito 👇');
  const grid = Object.assign(document.createElement('div'), { className: 'pick' });
  grid.append(...others.map(a => {
    const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    el.querySelector(STICKER).src = blobUrl(a.sticker);
    el.querySelector('.name').textContent = a.name;
    el.querySelector('.meta').textContent = `${emojiFor(a.species)} ${a.species}`;
    el.querySelector('.heart').hidden = !a.fav;
    dress(el, a);
    el.onclick = async () => {
      await placed;
      const before = friendshipOf(a);
      a.visits.push({ at: caught.takenAt, location: caught.location, place: caught.place, country: caught.country });
      await put(a);
      friendToast(a, before) || toast(`👀 ¡${a.name}, visto ${timesSeen(a)} veces!`);
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
  status('Despertando al detector de bichitos… (◕‿◕) La primera vez descarga unos 13 MB.', true);
  const img = await toCanvas(file);
  img.className = 'photo';
  const { detector, segmenter } = await loadModels();

  status('Buscando al bichito… (・・ ) ?', true);
  const hit = pickAnimal(detector.detect(img).detections);
  let sticker = null;
  if (hit) {
    status('Recortando con cuidado… ✂️', true);
    sticker = await cutout(segmenter, img, boxCenter(hit.box, img));
  }
  sticker ??= await pickAndCut(segmenter, img, hit ? 'Ups, no he podido recortarlo. Toca al animal, o rodéalo con un recuadro.'
    : 'No lo encuentro (｡•́︿•̀｡) Toca al animal, o rodéalo con un recuadro.');
  status('');
  const recut = () => pickAndCut(segmenter, img, 'Toca al animal, o arrastra un recuadro a su alrededor para recortar solo esa zona.');
  return { sticker, species: hit ? COCO_ES[hit.name] : UNKNOWN, recut };
}

function failed(e) {
  console.error(e);
  status(`Algo ha ido mal (╥﹏╥) ${e.message ?? e}`);
  $('#card').replaceChildren(button('Volver', () => backToList()));
}

// fromGallery: the date and place come from the photo (EXIF), not from now and here. Without GPS in the
// photo the card says "Elegir lugar" and she taps it to set the place by hand.
// Test switch: open the app with ?shiny and every catch comes out shiny (like ?cumple for the greeting).
const FORCE_SHINY = new URLSearchParams(location.search).has('shiny');

async function onPhoto(file, fromGallery = false) {
  showView('view');
  const exif = fromGallery ? readExif(await file.arrayBuffer()) : null;
  const where = fromGallery ? Promise.resolve(exif.location) : getLocation(); // ask early, it runs while the models work
  const takenAt = fromGallery ? exif.takenAt ?? file.lastModified ?? Date.now() : Date.now();
  try {
    const cut = await stickerFrom(file);
    const a = normalize({ id: crypto.randomUUID(), name: randomName('x'), nameAuto: true, gender: 'x', species: cut.species, sticker: cut.sticker, takenAt, place: null, location: await where, traits: randomTraits(), shiny: FORCE_SHINY || rollShiny() });
    const placed = resolvePlace(a);
    const showPreview = () => {
      const f = renderCard(a, [
        button('Descartar', () => backToList()),
        button('🔁 Ya lo tenía', () => pickExisting(a, placed, showPreview)),
        button('✂️ Recortar otra vez', async () => {
          $('#card').replaceChildren();
          a.sticker = await cut.recut();
          showPreview();
        }),
        button('¡Me lo quedo!', async () => {
          await put(a); // if the place lookup is still running, renderList retries it
          await numberRecords();
          navigator.storage?.persist?.();
          await backToList(a.id);
          checkAchievements();
        }, 'primary'),
      ]);
      placed.then(ok => { f.where.textContent = ok || !a.location ? fmtWhere(a) : 'Sin conexión: le pondré nombre más tarde 📡'; });
    };
    showPreview();
    await reveal($('#view .card'), a);
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
$('#gallery-file').onchange = onFile(file => onPhoto(file, true));
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
    if (!await ask({ title: '¿Recuperar la copia?', text: `Se añadirán ${data.animals.length} bichitos. Los que ya tienes se quedan.`, yes: 'Recuperar' })) return;
    const local = await getAll();
    const ids = new Set(local.map(a => a.id)), used = new Set(local.map(a => a.no));
    for (const a of data.animals) {
      const rec = normalize({ ...a, sticker: await (await fetch(a.sticker)).blob() });
      if (!ids.has(rec.id) && used.has(rec.no)) delete rec.no; // a new animal whose number is taken here gets a fresh one
      await put(rec);
    }
    await numberRecords();
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
  setTimeout(checkNotes, 800);
};
$('.sparkle').onclick = showBirthday; // replay: tap the ✿ next to the title, or "Ver la felicitación" in settings

// ---------- settings ----------
$('#open-settings').onclick = () => { $('#settings-version').textContent = `Bichidex v${self.VERSION}`; $('#settings').showModal(); };
$('#replay-bday').onclick = () => { $('#settings').close(); showBirthday(); };

// Reset ("Restablecer"): deletes everything of hers on this phone and starts like the first day (birthday screen,
// Kurko and Kiffy back). Two confirmations; the downloaded models stay cached (they are not her data).
$('#reset').onclick = async () => {
  $('#settings').close();
  if (!await ask({ title: '¿Restablecer Bichidex?', text: 'Se borrarán todos tus bichitos, notas y logros. Kurko y Kiffy volverán.', yes: 'Seguir', danger: true })) return;
  if (!await ask({ title: '¿Seguro del todo?', text: 'No se puede deshacer. Si quieres conservarlos, cancela y guarda antes una copia.', yes: '🗑️ Borrar todo', danger: true })) return;
  (await db).close();
  await new Promise(res => { const r = indexedDB.deleteDatabase('pet-catcher'); r.onsuccess = r.onerror = r.onblocked = res; });
  // Only Bichidex's own keys: dbeltra.github.io is one origin shared with David's other apps (their data lives here too).
  try { for (const k of ['bday-seen', 'gestures-learned', 'used-flip', 'used-close', 'sort']) localStorage.removeItem(k); } catch {}
  location.replace(location.pathname);
};

// ---------- achievements ----------
// The first run only records what is already unlocked (her Recuerdos), so nothing pops during the birthday.
async function checkAchievements() {
  const now = unlockedIds(await getAll());
  const before = await getMeta('unlocked');
  await setMeta('unlocked', now);
  if (!before) return;
  const fresh = ACHIEVEMENTS.filter(x => now.includes(x.id) && !before.includes(x.id));
  if (fresh.length) {
    toast(`🏅 ¡Logro desbloqueado! ${fresh.map(x => `${x.emoji} ${x.title}`).join(' · ')}`);
    confetti($('#burst'), 60);
    setTimeout(() => $('#burst').replaceChildren(), 4500);
  }
  checkNotes();
}

// ---------- David's letters ----------
// A due letter shows as a sealed envelope; tapping it opens it. Opened ones are kept in meta `notes-opened`
// ([{ id, at }]) and listed in Ajustes → Cartas. Checked again each time the list screen comes back (backToList).
let noteBusy = false;
async function checkNotes() {
  // Only on the list screen: never over a card, a catch in progress, the birthday screen or another dialog.
  if (noteBusy || !$('#bday').hidden || !$('#view').hidden || document.querySelector('dialog[open]')) return;
  const opened = (await getMeta('notes-opened')) ?? [];
  const [next] = dueNotes(await getAll(), Date.now(), opened.map(o => o.id));
  if (!next) return;
  noteBusy = true;
  const d = $('#letter');
  d.classList.remove('open');
  d.querySelector('.note-text').textContent = next.text;
  d.querySelector('.note-why').textContent = next.why;
  d.showModal();
  d.querySelector('.envelope').onclick = () => d.classList.add('open');
  d.onclose = async () => {
    d.onclose = null;
    await setMeta('notes-opened', [...opened, { id: next.id, at: Date.now() }]);
    noteBusy = false;
    setTimeout(checkNotes, 600); // the next one, if several were due
  };
}

$('#open-letters').onclick = async () => {
  const opened = (await getMeta('notes-opened')) ?? [];
  $('#letters-list').replaceChildren(...[...opened].reverse().map(o => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('strong'), { textContent: noteWhy(o.id) }),
      Object.assign(document.createElement('p'), { textContent: noteText(o.id) }),
      Object.assign(document.createElement('small'), { textContent: new Date(o.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) }));
    return li;
  }));
  $('#letters-empty').hidden = opened.length > 0;
  $('#settings').close();
  $('#letters').showModal();
};

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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); // else GitHub Pages' 10 min HTTP cache delays updates
let seen = false;
try { seen = localStorage.getItem('bday-seen') === '1'; } catch {}
// The greeting waits for the installed app: David installs it on her phone from the browser without
// seeing it, and the first time she opens it from the home screen it is there. ?cumple forces it anywhere.
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if ((installed && !seen) || new URLSearchParams(location.search).has('cumple')) showBirthday();
ensureMemories().then(numberRecords).catch(console.error).finally(() => { renderList(); checkAchievements(); });
