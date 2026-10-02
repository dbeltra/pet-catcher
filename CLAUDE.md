# Pet Catcher

A PWA (installable web app) for the phone. You take a photo of an animal. The app finds the animal,
cuts it out like a sticker, puts it on a card and saves it. You browse your collection, see the
date, time and place of each catch, and rename the animals (each one gets a random name first).

Personal project of David (GitHub `dbeltra`). It is a prototype, built to iterate on.

## Rules for this repo

- **Git identity:** commit as `David Beltrà <dbeltra@gmail.com>`. It is already set in the local
  `.git/config`. Never use the 011h work email or the global git config here.
- **Remote:** `git@github-dbeltra:dbeltra/pet-catcher.git`. `github-dbeltra` is an `~/.ssh/config`
  alias for the personal key `~/.ssh/id_ed25519_dbeltra`. Never use the default 011h key.
- **No build step, no npm, no framework.** Plain HTML, CSS and ES modules, served as static files.
  Keep it that way unless a feature truly needs more.
- **On every deploy, bump `SHELL_CACHE` in `sw.js`** (`shell-v1` → `shell-v2` ...). If you do not,
  installed phones keep serving the old files from the cache.

## Decisions (and why)

| Topic | Choice | Why / when to change |
|---|---|---|
| Storage | IndexedDB on the phone | Free, offline, no account. Data is lost if the site data is cleared or the phone changes. Add Supabase sync when that matters. |
| Detection | MediaPipe ObjectDetector, EfficientDet-Lite0 (COCO) | On-device, free, private, offline after the first load. Knows only 10 animals: bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe. |
| Cutout | MediaPipe InteractiveSegmenter, `magic_touch` model | Class-agnostic: it cuts out whatever object sits under one point, so it works for any animal, including ones the detector does not know. |
| Species names | COCO label, or "mystery critter" | For real species (e.g. "European robin") add a vision API (Claude) later. It needs a small server to hide the API key, so it does not fit GitHub Pages alone. |
| Camera | `<input type="file" accept="image/*" capture="environment">` | Opens the native camera app. No getUserMedia viewfinder code. |
| Hosting | GitHub Pages | Free, HTTPS (the camera and service worker need it). Static only. |

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell, the two views (`#list`, `#view`), the `<template>`s for tiles and cards. |
| `app.js` | Everything with a DOM: model loading, IndexedDB, the catch flow, rendering. |
| `lib.mjs` | Pure helpers, no DOM: `randomName`, `pickAnimal`, `maskValueAt`, `maskBBox`, `applyMask`. |
| `test.mjs` | Unit check for `lib.mjs`. Run `node test.mjs` → prints `ok`. |
| `style.css` | Mobile-first styles, light/dark through `prefers-color-scheme`. The sticker outline is a stack of CSS `drop-shadow`s. |
| `sw.js` | Service worker: cache-first. Two caches: `shell-vN` (own files), `cdn-v1` (MediaPipe lib + models). |
| `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` | PWA install data. The PNGs are rendered from `icon.svg` (see below). |
| `e2e/run.sh`, `e2e/harness.html` | End-to-end check in headless Chrome (see Testing). |

## How the catch flow works (`onPhoto` in `app.js`)

1. The file input gives a photo. Location is requested at once (it runs in parallel).
2. `toCanvas` scales the photo to max 1024 px on the long side.
3. `loadModels` loads the WASM runtime and both models once (about 13 MB, then cached by the SW).
4. The detector runs. `pickAnimal` takes the best-scoring COCO animal.
   - Found: the keypoint is the center of its box.
   - Not found: the photo is shown and the user taps the animal (`askTap`). Species = "mystery critter".
5. `cutout` runs the segmenter with that keypoint and gets a category mask.
   - The foreground value is **read from the mask at the keypoint** (`maskValueAt`). Do not assume
     0 or 1: this keeps the code correct whatever value the model uses.
   - The mask array is **copied** inside the callback, because MediaPipe frees it afterwards.
   - If that value covers more than 90% of the mask, the point hit the background: `maskBBox`
     returns null and the user is asked to tap the animal.
   - `applyMask` makes the background transparent; the result is cropped to the mask box plus `PAD`.
6. The preview card shows the sticker, a random name (editable), species, date/time and location.
   Buttons: Discard, Re-cut (tap again to choose another point), Keep.
7. Keep saves the record to IndexedDB and asks for persistent storage (`navigator.storage.persist`).

Detail view: tap a tile. You can rename (it saves on change) or "Release" (delete).

## Data model

IndexedDB database `pet-catcher`, version 1, object store `animals`, keyPath `id`:

```js
{
  id: 'uuid',
  name: 'Sir Biscuit',
  species: 'cat' | 'mystery critter' | ...,
  sticker: Blob,            // PNG with transparency, cropped
  takenAt: 1759400000000,   // ms since epoch
  location: { lat, lon, accuracy } | null   // accuracy in metres
}
```

The original photo is **not** stored (it saves space). This is why Re-cut works only in the preview.
If you change the shape, bump the DB version and migrate in `onupgradeneeded`.

## Dependencies (all from CDNs, no install)

- `@mediapipe/tasks-vision@0.10.35` from jsdelivr (ES module + `wasm/` folder).
  **Do not upgrade to 1.x without rework:** 1.0 replaced the `segment(image, {keypoint})` API of
  `InteractiveSegmenter` with a strokes API (the old one is now `InteractiveSegmenterLegacy`).
- Models from `storage.googleapis.com/mediapipe-models/`:
  `object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite` (7 MB) and
  `interactive_segmenter/magic_touch/float32/1/magic_touch.tflite` (6 MB). Both send CORS headers.

## Run locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

`localhost` counts as a secure origin, so the service worker works. On a desktop the file input opens
a file picker, not the camera. To test on the phone, use the GitHub Pages URL (the phone needs HTTPS).

## Testing

- `node test.mjs`: pure logic. Fast. Run it after any change to `lib.mjs`.
- `./e2e/run.sh`: the real app in headless Chrome. It downloads a cat photo once (to `e2e/cat.jpg`,
  gitignored), puts it into the file input, waits for the preview, clicks Keep and checks that the
  gallery has one tile. It prints `OK species=cat ... transparent=30% ... tiles=1` and exits 0, or `FAIL ...`.
  It needs network (the first run downloads the models) and Google Chrome in `/Applications`.
  The harness reports back by requesting `/result?<message>`, which shows up in the server log.
- Screenshot of the running app: start Chrome with `--remote-debugging-port` and call
  `Page.captureScreenshot` over CDP (Node 20 needs `--experimental-websocket`).

## Deploy (GitHub Pages)

1. One-time setup (the repo must be **public** for free Pages): in the repo → Settings → Pages → Source "Deploy from a branch", branch `main`, folder `/`.
2. Bump `SHELL_CACHE` in `sw.js`, commit, push to `main`. Pages rebuilds in about a minute.
3. URL: `https://dbeltra.github.io/pet-catcher/`. All paths in the app are relative, so the subpath works.

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
- No place names, only coordinates with an OpenStreetMap link. A reverse geocoder (Nominatim) could add them.
- No export/backup. Data lives in one browser on one phone.
- Ideas: species via Claude vision, Supabase sync, a map of catches, rarity/stats, sharing a card as an image.
