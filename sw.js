/* Guarda la página completa para que abra y recargue sin conexión. No hay nada más que guardar:
   la app no pide nada a ningún servidor ajeno. Al cambiar algo, sube VERSION. */
const VERSION = "metro-denuncias-v4";
const ARCHIVOS = ["./", "index.html", "estilo.css", "app.js", "datos.json"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero para no servir una versión vieja el día de la demo; si no hay red, lo guardado.
self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET") return;
  ev.respondWith(
    fetch(ev.request).then((r) => {
      const copia = r.clone();
      caches.open(VERSION).then((c) => c.put(ev.request, copia));
      return r;
    }).catch(() => caches.match(ev.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
