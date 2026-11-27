// Service worker : met tout le site en cache pour un usage 100 % hors ligne.
// Pensez à incrémenter VERSION à chaque modification des fichiers listés.
var VERSION = 'v31';
var CACHE = 'leandro-tools-' + VERSION;
var FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/home.css',
  'assets/js/register-sw.js',
  'assets/js/home.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/leandrosins_logo.jpg',
  'tools/retouche/',
  'tools/retouche/index.html',
  'tools/retouche/retouche.css',
  'tools/retouche/retouche.js',
  'tools/mosaic/',
  'tools/mosaic/index.html',
  'tools/mosaic/mosaic.css',
  'tools/mosaic/mosaic.js',
  'tools/gif/',
  'tools/gif/index.html',
  'tools/gif/gif.css',
  'tools/gif/gif.js',
  'tools/gif/gif-worker.js',
  'tools/impressionne/',
  'tools/impressionne/index.html',
  'tools/impressionne/impressionne.css',
  'tools/impressionne/impressionne.js',
  'tools/impressionne/paint-engine.js',
  'tools/impressionne/paint-worker.js',
  'tools/croque/',
  'tools/croque/index.html',
  'tools/croque/croque.css',
  'tools/croque/croque.js',
  'tools/croque/sketch-engine.js',
  'tools/croque/sketch-worker.js',
  'tools/neon/',
  'tools/neon/index.html',
  'tools/neon/neon.css',
  'tools/neon/neon.js',
  'tools/neon/neon-engine.js',
  'tools/neon/neon-worker.js',
  'tools/pixel/',
  'tools/pixel/index.html',
  'tools/pixel/pixel.css',
  'tools/pixel/pixel.js',
  'tools/secret/',
  'tools/secret/index.html',
  'tools/secret/secret.css',
  'tools/secret/secret.js',
  'tools/secret/secret-engine.js',
  'tools/secret/secret-worker.js',
  'tools/story/',
  'tools/story/index.html',
  'tools/story/story.css',
  'tools/story/story.js',
  'tools/story/letter.js',
  'tools/noel/',
  'tools/noel/index.html',
  'tools/noel/noel.css',
  'tools/noel/noel.js',
  'tools/noel/noel-art.js',
  'assets/fonts/ebgaramond.woff',
  'assets/fonts/ebgaramond-italic.woff',
  'assets/fonts/lora.woff',
  'assets/fonts/lora-italic.woff',
  'assets/fonts/librebaskerville.woff',
  'assets/fonts/librebaskerville-italic.woff',
  'assets/fonts/cormorantgaramond.woff',
  'assets/fonts/cormorantgaramond-italic.woff',
  'assets/fonts/dancingscript.woff'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // « reload » : on prend les fichiers sur le serveur, pas une vieille copie du cache HTTP
      return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
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
// « no-cache » : le navigateur redemande toujours au serveur si le fichier a changé (réponse 304 légère
// sinon). Sans ça, il peut resservir une ancienne copie de son cache HTTP pendant des heures, en
// particulier les scripts chargés par les Web Workers, que Ctrl+Maj+R ne recharge pas.
function fresh(req) {
  if (req.mode === 'navigate') {
    return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
      // une page servie après redirection (dossier sans « / ») doit redevenir une vraie redirection
      return res.redirected ? Response.redirect(res.url, 302) : res;
    });
  }
  return fetch(new Request(req, { cache: 'no-cache' }));
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fresh(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true });
    })
  );
});
