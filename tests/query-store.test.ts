/**
 * Query-store behavior tests.
 *
 * The store's ORIGINAL semantics (single fetch across islands, in-flight
 * sharing, minimum-interval polling, an error never destroying good data) are
 * already pinned by tests/live-poll-store.test.ts, which exercises this module
 * through the createSharedPoller adapter. Those tests were written before the
 * extraction and pass unchanged, which is what makes them the regression net
 * for it — so this file covers only what the generalization ADDED: one-shot
 * reads, staleTime, imperative `ensure`, invalidation and optimistic writes.
 *
 * Everything here asserts observable behavior — call counts and emitted state
 * — never source text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createQueryStore } from '../src/utils/query-store';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createQueryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('one-shot subscriptions', () => {
    it('loads once and NEVER polls when no interval is given', async () => {
      // The default for everything that is not a live feed. A store that
      // polled by default would turn 67 island reads into 67 poll loops.
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      store.subscribe({ k: 'a' }, () => {});
      await flush();
      expect(load).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('serves a second one-shot subscriber from cache without re-fetching', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      store.subscribe({ k: 'a' }, () => {});
      await flush();
      store.subscribe({ k: 'a' }, () => {});
      await flush();

      expect(load).toHaveBeenCalledTimes(1);
    });

    it('mixes a one-shot and a polling subscriber on one key: one fetch loop', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      store.subscribe({ k: 'a' }, () => {});
      store.subscribe({ k: 'a' }, () => {}, { intervalMs: 60_000 });
      await flush();
      expect(load).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      // The poller ticked once; the one-shot subscriber did not add a loop.
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('staleTime', () => {
    it('reuses cached data inside the window, re-loads past it', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load, {
        staleTime: 30_000,
      });

      expect(await store.ensure({ k: 'a' })).toEqual({ n: 1 });
      expect(await store.ensure({ k: 'a' })).toEqual({ n: 1 });
      expect(load).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_001);
      await store.ensure({ k: 'a' });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('defaults to Infinity — cached data is never re-loaded on its own', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      await store.ensure({ k: 'a' });
      await vi.advanceTimersByTimeAsync(86_400_000);
      await store.ensure({ k: 'a' });

      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensure', () => {
    it('collapses concurrent callers into a SINGLE request', async () => {
      // The dedup that matters on a page where four consumers ask "who is
      // logged in?" during the same tick.
      let release!: (v: unknown) => void;
      const load = vi.fn(() => new Promise((res) => { release = res; }));
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load as never);

      const all = Promise.all([
        store.ensure({ k: 'a' }),
        store.ensure({ k: 'a' }),
        store.ensure({ k: 'a' }),
      ]);
      expect(load).toHaveBeenCalledTimes(1);

      release({ n: 7 });
      expect(await all).toEqual([{ n: 7 }, { n: 7 }, { n: 7 }]);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('REJECTS when the load failed and there is nothing cached', async () => {
      const store = createQueryStore<{ k: string }, { n: number }>(
        (p) => p.k,
        vi.fn().mockRejectedValue(new Error('offline')),
      );
      await expect(store.ensure({ k: 'a' })).rejects.toThrow('offline');
    });

    it('resolves the last good data when a REFRESH failed over it', async () => {
      // Stale-but-usable is an answer. Throwing here would make every caller
      // re-implement the same fallback, and some would get it wrong.
      const load = vi
        .fn()
        .mockResolvedValueOnce({ n: 1 })
        .mockRejectedValue(new Error('espn down'));
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load, {
        staleTime: 1000,
      });

      expect(await store.ensure({ k: 'a' })).toEqual({ n: 1 });
      await vi.advanceTimersByTimeAsync(2000);

      expect(await store.ensure({ k: 'a' })).toEqual({ n: 1 });
      expect(store.getState({ k: 'a' }).status).toBe('error');
    });

    it('carries the failure reason, and clears it on the next success', async () => {
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ n: 2 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      await expect(store.ensure({ k: 'a' })).rejects.toThrow('boom');
      expect(store.getState({ k: 'a' }).error?.message).toBe('boom');

      await store.refresh({ k: 'a' });
      expect(store.getState({ k: 'a' }).error).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('re-loads a key that is on screen, and notifies its subscribers', async () => {
      const load = vi.fn().mockResolvedValueOnce({ n: 1 }).mockResolvedValue({ n: 2 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);
      const onChange = vi.fn();

      store.subscribe({ k: 'a' }, onChange);
      await flush();
      onChange.mockClear();

      store.invalidate();
      await flush();

      expect(store.getState({ k: 'a' }).data).toEqual({ n: 2 });
      expect(onChange).toHaveBeenCalled();
    });

    it('never blanks a key that is on screen — data goes straight to the new value', async () => {
      // Dropping to idle first would flash a spinner over data that is about
      // to be replaced by an almost identical payload.
      let release!: (v: unknown) => void;
      const load = vi
        .fn()
        .mockResolvedValueOnce({ n: 1 })
        .mockImplementationOnce(() => new Promise((res) => { release = res; }));
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load as never);

      // Record only what subscribers see AFTER the first payload lands. The
      // initial idle→loading emit legitimately carries null; the claim under
      // test is that a REVALIDATION never puts null back.
      let recording = false;
      const seen: unknown[] = [];
      store.subscribe({ k: 'a' }, () => {
        if (recording) seen.push(store.getState({ k: 'a' }).data);
      });
      await flush();
      recording = true;

      store.invalidate();
      await flush();
      // Mid-flight, the old payload is still being served.
      expect(store.getState({ k: 'a' }).data).toEqual({ n: 1 });

      release({ n: 2 });
      await flush();
      expect(seen).not.toContain(null);
      expect(store.getState({ k: 'a' }).data).toEqual({ n: 2 });
    });

    it('evicts an unsubscribed key so the NEXT read re-fetches', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      await store.ensure({ k: 'a' });
      expect(load).toHaveBeenCalledTimes(1);

      store.invalidate();
      expect(store.getState({ k: 'a' }).status).toBe('idle');

      await store.ensure({ k: 'a' });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('a matcher invalidates only the keys it selects', async () => {
      const load = vi.fn(async (p: { k: string }) => ({ k: p.k }));
      const store = createQueryStore<{ k: string }, { k: string }>((p) => p.k, load);

      await store.ensure({ k: 'roster:0001' });
      await store.ensure({ k: 'standings' });
      load.mockClear();

      store.invalidate((key) => key.startsWith('roster:'));

      expect(store.getState({ k: 'roster:0001' }).status).toBe('idle');
      expect(store.getState({ k: 'standings' }).status).toBe('ok');
    });

    it('stops the timer on an evicted key rather than leaking it', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);

      const stop = store.subscribe({ k: 'a' }, () => {}, { intervalMs: 60_000 });
      await flush();
      stop();
      store.invalidate();
      load.mockClear();

      await vi.advanceTimersByTimeAsync(600_000);
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('setData', () => {
    it('publishes an optimistic value to every subscriber without a request', async () => {
      const load = vi.fn().mockResolvedValue({ n: 1 });
      const store = createQueryStore<{ k: string }, { n: number }>((p) => p.k, load);
      const onChange = vi.fn();

      store.subscribe({ k: 'a' }, onChange);
      await flush();
      load.mockClear();
      onChange.mockClear();

      store.setData({ k: 'a' }, { n: 99 });

      expect(store.getState({ k: 'a' })).toMatchObject({ status: 'ok', data: { n: 99 } });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
    });

    it('accepts an updater function over the previous value', async () => {
      const store = createQueryStore<{ k: string }, { n: number }>(
        (p) => p.k,
        vi.fn().mockResolvedValue({ n: 1 }),
      );
      await store.ensure({ k: 'a' });
      store.setData({ k: 'a' }, (prev) => ({ n: (prev?.n ?? 0) + 1 }));
      expect(store.getState({ k: 'a' }).data).toEqual({ n: 2 });
    });
  });

  it('returns the SAME idle object for every unloaded key', () => {
    // useSyncExternalStore compares snapshots by identity and re-renders
    // forever if the getter allocates. An unloaded key is the common case
    // during SSR and the first client render, so it must be stable.
    const store = createQueryStore<{ k: string }, unknown>((p) => p.k, async () => null);
    expect(store.getState({ k: 'x' })).toBe(store.getState({ k: 'y' }));
  });
});
