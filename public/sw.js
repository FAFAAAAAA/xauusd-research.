/* XAU app: keep the app shell on the phone so opening the installed app is instant.
   - /_next/static/* and icons: cache first (file names change on every deploy)
   - the office page: show the cached copy right away and refresh it in the background; other pages: network first
   - /api/*: never cached here (the app keeps its own last data) */
const CACHE = 'xau-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const key = url.pathname;
      const net = fetch(req).then((res) => { if (res.ok && !res.redirected && res.type === 'basic') c.put(key, res.clone()); return res; });
      // the office (home) opens from the cache at once; other pages try the network first (always the newest build)
      if (key === '/') { const hit = await c.match(key); if (hit) { e.waitUntil(net.catch(() => {})); return hit; } return net; }
      return net.catch(async () => (await c.match(key)) || Response.error());
    }));
  }
});
