/**
 * Service worker caching behavior.
 *
 * This runs the REAL public/sw.js — the file is evaluated with stubbed
 * `self`/`caches`/`fetch`/`Date`, its fetch listener is captured, and the
 * assertions are on the Response the worker actually hands back. Greps over
 * this file would be worthless: the bugs it guards (serving a stale document
 * on an aborted navigation, pinning an unversioned asset forever) are all
 * invisible in the source text and only show up in what comes out of
 * `event.respondWith`.
 *
 * Background: a stale cached document from an older deploy was pairing old
 * markup with a retired stylesheet, rendering the homepage hero with no
 * background at all (owner report, 2026-08-18).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SW_SOURCE = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://www.theleague.us';
const HOUR = 60 * 60 * 1000;

class FakeCache {
  store = new Map<string, Response>();
  /** Simulates a full origin quota — the realistic cache.put failure. */
  failPut = false;
  /** Gate a write so a test can observe what happens while it is pending. */
  blockPut: Promise<void> | null = null;

  async match(request: Request | string) {
    const key = typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
    const hit = this.store.get(key);
    return hit ? hit.clone() : undefined;
  }
  async put(request: Request | string, response: Response) {
    if (this.blockPut) await this.blockPut;
    if (this.failPut) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    const key = typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
    this.store.set(key, response);
  }
  async keys() {
    // Cache.keys() is insertion-ordered, and the eviction policy leans on it.
    return [...this.store.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string) {
    const key = typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
    return this.store.delete(key);
  }
  async addAll(urls: string[]) {
    for (const url of urls) {
      await this.put(url, new Response('offline page', { status: 200 }));
    }
  }
}

type Harness = {
  fetchListener: (event: any) => void;
  cache: FakeCache;
  fetchCalls: string[];
  setNow: (ms: number) => void;
  setResponder: (fn: (request: Request) => Promise<Response>) => void;
};

function loadWorker(): Harness {
  const cache = new FakeCache();
  const caches = {
    open: async () => cache,
    keys: async () => ['theleague-v4'],
    delete: async () => true,
    match: async (r: Request | string) => cache.match(r),
  };

  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (event: any) => void) => { listeners[type] = fn; },
    location: { origin: ORIGIN },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async () => {} },
  };

  let now = 1_700_000_000_000;
  let responder: (request: Request) => Promise<Response> = async () => new Response('ok');

  const fetchCalls: string[] = [];
  const fetchStub = async (request: Request | string) => {
    const req = typeof request === 'string' ? new Request(new URL(request, ORIGIN)) : request;
    fetchCalls.push(req.url);
    return responder(req);
  };

  // eslint-disable-next-line no-new-func
  const factory = new Function('self', 'caches', 'fetch', 'Date', SW_SOURCE);
  factory(self, caches, fetchStub, { now: () => now });

  return {
    fetchListener: listeners.fetch,
    cache,
    fetchCalls,
    setNow: (ms: number) => { now = ms; },
    setResponder: (fn) => { responder = fn; },
  };
}

/** Drive one request through the worker; returns the Response it answered with. */
async function seed(h: Harness, request: Request) {
  const { settle } = await respond(h, request);
  await settle();
}

