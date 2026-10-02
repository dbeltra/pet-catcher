# Pet Catcher

A PWA (installable web app) for the phone. You take a photo of an animal. The app finds the animal,
cuts it out like a sticker, puts it on a card and saves it. You browse your collection, see the
date, time and place of each catch, and rename the animals (each one gets a random name first).

Personal project of David (GitHub `dbeltra`). **It is a birthday gift for his girlfriend Mari, a pet lover.**
Everything she sees should feel warm and personal; never ship something that can lose her data.

**The UI language is Spanish.** All visible text, species names and random names are Spanish.
The look is kawaii but **not girly**: soft butter-yellow accent (`--accent: #f7d98b`) with dark-brown text on it,
the cream polka-dot background, butter/mint/sky/peach/pistachio pastels, the rounded font Fredoka, kaomoji,
⭐ not hearts, the rolling ✿ next to the title, a highlighter band behind the title, gentle animations.
David's feedback so far: pink (v0.2) too girly; bright yellow `#ffcf3f` (v0.3.0) too bright; he likes the
background, the animations and the rolling flower (a ★ there was worse); a 3px offset text-shadow on the
title (v0.3) was hard to read.

## Rules for this repo

- **Git identity:** commit as `David Beltrà <dbeltra@gmail.com>`. It is already set in the local
  `.git/config`. Never use the 011h work email or the global git config here.
- **Remote:** `git@github-dbeltra:dbeltra/pet-catcher.git`. `github-dbeltra` is an `~/.ssh/config`
  alias for the personal key `~/.ssh/id_ed25519_dbeltra`. Never use the default 011h key.
- **No build step, no npm, no framework.** Plain HTML, CSS and ES modules, served as static files.
  Keep it that way unless a feature truly needs more.
- **On every deploy, bump `VERSION` in `version.js`** (semver: 0.2.0 → 0.2.1 for fixes, 0.3.0 for features).
  The service worker names its cache `shell-<VERSION>`, so the bump makes phones fetch the new files.
  The version shows at the bottom of the list, so David can check he has the latest. If you do not
  bump it, installed phones keep serving the old files.

## Decisions (and why)

| Topic | Choice | Why / when to change |
|---|---|---|
| Storage | IndexedDB on the phone | Free, offline, no account. Data is lost if the site data is cleared or the phone changes. Add Supabase sync when that matters. |
| Detection | MediaPipe ObjectDetector, EfficientDet-Lite0 (COCO) | On-device, free, private, offline after the first load. Knows only 10 animals: bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe. |
| Cutout | MediaPipe InteractiveSegmenter, `magic_touch` model | Class-agnostic: it cuts out whatever object sits under one point, so it works for any animal, including ones the detector does not know. |
| Species names | COCO label mapped to Spanish (`COCO_ES`), or `bichito misterioso`. The user can type any species (e.g. `ciervo`) with suggestions from a `<datalist>` | For real species detection (e.g. "petirrojo") add a vision API (Claude) later. It needs a small server to hide the API key, so it does not fit GitHub Pages alone. |
| Place | Reverse geocoding with Nominatim (OpenStreetMap), free, no key, max 1 request/s | The card shows only the place name. Coordinates are stored too, for the map (since v0.3). |
| Map | Leaflet 1.9.4 (ES module from jsdelivr) + OpenStreetMap tiles | Free, no key. Each catch is a mini sticker pin; tap → detail. The species filter applies to the map too. |
| Camera | `<input type="file" accept="image/*" capture="environment">` | Opens the native camera app. No getUserMedia viewfinder code. |
| Hosting | GitHub Pages | Free, HTTPS (the camera and service worker need it). Static only. |

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell, the two views (`#list`, `#view`), the `<template>`s for tiles and cards. |
| `app.js` | Everything with a DOM: model loading, IndexedDB, the catch flow, rendering. |
| `version.js` | `self.VERSION`. Loaded by the page (`<script>`) and by the service worker (`importScripts`). |
| `lib.mjs` | Pure helpers, no DOM: Spanish species map `COCO_ES`, `EMOJI` per species, `cleanSpecies`, `randomName`, `pickAnimal`, `placeName`, `speciesCounts`, mask helpers. |
| `test.mjs` | Unit check for `lib.mjs`. Run `node test.mjs` → prints `ok`. |
| `style.css` | Mobile-first styles, light/dark through `prefers-color-scheme`. The sticker outline is a stack of CSS `drop-shadow`s. |
| `sw.js` | Service worker: cache-first. Two caches: `shell-<VERSION>` (own files), `cdn-v1` (MediaPipe lib, Leaflet, models, font; hosts in `CDN_HOSTS`). Other origins (Nominatim, map tiles) pass through uncached, so the map has no tiles offline. It is registered with `updateViaCache: 'none'` and installs the shell with `cache: 'reload'`; without both, GitHub Pages' 10 min HTTP cache delays updates or mixes old and new files. |
| `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` | PWA install data. The PNGs are rendered from `icon.svg` (see below). |
| `seed/*.png` | Stickers of her past pets (placeholders until David sends photos). |
| `e2e/run.sh`, `e2e/harness.html` | End-to-end check in headless Chrome (see Testing). |

