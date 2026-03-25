/**
 * Service Worker for The League PWA
 *
 * Strategy:
 * - Static assets (CSS, JS, images, fonts): Cache-first
 * - HTML pages (SSR): Network-first with offline fallback
 * - Offline page cached on install
 */

const CACHE_NAME = 'theleague-v2';
const OFFLINE_URL = '/offline.html';

// Assets to pre-cache on install
const PRECACHE_URLS = [OFFLINE_URL];

// Install: pre-cache the offline page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip cross-origin requests (fonts, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Static assets: cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages: network-first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

/**
 * Check if a URL is a static asset that benefits from caching.
 */
function isStaticAsset(pathname) {
  return /\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?|ttf|eot)(\?.*)?$/.test(pathname);
}

/**
 * Cache-first strategy: serve from cache, fall back to network.
 * Updates cache in the background on network success.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

/**
 * Network-first strategy with stale fallback.
 * 1. Try network — cache successful HTML for future fallback
 * 2. On server 5xx — serve stale cached version if available
 * 3. On network failure — serve stale cached version if available
 * 4. Last resort — offline page
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });

    if (response.ok) {
      // Cache successful HTML for stale fallback
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      return response;
    }

    // Server returned 5xx — try stale cache before passing error through
    if (response.status >= 500) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }

    return response;
  } catch {
    // Network failure — serve stale cached version if available
    const cached = await caches.match(request);
    if (cached) return cached;

    const offlinePage = await caches.match(OFFLINE_URL);
    return offlinePage || new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
