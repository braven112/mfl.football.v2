/**
 * My Watch List — browser store.
 *
 * The rules: the cache paints first, a toggle is optimistic and rolls back on
 * failure, a 401 flips the store to signed-out and clears the cache, and the
 * change event fires for every visible transition.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storage = new Map<string, string>();
const listeners: Array<(e: any) => void> = [];
function installBrowserStubs() {
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
  };
  (globalThis as any).document = {
    documentElement: { dataset: { league: 'theleague' } },
    addEventListener: (_: string, fn: (e: any) => void) => { listeners.push(fn); },
    removeEventListener: (_: string, fn: (e: any) => void) => {
      const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: (e: any) => { for (const fn of [...listeners]) fn(e); return true; },
  };
  (globalThis as any).CustomEvent = class { type: string; detail: any; constructor(t: string, init: any) { this.type = t; this.detail = init?.detail; } };
}

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ status, ok: status < 400, json: async () => body });

installBrowserStubs();
const store = await import('../src/utils/watch-list-client');

beforeEach(() => {
  storage.clear();
  listeners.length = 0;
  fetchMock.mockReset();
  store.__resetWatchListClient();
});
afterEach(() => store.__resetWatchListClient());

describe('loadWatchList', () => {
  it('paints from the local cache before the network answers', () => {
    storage.set('watchList.cache', JSON.stringify(['1', '2']));
    store.__resetWatchListClient();
    storage.set('watchList.cache', JSON.stringify(['1', '2']));
    expect(store.isWatched('1')).toBe(true);
    expect(store.getWatchListAuth()).toBe('unknown');
  });

  it('adopts the server list, caches it, and emits', async () => {
    const seen: any[] = [];
    store.onWatchListChange((d) => seen.push(d));
    respond(200, { ok: true, playerIds: ['5'] });
    await store.loadWatchList();
    expect(store.isWatched('5')).toBe(true);
    expect(store.getWatchListAuth()).toBe('signed-in');
    expect(JSON.parse(storage.get('watchList.cache')!)).toEqual(['5']);
    expect(seen).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/watch-list?league=theleague');
  });

  it('a 401 flips to signed-out and clears the cache', async () => {
    storage.set('watchList.cache', JSON.stringify(['1']));
    respond(401, { error: 'nope' });
    await store.loadWatchList();
    expect(store.getWatchListAuth()).toBe('signed-out');
    expect(store.isWatched('1')).toBe(false);
    expect(storage.has('watchList.cache')).toBe(false);
  });

  it('keeps the cached list when the server is down', async () => {
    storage.set('watchList.cache', JSON.stringify(['1']));
    store.__resetWatchListClient();
    storage.set('watchList.cache', JSON.stringify(['1']));
    respond(502, { ok: false });
    await store.loadWatchList();
    expect(store.isWatched('1')).toBe(true);
    expect(store.getWatchListAuth()).toBe('unknown');
  });
});

describe('toggleWatch', () => {
  it('is optimistic, then adopts the server list', async () => {
    const seen: any[] = [];
    store.onWatchListChange((d) => seen.push(d));
    respond(200, { ok: true, playerIds: ['7'] });
    const p = store.toggleWatch('7');
    expect(store.isWatched('7')).toBe(true); // before the network answered
    const res = await p;
    expect(res).toEqual({ ok: true, watched: true });
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ add: ['7'] }));
    expect(seen.map((d) => d.watched)).toEqual([true, true]);
  });

  it('rolls back on a server error and reports it', async () => {
    respond(502, { ok: false, error: 'MFL is down' });
    const res = await store.toggleWatch('7');
    expect(res).toMatchObject({ ok: false, watched: false, error: 'MFL is down' });
    expect(store.isWatched('7')).toBe(false);
  });

  it('a 401 rolls back and flags signedOut', async () => {
    respond(401, { error: 'Sign in' });
    const res = await store.toggleWatch('7');
    expect(res.signedOut).toBe(true);
    expect(store.getWatchListAuth()).toBe('signed-out');
  });

  it('sends a REMOVE for a watched player', async () => {
    respond(200, { ok: true, playerIds: ['1'] });
    await store.loadWatchList();
    respond(200, { ok: true, playerIds: [] });
    await store.toggleWatch('1');
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ remove: ['1'] }));
    expect(store.isWatched('1')).toBe(false);
  });
});
