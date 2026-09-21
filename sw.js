/* Guarda la página completa para que abra y recargue sin conexión. No hay nada más que guardar:
   la app no pide nada a ningún servidor ajeno. Al cambiar algo, sube VERSION. */
const VERSION = "metro-denuncias-v6";
const ARCHIVOS = ["./", "index.html", "estilo.css", "app.js", "datos.json"];

// GitHub Pages sirve con max-age=600: un fetch normal puede devolver, durante diez minutos, el
// archivo VIEJO desde la caché HTTP del navegador aunque el servidor ya tenga el nuevo. Por eso
// todo se pide con cache: "no-cache" (revalida siempre con el servidor; si no cambió, es un 304).
const fresco = (req) => fetch(req, { cache: "no-cache" });

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(ARCHIVOS.map((a) => fresco(a).then((r) => { if (!r.ok) throw new Error(a); return c.put(a, r); }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero para no servir una versión vieja el día de la demo; si no hay red, lo guardado.
self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET") return;
  ev.respondWith(
    fresco(ev.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(ev.request, copia)); }
      return r;
    }).catch(() => caches.match(ev.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
