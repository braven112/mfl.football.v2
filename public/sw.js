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

// v5 (Aug 2026): forced eviction. /_astro/ entries are cache-first and never
// revalidated, so one bad copy of a build chunk is permanent on that device —
// the page still renders, but whichever module lives in that chunk silently
// never runs, which is indistinguishable from the feature not existing.
// Bumped after an owner's phone showed exactly that shape on Free Agents.
const CACHE_NAME = 'theleague-v5';
const OFFLINE_URL = '/offline.html';

/**
 * How long a cached HTML document may still be served as an offline
 * fallback. Past this it is treated as absent and the offline page wins:
 * a document old enough to reference a retired build is worse than an
 * honest "you're offline", because it renders as a broken live page.
 */
const HTML_STALE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Ceiling on cached content-hashed entries. Hashed filenames never repeat,
 * so without a bound the cache grows by a full build's worth of assets on
 * every deploy and eventually hits the origin quota.
 */
const MAX_IMMUTABLE_ENTRIES = 96;

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
    event.respondWith(cacheFirst(event, request));
    return;
  }

  // Unversioned static assets: serve fast, repair in the background.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  // HTML pages: network-first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(event, request));
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
 * Extend the worker's life for background work without delaying the response.
 */
function keepAlive(event, promise) {
  if (event && typeof event.waitUntil === 'function') event.waitUntil(promise);
}

/**
 * Cache-first, for immutable URLs only: serve from cache, else fetch and
 * store. No revalidation — the hash in the URL is the version.
 *
 * The write is deliberately off the response path: a cache failure must
 * neither delay the asset nor discard it (see storeAsset).
 */
async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(request);
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }

  if (isCacheable(response)) {
    keepAlive(event, storeAsset(cache, request, response.clone()));
  }
  return response;
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
    let response;
    try {
      response = await fetch(request);
    } catch {
      return null;
    }
    if (isCacheable(response)) {
      // Storing is best-effort. A quota failure must NOT cost us the
      // response — with no cached copy to fall back on, discarding it here
      // is how a live logo turns into a synthetic 408 and fails to render.
      await storeAsset(cache, request, response.clone());
    }
    return response;
  })();

  if (cached) {
    // Keep the worker alive for the refresh even though we answer now.
    keepAlive(event, update);
    return cached;
  }

  const response = await update;
  return response || new Response('', { status: 408, statusText: 'Offline' });
}

/**
 * Best-effort write. Never throws: every caller has already committed to
 * returning the response, so a rejection here can only do harm — as an
 * unhandled rejection, or by being mistaken for a network failure.
 */
async function storeAsset(cache, request, response) {
  try {
    await cache.put(request, response);
    await trimImmutableEntries(cache);
  } catch {
    // Quota exhausted, or the cache was evicted mid-write. Nothing to do:
    // the caller already has its response.
  }
}

/**
 * Bound the content-hashed entries.
 *
 * Every deploy mints new /_astro/ filenames, and nothing else ever evicts
 * them — cache-first never revalidates and the hashes never repeat, so the
 * cache grows monotonically until CACHE_NAME changes. That is the quota
 * pressure that makes a failing cache.put realistic in the first place.
 * Cache.keys() is insertion-ordered, so the front of the list is the oldest
 * deploy's output, which is exactly what should go.
 */
async function trimImmutableEntries(cache) {
  const keys = await cache.keys();
  const immutable = keys.filter((cached) => {
    try {
      return isImmutableAsset(new URL(cached.url).pathname);
    } catch {
      return false;
    }
  });

  const excess = immutable.length - MAX_IMMUTABLE_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(immutable[i]);
  }
}

/**
 * Store a response and stamp when we stored it, so freshness can be judged
 * later. The body has to be re-wrapped because headers are immutable.
 *
 * Takes ownership of `response` — callers pass a clone. Only a 200 is
 * stored: re-wrapping a null-body status (204/205/304) throws, and such a
 * document is worthless as an offline fallback anyway.
 */
async function cacheHtmlWithTimestamp(cache, request, response, now) {
  try {
    if (response.status !== 200) return;
    const body = await response.blob();
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
  } catch {
    // Best-effort, same contract as storeAsset.
  }
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
 *
 * Only the fetch is inside the try. Caching is a fire-and-forget clone,
 * for two independent reasons: awaiting it buffers the entire streamed
 * document before the page is handed back, and a cache rejection inside
 * the try would be caught as "offline" and answered with a stale document
 * even though a fresh 200 was in hand.
 */
async function networkFirstWithOfflineFallback(event, request) {
  const now = Date.now();
  const cache = await caches.open(CACHE_NAME);

  let response;
  try {
    response = await fetch(request, { cache: 'no-cache' });
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

  if (response.ok) {
    if (isCacheable(response)) {
      // Cache successful HTML for stale fallback — off the response path.
      keepAlive(event, cacheHtmlWithTimestamp(cache, request, response.clone(), now));
    }
    return response;
  }

  // Server returned 5xx — try stale cache before passing error through
  if (response.status >= 500) {
    const cached = await cache.match(request);
    if (cached && isFreshEnough(cached, now)) return cached;
  }

  return response;
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
