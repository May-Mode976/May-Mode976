// Service worker : permet l'installation et un démarrage rapide.
// Les annonces et messages viennent toujours d'Internet (jamais mis en cache).
const VERSION = "maymode-v1";
const FICHIERS = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase : toujours en direct
  // Réseau d'abord (vos mises à jour apparaissent tout de suite), cache si hors connexion
  e.respondWith(
    fetch(e.request).then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request))
  );
});
