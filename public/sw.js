/* Orpa service worker — offline caching for app-like use */
const CACHE = 'orpa-v2';

/* Core files that make up the app shell. */
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* External export libraries (Excel + PDF). Cached opportunistically so the
   app keeps working offline after the first online load. */
const CDN_ASSETS = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE_ASSETS);
    // CDN files may fail if offline at install time — don't block the install.
    await Promise.allSettled(CDN_ASSETS.map((u) =>
      fetch(u, { mode: 'cors' }).then((r) => r.ok && cache.put(u, r.clone()))
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isCDN = CDN_ASSETS.some((u) => req.url.startsWith(u.split('/').slice(0, 3).join('/')));

  // Never cache API calls or live socket traffic — always hit the network.
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/'))) {
    return; // let the browser handle it normally
  }

  // Same-origin app files: network-first (always fetch the freshest version,
  // fall back to cache only when offline). This means users automatically get
  // the latest app after each deploy — no more CTRL+SHIFT+R hard refresh.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // CDN libraries: stale-while-revalidate.
  if (isCDN) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const fetching = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetching;
    })());
  }
});
