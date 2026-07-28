/**
 * Service Worker for The League PWA
 *
 * Strategy:
 * - Static assets (CSS, JS, images, fonts): Cache-first
 * - HTML pages (SSR): Network-first with offline fallback
 * - Offline page cached on install
 * - Web push: show notification, focus/open the target URL on click
 */

const CACHE_NAME = 'theleague-v3';
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

/* =========================================================================
 * Web Push
 *
 * Payload contract (JSON, built server-side by src/utils/push-sender.ts
 * consumers — see docs/features/web-push.md):
 *   { title, body, url?, tag?, icon? }
 * ========================================================================= */

const DEFAULT_NOTIFICATION_ICON = '/assets/icons/pwa/icon-192.png';

// Show a notification for every push. userVisibleOnly is promised at
// subscribe time, so always render something even if the payload is
// malformed — a silent handler gets the subscription revoked by browsers.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload — fall through to defaults.
  }

  const title = typeof data.title === 'string' && data.title ? data.title : 'The League';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: typeof data.icon === 'string' && data.icon ? data.icon : DEFAULT_NOTIFICATION_ICON,
    badge: DEFAULT_NOTIFICATION_ICON,
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  };
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click: focus an existing tab on our origin (navigating it to the target
// URL), otherwise open a new window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer a tab already showing the target URL, else any tab.
      const target = new URL(url, self.location.origin);
      const exact = windowClients.find((c) => {
        try {
          return new URL(c.url).pathname === target.pathname;
        } catch {
          return false;
        }
      });
      const client = exact || windowClients[0];

      if (client) {
        try {
          await client.focus();
          if (!exact && 'navigate' in client) {
            await client.navigate(target.href);
          }
          return;
        } catch {
          // Fall through to opening a new window.
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});
