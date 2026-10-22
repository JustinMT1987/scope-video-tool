self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});
self.addEventListener('fetch', (e) => {
  // Network first for everything; cache optional
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});