## How the catch flow works (`onPhoto` in `app.js`)

1. The file input gives a photo. Location is requested at once (it runs in parallel).
2. `toCanvas` scales the photo to max 1024 px on the long side.
3. `loadModels` loads the WASM runtime and both models once (about 13 MB, then cached by the SW).
4. The detector runs. `pickAnimal` takes the best-scoring COCO animal.
   - Found: the keypoint is the center of its box.
   - Not found: the photo is shown and the user taps the animal (`askTap`). Species = `bichito misterioso`
     (the species field shows empty, so the user can type one).
5. `cutout` runs the segmenter with that keypoint and gets a category mask.
   - The foreground value is **read from the mask at the keypoint** (`maskValueAt`). Do not assume
     0 or 1: this keeps the code correct whatever value the model uses.
   - The mask array is **copied** inside the callback, because MediaPipe frees it afterwards.
   - If that value covers more than 90% of the mask, the point hit the background: `maskBBox`
     returns null and the user is asked to tap the animal.
   - `applyMask` makes the background transparent; the result is cropped to the mask box plus `PAD`.
6. The preview card shows the sticker, a random name, the species (both editable), date/time and place.
   The place lookup (`resolvePlace`) starts as soon as the position is known.
   Buttons: Descartar, Recortar otra vez (tap again to choose another point), ¡Me lo quedo!
7. "¡Me lo quedo!" saves the record to IndexedDB and asks for persistent storage (`navigator.storage.persist`).

List: two tabs, `🗂️ Colección` (grid) and `🗺️ Mapa` (`renderMap`, Leaflet is imported the first time
the tab opens). The species filter chips (`#filters`) show when there are 2+ species and apply to both. Detail view: tap a tile.
You can change the name or species (each saves on change) or "Liberar" (delete).

### Transitions (David wants them flashy)

`transition(fn, type)` wraps a DOM change in `document.startViewTransition` (skipped with reduced motion or
where unsupported, e.g. iOS < 18). `type` goes to `html[data-vt]`, and `style.css` picks the animation from it:

| type | when | animation |
|---|---|---|
| `open` / `close` | open / close a card | the tile (`card`) grows into the big card with an overshoot; its sticker (`sticker`) flies on top with a wiggle; the card contents then pop in one by one (`rise`). Closing: the contents first drop away (`.leaving`, 150 ms), then the plain card shrinks into the tile with less bounce |
| `slide-left` / `slide-right` | tab switch (direction from the order in `TABS`) | `main` (`content`) swings out to one side and bounces in from the other; the yellow tab pill (`tab-on`) slides |
| `filter` | filter chip | the grid or map shrinks away and pops back |

Each animal has a fixed pastel (`pastelFor(id)`, a hash of the id), used by its tile **and** its big card,
so the tile visibly grows into the card. A map pin morphs only its sticker into the card (and back).

Rules that keep it working:
- Only one *visible* element may hold a view-transition-name, or the browser skips the transition.
  `tag(el, on)` sets/clears `card` + `sticker` on a tile (or only `sticker` on a pin image). `openDetail`
  moves the names from the tile to the card inside the callback; `backToList(id)` puts them on the
  matching tile or pin and clears them when the transition ends.
- The callback awaits `img.decode()`, so the new snapshot never shows an empty image.
- `renderList` must not await network work (the Nominatim retries run un-awaited), or the screen freezes
  during the transition.
- `renderList` awaits `renderMap`, so the map tab snapshot already has its pins.
- Anti-flicker rules from v0.5.2 (David saw flicker in v0.5.0):
  - The big card stays fully opaque during the morph; only the small tile fades on top of it.
    Cross-fading both left see-through frames.
  - The sticker never cross-fades (old image hidden). The img boxes must have the sticker's own shape,
    so no `aspect-ratio` + `object-fit: contain` letterboxing (`.tile .pic` wraps it). Otherwise two cats of
    different sizes overlap.
  - The card snapshots use `object-fit: cover; object-position: top`, so text is cropped, never stretched.
  - `::view-transition-group(card)` has `overflow: clip`: Chrome still paints the tall card snapshot below the
    box, and that strip vanished at the very end of closing (v0.5.2 flicker, fixed in v0.5.3).
  - leaflet.css forces `max-width/max-height: none !important` on marker images; the `.pin img` limits need
    `!important` and the `.leaflet-container .leaflet-marker-pane` prefix, or map stickers render giant.
