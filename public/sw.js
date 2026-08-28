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
 * Remote player images live in their OWN cache, on OUR clock.
 *
 * ESPN serves headshots with `cache-control: max-age=233` (measured
 * 2026-08-28 — under four minutes, and the value counts down, so it is an edge
 * TTL rather than a hint about the client). That is fine for a roster page and
 * ruinous for the draft broadcast board: a laptop warmed at 6pm has re-expired
 * every headshot before the second round, so each reveal re-downloads ~240 KB
 * over room wifi at the exact moment a face has to be on screen.
 *
 * These entries are therefore kept for REMOTE_IMAGE_MAX_AGE_MS regardless of
 * what the origin says. A player photo that changes inside a week is not a
 * failure anyone can see; a headshot that arrives four seconds into an
 * eighteen-second reveal is.
 *
 * Separate cache name, and kept across activations (see KEEP_CACHES), so
 * bumping CACHE_NAME to evict a poisoned HTML entry does not also throw away a
 * board that somebody warmed an hour before their draft.
 */
const IMAGE_CACHE_NAME = 'theleague-img-v1';

/** Caches an activate must NOT delete. Everything else is last version's. */
const KEEP_CACHES = [CACHE_NAME, IMAGE_CACHE_NAME];

/** Hosts whose images get the durable treatment. Deliberately a short list of
 *  known image CDNs: this path re-issues requests as CORS and stores the
 *  bytes, which is not something to do to an arbitrary third party. */
const REMOTE_IMAGE_HOSTS = ['a.espncdn.com'];

/** How long a stored remote image stays servable without revalidation. */
const REMOTE_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Ceiling on stored remote images. A full broadcast warm-up is ~600 entries;
 *  1800 leaves room for both leagues' boards plus a season of roster browsing
 *  before the oldest start falling off the front. */
const MAX_REMOTE_IMAGE_ENTRIES = 1800;

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
          .filter((key) => !KEEP_CACHES.includes(key))
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

  // Player headshots from an image CDN: durable cache-first, on our clock
  // rather than the origin's four minutes. See IMAGE_CACHE_NAME.
  if (REMOTE_IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(remoteImageCacheFirst(event, request));
    return;
  }

  // Skip every other cross-origin request (fonts, analytics, etc.)
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
 * document is worthless as a cached copy anyway.
 *
 * `key` is a Request or a URL string; `cache.put` accepts either, and the
 * remote-image path keys by URL because the request it was handed is a
 * no-cors `<img>` request while the response it stores came from a CORS
 * re-issue of the same URL.
 */
async function putStamped(cache, key, response, now) {
  try {
    if (response.status !== 200) return;
    const body = await response.blob();
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, String(now));
    await cache.put(
      key,
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

/**
 * Cache-first for remote player images, on our own freshness clock.
 *
 * Three things here are load-bearing:
 *
 *  - **The request is re-issued as CORS.** An `<img>` fetch is `no-cors`, and
 *    its response is opaque: unreadable, unstampable, and charged against the
 *    origin quota at a padded size (~7 MB per entry in Chrome) rather than its
 *    real one. ESPN sends `access-control-allow-origin: *`, so re-asking as
 *    CORS costs nothing and yields a response we can actually store. If that
 *    re-issue fails, the original request is used and simply not cached — a
 *    picture on screen beats a cache entry.
 *  - **A stale hit beats a network failure.** Draft night runs on room wifi.
 *    When the network is gone, last week's headshot is the correct answer.
 *  - **The store is off the response path.** `keepAlive` holds the worker open
 *    for the write; awaiting it would put a cache round-trip in front of every
 *    image the page paints.
 */
async function remoteImageCacheFirst(event, request) {
  const now = Date.now();
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const cached = await cache.match(request.url);
  if (cached && isFreshEnough(cached, now, REMOTE_IMAGE_MAX_AGE_MS)) return cached;

  let response;
  try {
    response = await fetch(
      new Request(request.url, { mode: 'cors', credentials: 'omit' })
    );
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    // Expired but present is still a face on the TV.
    if (cached) return cached;
    // The CORS re-issue can fail for a reason the plain request would not
    // (a CDN that drops the ACAO header on an error page), so try it before
    // giving up — its opaque response is fine to display, just not to store.
    return fetch(request);
  }

  if (response.ok && response.type !== 'opaque') {
    keepAlive(event, storeRemoteImage(cache, request.url, response.clone(), now));
    return response;
  }

  // A 404 is a real answer the card's fallback cascade knows how to handle,
  // but a cached hit we already hold is a better one than a broken frame.
  if (!response.ok && cached) return cached;
  return response;
}

/**
 * Stamped store, with the entry-count bound checked periodically rather than
 * per write.
 *
 * `cache.keys()` walks the whole cache, and the broadcast board's warm-up
 * stores ~600 images back to back — trimming on every one of them turns a
 * bounded cache into a quadratic one, competing with the very warm-up it is
 * supposed to be cheap enough to allow. Every TRIM_EVERY writes is frequent
 * enough: the ceiling can be overshot by at most that many entries, which is
 * a rounding error against MAX_REMOTE_IMAGE_ENTRIES.
 */
const TRIM_EVERY = 50;
let remoteImageWrites = 0;

async function storeRemoteImage(cache, url, response, now) {
  await putStamped(cache, url, response, now);
  remoteImageWrites += 1;
  if (remoteImageWrites % TRIM_EVERY === 0) await trimRemoteImages(cache);
}

/**
 * Bound the remote-image cache.
 *
 * Nothing else evicts these: they are cache-first for a week and the URLs
 * repeat forever, so without a ceiling a season of roster browsing plus two
 * draft warm-ups grows monotonically into the origin quota. `cache.keys()` is
 * insertion-ordered, so the front of the list is the least recently STORED —
 * which for images that never change is a good enough stand-in for least
 * recently wanted.
 */
async function trimRemoteImages(cache) {
  try {
    const keys = await cache.keys();
    const excess = keys.length - MAX_REMOTE_IMAGE_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Same contract as storeAsset: the caller already has its response.
  }
}

/** A stamped cache entry is usable only while it is younger than its cap.
 *  HTML and remote images have very different caps and the same mechanism. */
function isFreshEnough(response, now, maxAgeMs = HTML_STALE_MAX_AGE_MS) {
  const stamp = Number(response.headers.get(CACHED_AT_HEADER));
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  return now - stamp < maxAgeMs;
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
      keepAlive(event, putStamped(cache, request, response.clone(), now));
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
