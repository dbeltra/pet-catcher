# Bichidex

(The app was called "Pet Catcher" until v0.11; the repo, the URL and some internal ids still use `pet-catcher`.
**Never rename these:** the IndexedDB name `pet-catcher` (her data lives there) and `app: 'pet-catcher'` in
backups (`parseBackup` checks it). The manifest `id` is `bichidex` since v0.11.1, see Deploy.)

A PWA (installable web app) for the phone. You take a photo of an animal. The app finds the animal,
cuts it out like a sticker, puts it on a card and saves it. You browse your collection, see the
date, time and place of each catch, and rename the animals (each one gets a random name first).

Personal project of David (GitHub `dbeltra`). **It is a birthday gift for his girlfriend Mari, a pet lover.**
Everything she sees should feel warm and personal; never ship something that can lose her data.

**Always light:** no dark theme (`color-scheme: light`), also when the phone is in dark mode (David's choice, v0.13.1).

**The UI language is Spanish.** The verb is "atrapar", never "cazar" (David, v0.15). All visible text, species names and random names are Spanish.
The look is kawaii but **not girly**: soft butter-yellow accent (`--accent: #f7d98b`) with dark-brown text on it,
the light cream polka-dot background (`--bg: #fffdf5`, softer dots since v0.13), butter/mint/sky/peach/pistachio pastels, the rounded font Fredoka, kaomoji,
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
| `manifest.webmanifest`, `favicon.ico`, `apple-touch-icon.png`, `icon-*.png` | PWA install data and icons (see App icons). |
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
   - `keepComponent` then keeps only the region under the keypoint (plus pieces ≥ 15% of its size, e.g. a
     split-off tail) and drops isolated bits elsewhere in the photo.
   - `applyMask` makes the background transparent; the result is cropped to the mask box plus `PAD`.
6. The preview card shows the sticker, a random name, the species (both editable), date/time and place.
   The place lookup (`resolvePlace`) starts as soon as the position is known.
   Buttons: Descartar, ✂️ Recortar otra vez, ¡Me lo quedo! Re-cut (`pickAndCut` / `askSpot`): a tap picks the
   animal; a finger loop around it (v0.21, drawn as a dashed SVG over the photo) cuts the AI mask to the inside of the
   loop (`lassoMask` + `clipMask`, keypoint `innerPoint`); if the AI finds nothing inside, the loop itself is the
   cutout. The same picker is used when nothing is detected.
   "✍️ A mano" (v0.22, the last resort, `handCut`): a full-screen editor on the photo at 2048 px; one finger draws the
   outline (sections join, "Deshacer" removes the last), two fingers / mouse wheel zoom to 8× and move, a magnifier
   (`.loupe`, 2.5×) sits above the finger. "Listo" cuts the photo to the outline with a 1 px blurred edge
   (canvas `destination-in`), cropped to it plus `PAD`. Cutout order: auto → loop refinement → by hand.
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
| `slide-left` / `slide-right` | tab switch (direction from the order in `TABS`) | `main` (`content`) swings out to one side and bounces in from the other; the tab pill (`#tabs .pill`, its own element behind the labels, `placePill()`) slides by CSS transition inside the live header snapshot (no header cross-fade) |
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
- Closing while the back shows: `backToList` first turns the card to the front (`turnCard`, 2×130 ms, in place
  where a swipe left it, in parallel with the list render), then shrinks it.
- Closing must start at once: the browser freezes the old screen until the update callback is done. So
  `backToList` rebuilds the list and decodes every tile image *before* the transition (except on the map tab),
  then hides the card's text (`.leaving`, no fade) and starts it. Measured: shrink starts ~35 ms after the text goes.
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
  first open **of the installed app** (`display-mode: standalone` / `navigator.standalone`), never in a browser
  tab, so David can install it on her phone without seeing it. It is marked seen (`localStorage` `bday-seen`)
  only when its button is tapped: closing the app without tapping keeps it for next time. Replay: tap the ✿ next to the title, or open with `?cumple`. (`?shiny` makes every catch shiny, for testing.)
  Its button also asks for `DeviceOrientationEvent.requestPermission()` (iOS needs a tap for the holo tilt).
- **Recuerdos (her past pets):** `SEEDS` in `lib.mjs` (Kurko 🐶 perro, Kiffy 🐱 gato) with fixed ids
  `seed-kurko` / `seed-kiffy`. `ensureMemories()` re-adds any that is missing on **every** start, so they can
  never be lost; the card has no "Liberar" button. They have `memory: true`, `fav: true`, no date (the card says
  "Un recuerdo para siempre"), and the place where they lived: Martos, Jaén (37.7197, -3.9697, set in `SEEDS`;
  `ensureMemories` also gives it to older memories without a location), so they show on the map, a golden glowing frame and a "Recuerdo" ribbon, and sort first.
  Their stickers are `seed/kurko.png` / `seed/kiffy.png`, cut from David's photos with the app's own pipeline
  (v0.11.2; Kurko is cropped as a bust because the segmenter took his owner's lap too). Each seed has a `photo`
  version; `ensureMemories()` gives a memory a newer seed photo (`seedPhoto` < `photo`) unless it was changed
  by hand ("📷 Foto" sets `customPhoto`). To ship a new seed photo: replace the file and bump its `photo`.
- **Favourites:** ❤️ button on the card; the "❤️ Favoritos" filter chip (`FAV`). (The note field was removed in v0.19.1.)
- **Gallery import** (🖼️ next to "¡Atrapar!", an input without `capture`): `onPhoto(file, true)` takes the date
  and GPS from the photo's EXIF (`readExif` in `lib.mjs`), not now/here. Phones often strip GPS from picked
  photos; then the place says "Elegir lugar".
- **Set the place by hand:** tapping the 📍 line of any card opens `pickLocation()` (a `<dialog>` with a Leaflet
  map): tap to drop the pin, search a name (Nominatim `search`), or "📍 Mi ubicación". The dialog focuses its
  title, not the search field, so no keyboard pops up.
- **The catch buttons stay on top** in every transition: `#shoot` has its own view-transition-name (`fab`)
  with `z-index: 100`.
- **Collection numbers** (`numberAll`, `fmtNo`): every record gets `no` once, in catch order; the memories
  first (Kurko #001, Kiffy #002, in `SEEDS` order), then by catch time. Shown above the tile name and in the
  card's rarity line. Memories sort by number. A restored new animal whose number is taken gets a fresh one.
- **Shared origin:** `dbeltra.github.io` also hosts David's other apps (sitges-planner…), so localStorage, cookies and
  "clear site data" are shared with them. Never `localStorage.clear()`; remove only Bichidex's keys.
- **Reset** ("🗑️ Restablecer la app" in settings, two confirms): deletes the IndexedDB and Bichidex's localStorage keys and
  reloads, so the app starts like the first day. The cached models stay.
- **Settings** ("⚙️ Ajustes" link next to the version at the bottom of the list; a native `<dialog>`; David
  did not want it in a primary spot): backup, restore, "🎂 Ver la felicitación", version.
- **Backup / restore** (in settings): "💾 Guardar copia" writes all animals (stickers as data URLs) plus the `meta`
  store to `pet-catcher-YYYY-MM-DD.json`, through the share sheet when possible (iOS standalone downloads are
  unreliable), else a download. "📂 Restaurar" merges by id (never deletes); `parseBackup` validates.

- **Album** (tab `📖 Álbum`, between Colección and Mapa): `albumSlots()` gives one slot per known species,
  grouped by rarity, plus caught custom species; a progress bar "N / M especies". Missing slots show a grey
  emoji and "???"; a caught slot shows its newest sticker and opens the collection filtered to it.
- **Rarity** (`rarityOf` / `rarityFor`): común, raro (blue frame), épico (gold frame + soft shine), legendario
  (holographic). Custom species are raro; her Recuerdos are always legendario. The shine is a rainbow
  layer (each tile starts it at its own point, `--foil-delay`, so neighbours never shine together) that follows the phone tilt (`deviceorientation` → `--hx/--hy`, class `html.tilt`) or drifts. On tiles and
  cards it is a real element (`.foil`), so it gets its own view-transition-name and flies above the sticker
  during open/close (as a `::after` of the card it vanished behind the flying sticker). The "Recuerdo" ribbon
  gets the same treatment (`ribbon`, z-index 4), or it slid under the photo and popped back at the end. Album slots use `::after`.
  Use normal blending: `color-dodge` washes out to white on the pastels.
- **Shiny:** every new catch (not a Recuerdo, not a "Ya lo tenía" visit) rolls `rollShiny()` with
  `SHINY_CHANCE = 1/15`, whatever its species. A shiny gets a stronger sparkling rainbow foil (`.shiny > .foil`),
  "· ✨ Shiny" after the rarity, ✨ on the tile, a special toast + confetti in the preview, and the "¡Un shiny!"
  achievement. Text and buttons sit above the foil (z-index 3) so it never washes them out.
- **Gender** (`gender`: `m` / `f` / `x` = unknown, the default; "Macho · Hembra · No sé" with David's male/female/question-mark icons on the back of the card,
  chosen at catch time or later): while the random name is untouched (`nameAuto`), changing it picks a new
  random name with a matching title and word (`randomName(g)`: 16 masculine words for males, 16 feminine for females,
  all 32 for unknown; "Don Churro", "Doña Galleta", "Mini Pompón"). Traits are stored in the masculine form
  and shown by gender (`traitLabel`: Glotón / Glotona / Glotón/a; `traitKey` maps what she types back). The tile
  shows nothing: gender lives only on the back of the card (David). Kurko and Kiffy are males, shown as fixed text.
- **Traits** (flip the card): 3 random `TRAITS` with 1-5 stars on each new catch and memory.
  Editable on the back: rename (with suggestions) and tap stars. `flip()` turns the card with
  the Web Animations API (0→90°, swap faces via `.show-back`, -90→0); no 3D wrapper. The card keeps the front's
  Both faces share the card's fixed 5:7 shape.
  Edits change rows in place: never rebuild the list. On a flip the rows are simply there; only an added row
  pops in (`li.new`). Every card shows its rarity line, "Común" included. The species field has no underline
  and is as wide as its text, so emoji + word sit centred.
  The ▾ Chrome draws on datalist inputs is hidden (`::-webkit-calendar-picker-indicator`).
- **Gestures** (`swipes()`, touch events, no buttons for these; they work from anywhere on the card, text fields
  included: a tap still edits, a real swipe flips and closes the keyboard; the hint sits below the card, has a ✕,
  and disappears for good (`localStorage` `gestures-learned`) after the ✕ or once she has swiped to flip and to close): sideways swipe turns the card with the finger and
  flips past 60 px (a tap on the photo or the back's title flips too); swipe down (with `#view` at the top) or up (at the bottom),
  closes the detail past 110 px (never on a new catch). The detail is a history entry (`pushState`), so the
  phone's Back gesture closes it as well; everything that closes a detail goes through `history.back()`.
- **Trading-card shape** (v0.17.3): tiles and the big card are 5:7 (63 × 88 mm, `aspect-ratio: 5 / 7`); the big card
  is no taller than the screen and sits in its middle (`#card { margin-block: auto }`). The text keeps its size and the photo area (`.sticker-wrap`, `flex: 1`) takes what
  is left, so a card with more lines has a smaller photo. A long back (many traits) scrolls inside the card. Same
  shape on both faces, so no height syncing is needed. Tile names are one line (ellipsis).
- **Without swipes:** the ↔️ and ⬇️ in the hint are buttons (flip / close), and the keyboard's ← → ↓ do the same
  (`cardKeys`, ignored while typing or with a dialog open).
- **The open card is a fixed full-screen layer** (`#view`, `overscroll-behavior: contain`) sized to fit a phone
  screen (sticker max 30dvh, one row of short action labels): the app behind never scrolls. Pull-to-refresh is
  off for the whole app (`overscroll-behavior-y: none` on html/body): a pull at the top reloaded the page
  instead of closing the card. Check the fit at 390×760 when adding anything to the card.
- **No pop-in of the card contents on open** (removed in v0.9.3: the staggered rise read as flicker); the card
  morph and the flying sticker are enough. The ❤️ pop is a Web Animation started by the click. A CSS animation tied to a class that changes later
  replays and looks like flicker (v0.8.0 bug).

- **Achievements** (`ACHIEVEMENTS` in `lib.mjs`, 16, feminine forms because they are for Mari): shown under
  the album as badges. `checkAchievements()` runs after a keep, a visit, a card edit and a restore; it
  compares with `meta.unlocked` and celebrates new ones with a toast + confetti burst. The very first run only
  records the baseline (no toast during the birthday). Her Recuerdos never count as catches.
- **Re-encounters** (`visits`): "👀 ¡Lo he vuelto a ver!" on a card adds a visit (now, here); "🔁 Ya lo tenía"
  in a new catch's preview opens a picker, and the catch's time and place become a visit of the chosen animal
  (no new card). The card shows "Visto N veces · la última…", the tile "👀N", the map a smaller pin per visit.
  Visit places resolve like catches (`resolvePlace` on the visit; `renderList` retries).

- **Animation performance rule (v0.18.5):** looping animations may only change `transform` or `opacity` (the GPU
  does those without repainting). The foil shine is an oversized `.foil::before` that slides; sparkles and the
  memory glow fade on their own layers. Animating `background-position`, `box-shadow` or `filter` in a loop dropped
  the list to 29 fps on a 6×-throttled phone (60 fps after). Album slots keep a still foil.
  Even GPU-only, the running foil animations made the browser recalculate styles every frame while scrolling, so they
  pause during a scroll (`html.scrolling`, set by a scroll listener, cleared 200 ms after; `!important`, or the more
  specific foil rules reset it): scroll work at 6× CPU 1.98 → 0.98 s.

- **David's letters** (`NOTES`, `DATE_NOTES`, `dueNotes` in `lib.mjs`; texts are David's, word for word): moments
  (1st / 10th / 50th catch, 1st shiny, 1st legendario, a sighting 23:00–6:00, a sighting 6:00–7:00, 1st gold
  friendship, 1st favourite, 1st catch in Japan via `country` from the place lookup) and dates every year (Sant
  Jordi 23/4, aniversario 18/4, Navidad, Año nuevo, cumpleaños 15/10 except 2026). Her Recuerdos never count.
  `checkNotes()` shows the next due letter as an envelope (`#letter`), **only on the list screen** (never over a
  card, a catch, the birthday or a dialog); opened ones go to meta `notes-opened` and Ajustes → "💌 Cartas".
  Each letter has a `why` ("Tu primer shiny", "Sant Jordi 2027"; `noteWhy`), shown on the envelope and in the list.
- **Sticky header** (v0.19.11): the title scrolls away; the tabs and one row (`#controls`: funnel sort select + filter
  chips + ⚙️ settings button) stay pinned. During tab and filter transitions only, the header has its own
  view-transition-name above the sliding content (on card open/close it must not, or it faded out by itself)
  (v0.20: cards slid over it). A tab switch scrolls back to the top of the new tab, keeping the header pinned.
  Filters: chips when they all fit in the row, otherwise one dropdown (`#filter-select`) with the same choices;
  `fitFilters()` measures on every render and resize, so it follows the screen width and her number of species. `pinHeader()` sets `header.style.top` from where the tabs start (again after fonts load / resize).
- **Speed with many catches (v0.20):** each record has `thumb` (≤ 320 px WebP, `makeThumb`), used by tiles, map pins and
  album slots; the full `sticker` only for the open card. `ensureThumbs()` fills old/restored records in the background;
  backups leave thumbs out. Tile images are `loading="lazy"`; closing a card only decodes the target tile's image
  (decoding all of them, or a lazy one, made the close wait). Measured at 6× CPU, 82 cards: close 286 → 200 ms.
- **Model download:** ~25 MB (vision runtime 11 MB + 2 models). `prefetchModels()` downloads them with a progress
  count (the SW caches them): in the background 5 s after start (not on cellular / data saver), or on the first catch
  with "Descargando el detector… N%" and a bar.
- **Backup reminder** (`needsBackupReminder`): after 20 new catches since the last copy, or 30 days (since the last copy,
  or her first catch) with something new, the app asks "¿Guardamos una copia?"; "Ahora no" waits 7 days. Meta `backup`
  ({ at, count }) is set by every saved copy; `backup-snooze`. Runs after the letters, on the list screen only.
- **Map pin groups** (`clusterPoints`): pins within 46 px merge into a bubble with a count; tapping zooms to fit the group;
  at one spot it fans out one pin per animal (circle up to 8, else a sunflower spiral). Regrouped on every zoom.
- **Album counts only her catches** (not Kurko and Kiffy). Its pinned row has two chips (`#album-jump`) that scroll
  smoothly to "Especies" or "Logros".
- **Kurko and Kiffy's traits are fixed** (`SEEDS[].traits`, all 5 stars, `seedTraits`; reapplied on every start, read-only
  on the card): Kurko Glotón, Cariñoso, Aventurero; Kiffy Sigiloso, Glotón, Temperamental.
- **Sorting** (v0.19.8; `SORTS`, `sortAnimals` in `lib.mjs`): funnel sort select (David's icon, `assets/icons/filter.png`) at the start of the filter row (native `<select>`,
  shown in Colección with 3+ cards): Recientes, Número, Nombre (A–Z, accents ignored), Rareza (legendario first, shiny
  before non-shiny), Amistad (most seen first). Kurko and Kiffy stay first in every order. Combines with the filters;
  remembered in `localStorage` `sort` (cleared by the reset).
- **Card layout (v0.19.1):** the front is photo-first: photo, name, species, number · rarity, and date · place on one
  line. The back has gender, traits, then friendship · sightings on one line ("🥉 Bronce, 2 más para plata · 👀 3 veces")
  , the last sighting ("Última vez: 5 oct 2026, 13:40 · Sitges, Garraf") and a saved card's buttons (¡Otra vez!, Foto,
  Liberar) on one line. "¡Otra vez!" redraws the card on the back (it lives there), never jumping to the front (they shrink on narrow phones, never wrap).
  A new catch keeps its buttons on the front. Exactly 3 traits, editable, no add / remove (v0.19.4), so the back
  never scrolls (`overflow: hidden`; scrolling inside it fought with the swipes). Checked down to 320 px wide.
- **Live vs. imported (v0.23.4):** each catch and visit can carry `live: false` (a gallery photo, or "Ya lo tenía" with
  one) and `placeManual: true` (place pinned by hand). Time rules (night / early letters and achievements) count only
  live sightings; place rules (Japan letter, Viajera, Trotamundos) only live sightings with a GPS place. Counts,
  shiny, rarity and favourites count everything. No flag = live (older records).
- **Friendship** (`friendshipOf`): 3 sightings bronce 🥉, 5 plata 🥈, 10 oro 🥇. A metal ring inside the card
  (`data-friend`), the medal after the number on the tile, a line on the card, a toast (confetti at gold).
- **Diary** (v0.23, `openDiary`): tapping the friendship line on the back (it has "›" once seen again) opens a pop-up:
  every sighting newest first (the catch marked "⭐ atrapado") with date, time and place, and a mini map (`#diary-map`).
- **Sounds** (v0.23): tiny Web Audio blips, no files (`SOUNDS` / `sfx()`): shutter on a camera catch, pop on flip, reveal
  (or sparkle for a shiny), chime when a letter opens, boop when petting, level-up for friendship and achievements.
  "🔊 Sonidos" switch in Ajustes (localStorage `sound`).
- **Credits** in Ajustes: David Beltrà, author · Claude (Anthropic), co-author · link to the GitHub repo.
- **Pack reveal** (`reveal()`): a new catch arrives face down (`.cover`, the Bichidex card back), wobbles, flips, and
  a flash in its rarity colour (rainbow for a shiny) bursts out. Skipped with reduced motion.
- **Petting** (`pet()`): press and hold the photo → the animal wiggles, 7 hearts float up, a short vibration.
  A long press never flips the card (`petted` flag) and shows no "save image" menu.

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
  fav: false,
  memory: false,                     // true for her past pets (SEEDS)
  seedPhoto: 2, customPhoto: false,  // memories only: which seed photo it shows / photo changed by hand
  traits: [{ name: 'Dormilón', stars: 1..3 }],
  country: 'es' | null,              // from the place lookup (for the Japan letter); also on each visit
  live: true, placeManual: false,     // camera catch / place from GPS (see "Live vs. imported")
  visits: [{ at, location, place, country, live, placeManual }], // re-encounters
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
  Each later version adds its own checks to the same line. It also guards two styles (birthday layer, tab
  transition name), because v0.13.0 silently lost a whole CSS block. **When editing `style.css` with a script,
  never replace a range between two markers: replace exact rules.** `harness.html` needs its `<meta charset>`: without it "¡" breaks the button lookup.
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

**Do not change `id` in `manifest.webmanifest`** (`bichidex` since v0.11.1) unless an install is stuck.
Chrome identifies an installed app by it. Twice on David's phone, after an uninstall, Chrome on Android kept a
stale "already installed" record and only offered a shortcut (v0.5.1: implicit id → `pet-catcher`; v0.11.1:
`pet-catcher` → `bichidex`). A new id is the only fix that keeps the data: IndexedDB belongs to the origin.
**Icons carry `?v=N`** in the manifest, the `<link>`s and the SW `SHELL` (like David's scheduler app): bump N
whenever the icon changes, so Chrome sees a new icon URL and updates the installed app by itself.
**To get a new name or icon, do not reinstall:** Chrome on Android updates an installed app's name and icon
from the manifest by itself (it can take up to a day and may ask to confirm).

Install on the phone: Android Chrome → menu → "Install app". iPhone Safari → Share → "Add to Home Screen".

## App icons

The icon is a notebook with an orange cat, made by David with an icon generator (v0.17; `~/Downloads/app-icons/web`).
Files at the root: `favicon.ico`, `apple-touch-icon.png` (iPhone), `icon-192/512.png`, `icon-192/512-maskable.png`
(Android shapes). To change it, replace those files and bump `?v=N` in the manifest, the `<link>`s and the SW `SHELL`.

## Known limits and ideas for next iterations

- The detector knows only 10 animals. Anything else goes through the tap fallback.
- An animal that fills more than 90% of the photo is taken as background, and the tap prompt
  repeats with no way out (no Back button during a tap). Add a Back button if this happens in practice.
- Not yet tested on a real phone: EXIF rotation of camera photos, the location line with real
  coordinates, iOS Safari in standalone mode.
- The mask edge is hard (no feathering). Fix: blur the alpha a little before cropping.
- The location is where the phone is when you pick the file, not EXIF GPS (camera captures usually
  strip GPS anyway).
- No export/backup. Data lives in one browser on one phone.
- The detector's species list is fixed; custom species are free text, so typos make separate filter chips.
- Ideas: species via Claude vision, Supabase sync, a map of catches, rarity/stats, sharing a card as an image.
