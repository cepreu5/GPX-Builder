/* GPX конструктор - офлайн обвивка: файловете на приложението се пазят в кеша,
   за да се отваря страницата и без връзка (картата без връзка не се зарежда,
   но запазената картина и следенето работят). Първо мрежа, после кеш. */
var CACHE = 'gpxk-v8';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/util.js', 'js/map.js', 'js/gpx.js', 'js/core.js', 'js/elev.js', 'js/snapshot.js', 'js/follow.js', 'js/app.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) { return r || caches.match('index.html'); });
  }));
});
