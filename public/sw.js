/**
 * Service Worker for The League PWA
 *
 * Strategy:
 * - Content-hashed build output (/_astro/*): cache-first, kept forever. The
 *   hash IS the version, so a cached entry can never be stale.
 * - Every other static asset (/assets/**, icons, logos): stale-while-
 *   revalidate. These URLs are NOT versioned — cache-first pinned a bad or
 *   404'd logo in a phone's SW cache indefinitely, which is strictly worse
 *   than the Cloudflare 404-caching problem this file's history is full of
 *   (see roster-constants NFL_LOGO_ONERROR). SWR serves instantly and
 *   repairs itself on the next visit.
 * - HTML pages (SSR): network-first. The cached copy is a genuine-offline
 *   fallback ONLY, and it expires — see HTML_STALE_MAX_AGE_MS.
 * - Web push: show notification, focus/open the target URL on click
 *
 * Why HTML staleness is bounded (owner report, 2026-08-18)
 * -------------------------------------------------------
 * Pages are SSR and personalized, and their <link> tags point at
 * content-hashed CSS for the build that rendered them. Replaying a cached
 * document from an older deploy therefore pairs old markup with whatever
 * stylesheet that build named — the homepage hero rendered with no
 * background at all, white ink on the bare page, and "fixed itself" after a
 * few navigations once a network fetch finally succeeded. Two changes stop
 * that: a stale document is only served when the network genuinely failed
 * (never on an aborted navigation, which is routine on mobile when someone
 * taps a second link), and it is refused once it is older than
 * HTML_STALE_MAX_AGE_MS so a document can never outlive its own stylesheet.
 *
 * Bump CACHE_NAME to evict every client's cache on the next activate. That
 * is the only lever that reaches a phone already holding a poisoned entry.
 */

const CACHE_NAME = 'theleague-v4';
const OFFLINE_URL = '/offline.html';

/**
 * How long a cached HTML document may still be served as an offline
 * fallback. Past this it is treated as absent and the offline page wins:
 * a document old enough to reference a retired build is worse than an
 * honest "you're offline", because it renders as a broken live page.
 */
const HTML_STALE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Header used to age cached HTML — Date on the response is the origin's. */
const CACHED_AT_HEADER = 'x-sw-cached-at';

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

  // Content-hashed build output: cache-first, immutable.
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Unversioned static assets: serve fast, repair in the background.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  // HTML pages: network-first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

/**
 * Build output from Astro/Vite. The filename carries a content hash, so the
 * URL changes whenever the bytes do and a cached entry is never stale.
 */
function isImmutableAsset(pathname) {
  return pathname.startsWith('/_astro/');
}

/**
 * Check if a URL is a static asset that benefits from caching.
 */
function isStaticAsset(pathname) {
  return /\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?|ttf|eot)(\?.*)?$/.test(pathname);
}

/** A response the origin asked us not to store. */
function isCacheable(response) {
  return (
    response.ok
    && response.type !== 'opaque'
    && !/(^|,)\s*no-store(\s*,|$)/i.test(response.headers.get('cache-control') || '')
  );
}

/**
 * Cache-first, for immutable URLs only: serve from cache, else fetch and
 * store. No revalidation — the hash in the URL is the version.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

/**
 * Stale-while-revalidate, for unversioned assets: answer from cache
 * immediately when we have one, and refresh the entry in the background so
 * a bad copy survives exactly one more page view rather than forever.
 */
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const update = (async () => {
    try {
      const response = await fetch(request);
      if (isCacheable(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  })();

  if (cached) {
    // Keep the worker alive for the refresh even though we answer now.
    if (typeof event.waitUntil === 'function') event.waitUntil(update);
    return cached;
  }

  const response = await update;
  return response || new Response('', { status: 408, statusText: 'Offline' });
}

/**
 * Store a response and stamp when we stored it, so freshness can be judged
 * later. The body has to be re-wrapped because headers are immutable.
 */
async function cacheWithTimestamp(cache, request, response, now) {
  const body = await response.clone().blob();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(now));
  await cache.put(
    request,
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  );
}

/** A cached HTML entry is usable only while it is younger than the cap. */
function isFreshEnough(response, now) {
  const stamp = Number(response.headers.get(CACHED_AT_HEADER));
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  return now - stamp < HTML_STALE_MAX_AGE_MS;
}

/**
 * Network-first strategy with a bounded stale fallback.
 * 1. Try network — cache successful HTML for future fallback
 * 2. On server 5xx — serve the stale copy if it is still fresh enough
 * 3. On a genuine network failure — same, bounded, stale copy
 * 4. Last resort — offline page
 *
 * An aborted request is NOT a network failure: the user navigated away or
 * tapped another link, which happens constantly on mobile. Replaying a
 * stale document there is how a days-old page ends up on screen looking
 * live. Let the abort propagate instead.
 */
async function networkFirstWithOfflineFallback(request) {
  const now = Date.now();
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: 'no-cache' });

    if (response.ok) {
      if (isCacheable(response)) {
        // Cache successful HTML for stale fallback
        await cacheWithTimestamp(cache, request, response, now);
      }
      return response;
    }

    // Server returned 5xx — try stale cache before passing error through
    if (response.status >= 500) {
      const cached = await cache.match(request);
      if (cached && isFreshEnough(cached, now)) return cached;
    }

    return response;
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;

    // Network failure — serve stale cached version if available
    const cached = await cache.match(request);
    if (cached && isFreshEnough(cached, now)) return cached;

    const offlinePage = await cache.match(OFFLINE_URL);
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
