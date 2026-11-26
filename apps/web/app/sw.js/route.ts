/**
 * The service worker, generated at build time so each build gets its own
 * cache name. It keeps the phone app (/m) and the site's static files on the
 * phone so the app opens without a signal. It never touches API calls: field
 * data is kept by the app itself (IndexedDB) and sent through its outbox.
 *
 * Build with NEXT_PUBLIC_PWA=0 to ship a worker that removes itself and its
 * caches from every phone (a kill switch).
 */
export const dynamic = "force-static";

const VERSION = `erp-${Date.now().toString(36)}`;
const ENABLED = process.env.NEXT_PUBLIC_PWA !== "0";
const PAGES = ["/m", "/m/job", "/m/asset", "/m/assets", "/m/alerts", "/m/more", "/login"];

const worker = `
const CACHE = ${JSON.stringify(VERSION)};
const PAGES = ${JSON.stringify(PAGES)};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const page of PAGES) {
      try {
        const res = await fetch(page, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) continue;
        await cache.put(page, res.clone());
        // Also keep the scripts and styles each page needs, so it renders offline.
        const html = await res.text();
        const assets = [...new Set(html.match(/\\/_next\\/static\\/[^"'\\s)]+/g) || [])];
        await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
      } catch (e) { /* offline during install: pages are cached on first visit instead */ }
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // the API and anything else: untouched
  if (url.pathname.startsWith("/api/")) return;              // same-origin API behind a proxy: untouched

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    // Fingerprinted files never change: cache first.
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (req.mode === "navigate" && (url.pathname === "/m" || url.pathname.startsWith("/m/") || url.pathname === "/login")) {
    // Pages: the network first (fresh code), the saved copy when offline.
    // One page serves every record: /m/job?id=… uses the copy of /m/job.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
        return res;
      } catch (e) {
        const hit = await caches.match(url.pathname, { ignoreSearch: true });
        return hit || caches.match("/m") || Response.error();
      }
    })());
  }
});
`;

const killSwitch = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll()) client.navigate(client.url);
  })());
});
`;

export function GET() {
  return new Response(ENABLED ? worker : killSwitch, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browsers check for a new worker on each visit; never serve a stale one.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
