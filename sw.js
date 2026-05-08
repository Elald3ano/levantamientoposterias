const CACHE = 'posteapp-v3';
const TILE_CACHE = 'posteapp-tiles-v2';
const ASSETS = [
  'icon.svg',
  'manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700;800&display=swap'
];

const TILE_HOSTS = [
  'tiles.stadiamaps.com',
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return TILE_HOSTS.some(host => url.hostname === host);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first para index.html
  if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Network-first para tiles — evita servir tiles corruptos de caché
  if (isTileRequest(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(cache => {
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            cache.put(e.request, res.clone());
          }
          return res;
        }).catch(() => cache.match(e.request));
      })
    );
    return;
  }

  // Cache-first para el resto (CDN, assets)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
