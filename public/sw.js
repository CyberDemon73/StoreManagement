/* Avenue Stock service worker — phase 1 offline strategy.
 *  - App shell & static assets: cache-first (versioned by SW_VERSION; old caches purged on activate).
 *  - GET /api/v1/products*, /variants*, /brands, /categories, /settings: stale-while-revalidate (24 h).
 *  - Navigations: network-first, fallback to the cached page, then /offline.
 *  - Mutations (POST/PATCH/DELETE) and /analytics: network-only, never cached.
 *  - "SKIP_WAITING" message from the page applies an update (the page shows UpdateAvailableToast).
 */
const SW_VERSION = 'v2';
const SHELL = `avenue-shell-${SW_VERSION}`;
const DATA = `avenue-data-${SW_VERSION}`;
const PRECACHE = ['/offline', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
const DATA_PATTERNS = [/^\/api\/v1\/products/, /^\/api\/v1\/variants/, /^\/api\/v1\/brands/, /^\/api\/v1\/categories/, /^\/api\/v1\/settings/];
const DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  // Logout / user switch: drop every per-user cached response so a seller cannot read a
  // manager's cached catalogue (cost / margin) on a shared till.
  if (event.data.type === 'CLEAR_DATA') event.waitUntil(caches.delete(DATA));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return; // mutations are network-only

  if (url.pathname.startsWith('/api/v1/analytics') || url.pathname.startsWith('/api/v1/auth')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (DATA_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })
        .catch(async () => (await caches.match(req)) || (await caches.match('/offline')) || Response.error()),
    );
  }
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) { const c = await caches.open(cacheName); c.put(req, res.clone()); }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const body = res.clone().body;
      cache.put(req, new Response(body, { status: res.status, headers }));
    }
    return res;
  }).catch(() => undefined);
  if (cached) {
    const at = Number(cached.headers.get('x-sw-cached-at') || 0);
    if (Date.now() - at < DATA_MAX_AGE_MS) { fresh.catch(() => undefined); return cached; }
  }
  return (await fresh) || cached || Response.error();
}
