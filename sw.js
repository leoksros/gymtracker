/* Service worker mínimo: cachea los assets estáticos para uso offline. */
// Subí este número cada vez que cambies index.html, style.css o app.js:
// al activarse, el SW borra las caches viejas y vuelve a bajar todo.
var CACHE = 'gym-tracker-v4';

var ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll falla entero si un recurso falla; los cacheamos de a uno
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          console.warn('[sw] no se pudo cachear:', url);
        });
      }));
    }).catch(function (err) {
      // Si CacheStorage no está disponible (modo privado, cuota, perfil roto)
      // igual dejamos que el SW se instale: sin offline, pero sin romper la app.
      console.warn('[sw] CacheStorage no disponible:', err);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Tocar la notificación abre (o trae al frente) la app.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // caches.match puede rechazar si CacheStorage no está disponible
  function safeMatch(request) {
    return caches.match(request).catch(function () { return undefined; });
  }

  // Navegación: red primero, cae al index cacheado si no hay conexión
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return safeMatch('./index.html').then(function (r) {
          return r || safeMatch('./');
        }).then(function (r) {
          return r || new Response(
            '<h1>Sin conexión</h1><p>Abrí la app con internet al menos una vez.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  // Resto: cache primero, y si no está, red (guardando una copia)
  event.respondWith(
    safeMatch(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque') && (sameOrigin || res.ok)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); })
            .catch(function () { /* sin cache: seguimos igual */ });
        }
        return res;
      });
    })
  );
});