async function respond(h: Harness, request: Request) {
  let answered: Promise<Response> | undefined;
  const waits: Promise<unknown>[] = [];
  h.fetchListener({
    request,
    respondWith: (p: Promise<Response>) => { answered = p; },
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const settle = async () => {
    try { await answered; } catch { /* the caller asserts on rejections */ }
    // keepAlive() runs after awaits inside the handler, so the waitUntil
    // list is still empty when respond() returns. Yield before draining it.
    await flush();
    await Promise.allSettled(waits);
    await flush();
  };
  return { answered, settle };
}

const htmlRequest = (path = '/') =>
  new Request(new URL(path, ORIGIN), { headers: { accept: 'text/html' } });

describe('service worker caching', () => {
  let h: Harness;
  beforeEach(() => { h = loadWorker(); });

  it('bumps CACHE_NAME so clients holding a poisoned cache are evicted', () => {
    // The only lever that reaches a phone already caching a retired build.
    expect(SW_SOURCE).toMatch(/const CACHE_NAME = 'theleague-v[4-9]\d*'/);
  });

  describe('HTML', () => {
    it('serves the network response and stamps the cached copy', async () => {
      h.setResponder(async () => new Response('<html>fresh</html>', { status: 200 }));
      const { answered, settle } = await respond(h, htmlRequest());
      expect(await (await answered!).text()).toBe('<html>fresh</html>');

      await settle(); // the write is off the response path now
      const stored = await h.cache.match(htmlRequest());
      expect(stored).toBeDefined();
      expect(Number(stored!.headers.get('x-sw-cached-at'))).toBeGreaterThan(0);
    });

    it('does NOT replay a stale document when the navigation was aborted', async () => {
      h.setResponder(async () => new Response('<html>fresh</html>', { status: 200 }));
      await seed(h, htmlRequest());

      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      h.setResponder(async () => { throw abort; });

      const { answered } = await respond(h, htmlRequest());
      await expect(answered).rejects.toThrow('aborted');
    });

    it('serves a fresh stale copy when the network genuinely fails', async () => {
      h.setResponder(async () => new Response('<html>cached</html>', { status: 200 }));
      await seed(h, htmlRequest());

      h.setResponder(async () => { throw new TypeError('Failed to fetch'); });
      const { answered } = await respond(h, htmlRequest());
      expect(await (await answered!).text()).toBe('<html>cached</html>');
    });

    it('refuses a cached document older than the staleness cap', async () => {
      h.setResponder(async () => new Response('<html>ancient</html>', { status: 200 }));
      await seed(h, htmlRequest());
      await h.cache.addAll(['/offline.html']);

      h.setNow(1_700_000_000_000 + 13 * HOUR);
      h.setResponder(async () => { throw new TypeError('Failed to fetch'); });

      const { answered } = await respond(h, htmlRequest());
      const body = await (await answered!).text();
      expect(body).toBe('offline page');
      expect(body).not.toContain('ancient');
    });

    it('falls back to a fresh cached copy on a 5xx, but not an expired one', async () => {
      h.setResponder(async () => new Response('<html>good</html>', { status: 200 }));
      await seed(h, htmlRequest());

      h.setResponder(async () => new Response('boom', { status: 503 }));
      expect(await (await (await respond(h, htmlRequest())).answered!).text()).toBe('<html>good</html>');

      h.setNow(1_700_000_000_000 + 13 * HOUR);
      const late = await (await respond(h, htmlRequest())).answered!;
      expect(late.status).toBe(503);
    });

    it('honors no-store and never caches such a document', async () => {
      h.setResponder(async () => new Response('<html>private</html>', {
        status: 200,
        headers: { 'cache-control': 'private, no-store' },
      }));
      await seed(h, htmlRequest());
      expect(await h.cache.match(htmlRequest())).toBeUndefined();
    });
  });

  describe('assets', () => {
    it('serves content-hashed build output from cache without revalidating', async () => {
      const req = new Request(`${ORIGIN}/_astro/index.abc123.css`);
      h.setResponder(async () => new Response('.a{}', { status: 200 }));
      await seed(h, req);
      const callsAfterFirst = h.fetchCalls.length;

      const { answered } = await respond(h, req);
      expect(await (await answered!).text()).toBe('.a{}');
      expect(h.fetchCalls.length).toBe(callsAfterFirst); // no second network hit
    });

    it('revalidates unversioned assets in the background instead of pinning them', async () => {
      const req = new Request(`${ORIGIN}/assets/nfl-logos/SEA.svg`);
      h.setResponder(async () => new Response('<svg>old</svg>', { status: 200 }));
      await seed(h, req);

      h.setResponder(async () => new Response('<svg>new</svg>', { status: 200 }));
      const second = await respond(h, req);
      // Answers instantly from cache…
      expect(await (await second.answered!).text()).toBe('<svg>old</svg>');
      // …but repairs the entry, so the bad copy survives one view, not forever.
      await second.settle();
      expect(await (await h.cache.match(req))!.text()).toBe('<svg>new</svg>');
    });

    it('does not cache a failed asset response', async () => {
      const req = new Request(`${ORIGIN}/assets/nfl-logos/NOPE.svg`);
      h.setResponder(async () => new Response('not found', { status: 404 }));
      const { answered } = await respond(h, req);
      expect((await answered!).status).toBe(404);
      expect(await h.cache.match(req)).toBeUndefined();
    });
  });

  describe('a failing cache write is never fatal', () => {
    // Every one of these is a path where the worker has a perfectly good
    // response in hand and could throw it away over a full quota.

    it('still serves the fresh document when the HTML write fails', async () => {
      h.cache.failPut = true;
      h.setResponder(async () => new Response('<html>fresh</html>', { status: 200 }));

      const { answered, settle } = await respond(h, htmlRequest());
      expect(await (await answered!).text()).toBe('<html>fresh</html>');
      await settle(); // the rejected write must not surface as an unhandled rejection
    });

    it('does not mistake a failed HTML write for being offline', async () => {
      // Seed a stale copy, then fail the write — the bug would answer with it.
      h.setResponder(async () => new Response('<html>old</html>', { status: 200 }));
      await seed(h, htmlRequest());

      h.cache.failPut = true;
      h.setResponder(async () => new Response('<html>new</html>', { status: 200 }));
      const { answered, settle } = await respond(h, htmlRequest());
      expect(await (await answered!).text()).toBe('<html>new</html>');
      await settle();
    });

    it('keeps the asset when an unversioned write fails and nothing is cached', async () => {
      const req = new Request(`${ORIGIN}/assets/nfl-logos/SEA.svg`);
      h.cache.failPut = true;
      h.setResponder(async () => new Response('<svg>live</svg>', { status: 200 }));

      const { answered, settle } = await respond(h, req);
      const res = await answered!;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<svg>live</svg>');
      await settle();
    });

    it('keeps the asset when an immutable write fails', async () => {
      const req = new Request(`${ORIGIN}/_astro/index.zzz999.css`);
      h.cache.failPut = true;
      h.setResponder(async () => new Response('.live{}', { status: 200 }));

      const { answered, settle } = await respond(h, req);
      expect(await (await answered!).text()).toBe('.live{}');
      await settle();
    });
  });

  it('hands back the document without waiting for the cache write', async () => {
    // Awaiting the write buffers the whole streamed document first.
    let release!: () => void;
    h.cache.blockPut = new Promise<void>((resolve) => { release = resolve; });
    h.setResponder(async () => new Response('<html>streamed</html>', { status: 200 }));

    const { answered, settle } = await respond(h, htmlRequest());
    const raced = await Promise.race([
      answered!.then(() => 'responded'),
      new Promise((r) => setTimeout(() => r('blocked'), 50)),
    ]);
    expect(raced).toBe('responded');

    release();
    await settle();
  });

  it('never re-wraps a null-body status, and still serves it', async () => {
    h.setResponder(async () => new Response(null, { status: 204 }));
    const { answered, settle } = await respond(h, htmlRequest());
    expect((await answered!).status).toBe(204);
    await settle();
    expect(await h.cache.match(htmlRequest())).toBeUndefined();
  });

  it('bounds content-hashed entries so deploys cannot grow the cache forever', async () => {
    h.setResponder(async () => new Response('.a{}', { status: 200 }));
    for (let i = 0; i < 120; i += 1) {
      const { settle } = await respond(h, new Request(`${ORIGIN}/_astro/chunk.${i}.css`));
      await settle();
    }

    const astro = [...h.cache.store.keys()].filter((url) => url.includes('/_astro/'));
    expect(astro.length).toBeLessThanOrEqual(96);
    // Insertion-ordered eviction: the oldest deploy's output goes first.
    expect(astro).not.toContain(`${ORIGIN}/_astro/chunk.0.css`);
    expect(astro).toContain(`${ORIGIN}/_astro/chunk.119.css`);
  });
});