- To judge an animation, record it frame by frame: CDP `Page.startScreencast` while you trigger it, save the
  frames, then `ffmpeg -pattern_type glob -i 'f-*.png' -vf "scale=210:-1,tile=6x3" sheet.png` and look at the sheet.
  Single screenshots do not show flicker.
- All timings and keyframes live at the end of `style.css` (`vt-*` keyframes).

### Place names without signal

If the Nominatim lookup fails (no signal), the preview says so and every `renderList` retries the
lookups one at a time for records that have `location` but no `place`.

## Gift features

- **Birthday surprise:** `#bday` overlay ("¡Feliz cumpleaños Mari! Te quiero ❤️", CSS confetti) shows on the
  first open (`localStorage` key `bday-seen`). Replay: tap the ✿ next to the title, or open with `?cumple`.
  Its button also asks for `DeviceOrientationEvent.requestPermission()` (iOS needs a tap for the holo tilt).
- **Recuerdos (her past pets):** `SEEDS` in `lib.mjs` (Kurko 🐶 perro, Kiffy 🐱 gato) with fixed ids
  `seed-kurko` / `seed-kiffy`. `ensureMemories()` re-adds any that is missing on **every** start, so they can
  never be lost; the card has no "Liberar" button. They have `memory: true`, `fav: true`, no date or place
  (the card says "Un recuerdo para siempre"), a golden glowing frame and a "Recuerdo" ribbon, and sort first.
  Their stickers are `seed/kurko.png` / `seed/kiffy.png`, **placeholder emoji for now**: David will send real
  photos. Replacing the files only helps phones that have not opened the app yet; on an existing phone use
  "📷 Cambiar foto" on the card (runs the same detect + cutout pipeline, keeps everything else).
- **Favourites and notes:** ❤️ button on the card, a note textarea; the "❤️ Favoritos" filter chip (`FAV`).
- **Backup / restore** (footer): "💾 Guardar copia" writes all animals (stickers as data URLs) plus the `meta`
  store to `pet-catcher-YYYY-MM-DD.json`, through the share sheet when possible (iOS standalone downloads are
  unreliable), else a download. "📂 Restaurar" merges by id (never deletes); `parseBackup` validates.

- **Album** (tab `📖 Álbum`, between Colección and Mapa): `albumSlots()` gives one slot per known species,
  grouped by rarity, plus caught custom species; a progress bar "N / M especies". Missing slots show a grey
  emoji and "???"; a caught slot shows its newest sticker and opens the collection filtered to it.
- **Rarity** (`rarityOf` / `rarityFor`): común, raro (blue frame), épico (gold frame + soft shine), legendario
  (holographic). Custom species are raro; her Recuerdos are always legendario. The shine is a rainbow
  `::after` that follows the phone tilt (`deviceorientation` → `--hx/--hy`, class `html.tilt`) or drifts.
  Use normal blending: `color-dodge` washes out to white on the pastels.
- **Traits** ("🔄 Rasgos" flips the card): 3 random `TRAITS` with 1-3 stars on each new catch and memory.
  All editable on the back: rename (with suggestions), tap stars, ✕ remove, ＋ add. `flip()` turns the card with
  the Web Animations API (0→90°, swap faces via `.show-back`, -90→0); no 3D wrapper.

## Data model

IndexedDB database `pet-catcher`, **version 2**: object store `animals` (keyPath `id`) and `meta`
(out-of-line keys, small app state; included in backups). `onupgradeneeded` only creates missing stores.
Every record goes through `normalize()` on read, which fills fields added later. Record:

```js
{
  id: 'uuid',
  name: 'Don Galleta',
  species: 'gato' | 'ciervo' | 'bichito misterioso' | ...,   // lowercase Spanish, free text
  sticker: Blob,            // PNG with transparency, cropped
  takenAt: 1759400000000,   // ms since epoch
  place: 'Sitges, Garraf' | null,   // null while the lookup is pending or with no position
  location: { lat, lon } | null,     // for the map
  fav: false, note: '',
  memory: false,                     // true for her past pets (SEEDS)
  traits: [{ name: 'Dormilón', stars: 1..3 }],
  visits: [],                        // reserved for the next version
}
```

Records from v0.1 have English species (`cat`) and `location` with `accuracy`; their place gets
resolved by the retry. Records from v0.2 whose place resolved lost their coordinates (v0.2 deleted them),
so they do not show on the map. Their species stays English unless edited (no migration, there were only test catches).

The original photo is **not** stored (it saves space). This is why Re-cut works only in the preview.
If you change the shape, bump the DB version and migrate in `onupgradeneeded`.

## Dependencies (all from CDNs, no install)

