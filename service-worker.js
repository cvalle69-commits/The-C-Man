const CACHE_NAME = 'the-c-man-v7';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './maze.js',
  './game.js',
  './head.png',
  './head-transparent.png',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './audio/pacmansmusic.mp3',
  './audio/du-hast.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
