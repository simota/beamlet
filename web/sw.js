// Offline support. The pages and the wasm are cached on install; every
// request then tries the network first, so an online visit always gets the
// current files as one consistent set, and offline the cached copy answers.
// Add new files the pages load to SHELL.

const CACHE = 'beamlet';
const SHELL = [
  './',
  'index.html',
  'send.html',
  'receive.html',
  'style.css',
  'pwa.js',
  'beamlet.js',
  'images.js',
  'wasm.js',
  'send.js',
  'send-worker.js',
  'receive.js',
  'receive-worker.js',
  'spark-worker.js',
  'pkg/beamlet.wasm',
  'manifest.webmanifest',
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true })));
});