- `@mediapipe/tasks-vision@0.10.35` from jsdelivr (ES module + `wasm/` folder).
  **Do not upgrade to 1.x without rework:** 1.0 replaced the `segment(image, {keypoint})` API of
  `InteractiveSegmenter` with a strokes API (the old one is now `InteractiveSegmenterLegacy`).
- Models from `storage.googleapis.com/mediapipe-models/`:
  `object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite` (7 MB) and
  `interactive_segmenter/magic_touch/float32/1/magic_touch.tflite` (6 MB). Both send CORS headers.
- Google Fonts: Fredoka (400, 500, 600).
- `leaflet@1.9.4` from jsdelivr: `dist/leaflet-src.esm.js` (dynamic import) and `dist/leaflet.css` (in `<head>`).
- Nominatim `reverse?format=jsonv2&zoom=14&accept-language=es`. `placeName` builds "most specific, town or county".

## Run locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

`localhost` counts as a secure origin, so the service worker works. On a desktop the file input opens
a file picker, not the camera. To test on the phone, use the GitHub Pages URL (the phone needs HTTPS).

## Testing

- `node test.mjs`: pure logic. Fast. Run it after any change to `lib.mjs`.
- `./e2e/run.sh`: the real app in headless Chrome. It downloads a cat photo once (to `e2e/cat.jpg`,
  gitignored), fakes a position in Sitges, puts the photo into the file input, waits for the preview
  and the real place lookup, clicks "¡Me lo quedo!", opens the map tab and checks for one pin. It also
  dismisses the birthday overlay, checks both memories and that they have no "Liberar", favourites the
  catch, and does a backup → restore round trip (the share sheet is replaced by a capture). It prints
  `OK bday=... memories=2 memoryRelease=false ... pins=1 backup=3 tiles=4` and exits 0, or `FAIL ... timeout at <step>`.
  Each later version adds its own checks to the same line. `harness.html` needs its `<meta charset>`: without it "¡" breaks the button lookup.
  It needs network (the first run downloads the models) and Google Chrome in `/Applications`.
  The harness reports back by requesting `/result?<message>`, which shows up in the server log.
- Screenshot of the running app: start Chrome with `--remote-debugging-port` and call
  `Page.captureScreenshot` over CDP (Node 20 needs `--experimental-websocket`).

## Deploy (GitHub Pages)

1. One-time setup (the repo must be **public** for free Pages): in the repo → Settings → Pages → Source "Deploy from a branch", branch `main`, folder `/`.
2. Bump `VERSION` in `version.js`, commit, push to `main`. Pages rebuilds in about a minute.
3. URL: `https://dbeltra.github.io/pet-catcher/`. All paths in the app are relative, so the subpath works.

To check the phone has the new version: close and reopen the app, and look at the version at the
bottom of the list. A deploy can need two reopens (the first one installs the new service worker).

The home-screen icon is copied at install time. After an icon change, remove the app and install it again.

**Never change `id` in `manifest.webmanifest`** (`pet-catcher`, set in v0.5.1). Chrome identifies an installed
app by it. v0.5.1 added it because, after an uninstall, Chrome on Android kept a stale "already installed"
record for the old implicit id (the start URL) and only offered a shortcut. Changing it again would make
Chrome see a second, separate app. Data is not affected: IndexedDB belongs to the origin, not the id.

Install on the phone: Android Chrome → menu → "Install app". iPhone Safari → Share → "Add to Home Screen".

## Regenerate the PNG icons

```sh
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for s in 192 512; do
  printf '<body style="margin:0"><img src="file://%s/icon.svg" width=%s height=%s style="display:block">' "$PWD" $s $s > /tmp/icon.html
  "$C" --headless --hide-scrollbars --allow-file-access-from-files --window-size=$s,$s --screenshot="$PWD/icon-$s.png" file:///tmp/icon.html
done
```

## Known limits and ideas for next iterations

- The detector knows only 10 animals. Anything else goes through the tap fallback.
- An animal that fills more than 90% of the photo is taken as background, and the tap prompt
  repeats with no way out (no Back button during a tap). Add a Back button if this happens in practice.
- Not yet tested on a real phone: EXIF rotation of camera photos, the location line with real
  coordinates, iOS Safari in standalone mode.
- The mask can leave small stray specks. Fix: keep only the connected component under the keypoint.
- The mask edge is hard (no feathering). Fix: blur the alpha a little before cropping.
- The location is where the phone is when you pick the file, not EXIF GPS (camera captures usually
  strip GPS anyway).
- No export/backup. Data lives in one browser on one phone.
- The detector's species list is fixed; custom species are free text, so typos make separate filter chips.
- Map pins at the same spot overlap (no clustering).
- Ideas: species via Claude vision, Supabase sync, a map of catches, rarity/stats, sharing a card as an image.
