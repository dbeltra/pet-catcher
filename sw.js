importScripts('version.js'); // bump VERSION there on every deploy, or phones keep the old app
const SHELL_CACHE = `shell-${self.VERSION}`;
// Models, the MediaPipe library and the font live in their own cache, so a deploy does not re-download 13 MB.
// Other origins (the Nominatim place lookup) are never cached.
const CDN_CACHE = 'cdn-v1';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = ['./', 'index.html', 'version.js', 'style.css', 'app.js', 'lib.mjs', 'manifest.webmanifest', 'icon-192.png?v=6', 'icon-512.png?v=6', 'seed/kurko.png', 'seed/kiffy.png',
  ...['book', 'cake', 'camera', 'folder', 'gallery', 'heart', 'magnifier', 'map', 'shine', 'star', 'male', 'female', 'question-mark'].map(n => `assets/icons/${n}.png`)];

self.addEventListener('install', e => e.waitUntil(
  // cache: 'reload' skips the HTTP cache: GitHub Pages sends max-age=600, so a plain addAll right after a
  // deploy can store the old index.html next to the new version.js (seen in v0.3.1).
  caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== CDN_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

// Cache first, then network. Anything new gets cached on the way through.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const cache = url.origin === location.origin ? SHELL_CACHE : CDN_HOSTS.includes(url.hostname) ? CDN_CACHE : null;
  if (e.request.method !== 'GET' || !cache) return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(cache).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
