// App instalable: las pantallas y la API van siempre al servidor (los datos tienen que estar al día).
// Solo se guardan los archivos compilados de spa/assets, que cambian de nombre en cada versión.
const CACHE = 'gc-assets-1';
const SIN_CONEXION = '<!doctype html><html lang="es-AR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>'
  + '<body style="font-family:system-ui,sans-serif;background:#f7f3ea;color:#1c1917;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">'
  + '<div><h1 style="font-weight:600">Sin conexión</h1><p>Revisá el wifi o los datos y volvé a intentar.</p>'
  + '<button onclick="location.reload()" style="font:600 15px system-ui;padding:12px 20px;border:0;border-radius:8px;background:#b8432a;color:#fff">Reintentar</button></div>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => new Response(SIN_CONEXION, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  if (new URL(r.url).pathname.includes('/spa/assets/')) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(r).then((g) => g || fetch(r).then((resp) => {
      if (resp.ok) c.put(r, resp.clone());
      return resp;
    }))));
  }
});
