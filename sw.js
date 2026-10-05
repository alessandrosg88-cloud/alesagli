// Service worker de Mi presupuesto: permite instalar la app y abrirla sin conexión.
// Nunca guarda en caché las peticiones a Supabase (tus datos), solo los archivos de la propia app.
const CACHE = 'mi-presupuesto-v3';
const ASSETS = ['./', 'index.html', 'extra.js', 'monedas.js', 'supabase.min.js', 'manifest.webmanifest', 'icon.svg','privacidad.html', 'terminos.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Páginas: primero la red (siempre la versión más nueva), si no hay conexión, la copia guardada.
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
    return;
  }
  // Resto de archivos: primero la red (siempre la versión más nueva); sin conexión, la copia guardada.
  e.respondWith(fetch(req, { cache:'no-cache' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: true })));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
