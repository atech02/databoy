const CACHE_NAME = "databoy-cache-v10";
const OFFLINE_URL = "/offline";

const ASSETS_TO_CACHE = [
  "/favicon.ico",
  "/manifest.json",
  "/brand-pack/Favicons/favicon-32x32.png",
  "/brand-pack/App-Icons/app-icon-192x192.png",
  "/brand-pack/App-Icons/app-icon-512x512.png",
  "/brand-pack/Dark-Version/logo-dark.svg",
  "/brand-pack/Light-Version/logo-light.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const acceptHeader = event.request.headers.get("accept") || "";

  // 1. HTML Navigation Requests (Network-First Strategy)
  if (event.request.mode === "navigate" || acceptHeader.includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline, try to get the cached version of the requested page first,
          // otherwise serve the offline page fallback.
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // 2. Static Shell Assets (Cache-First Strategy)
  const isStaticAsset = ASSETS_TO_CACHE.some(asset => url.pathname === asset);
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Fallback for other requests (Network-First/Fetch-Only)
  // We do NOT cache Next.js static chunks or database calls to avoid caching dynamic state.
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
