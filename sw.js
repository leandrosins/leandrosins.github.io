// Service worker : met tout le site en cache pour un usage 100 % hors ligne.
// Pensez à incrémenter VERSION à chaque modification des fichiers listés.
var VERSION = 'v8';
var CACHE = 'leandro-tools-' + VERSION;
var FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/home.css',
  'assets/js/register-sw.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/leandrosins_logo.jpg',
  'tools/retouche/',
  'tools/retouche/index.html',
  'tools/retouche/retouche.css',
  'tools/retouche/retouche.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true });
    })
  );
});
