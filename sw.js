// Bump SHELL_CACHE on every deploy, or phones keep the old app.
const SHELL_CACHE = 'shell-v1';
// Models and the MediaPipe library (other origins) live in their own cache, so a deploy does not re-download 13 MB.
const CDN_CACHE = 'cdn-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lib.mjs', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== CDN_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

// Cache first, then network. Anything new gets cached on the way through.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const cache = new URL(e.request.url).origin === location.origin ? SHELL_CACHE : CDN_CACHE;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(cache).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
