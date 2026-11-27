// Caches the app so it opens offline once installed.
const CACHE = 'screenrec-1795738995';
const ASSETS = ["./", "./clipstore.js", "./editor.css", "./editor.html", "./editor.js", "./gate-processor.js", "./hub.css", "./i18n.js", "./icons/icon128.png", "./icons/icon16.png", "./icons/icon192.png", "./icons/icon32.png", "./icons/icon48.png", "./icons/icon512.png", "./index.html", "./manifest.webmanifest", "./pwa.js", "./recorder.css", "./recorder.html", "./recorder.js", "./timer-worker.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
