/**
 * Shared-poller behavior tests.
 *
 * The store exists to keep the live-scoring page at ONE fetch loop per feed
 * across two independently-hydrated islands, and to keep "the feed says
 * nothing" apart from "we couldn't reach the feed". Both are asserted here on
 * observable behavior — call counts and emitted state — not on source text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSharedPoller } from '../src/utils/live-poll-store';
import { mapWithConcurrency } from '../src/utils/fan-out';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createSharedPoller', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('serves two subscribers on one key from a SINGLE fetch', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);

    poller.subscribe({ k: 'a' }, 60_000, () => {});
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();

    // This is the whole reason the store exists: a second island mounting must
    // not add a poll loop.
    expect(load).toHaveBeenCalledTimes(1);
    expect(poller.getState({ k: 'a' })).toMatchObject({ status: 'ok', data: { n: 1 } });
  });

  it('joins an IN-FLIGHT request rather than starting a second one', async () => {
    let release!: (v: unknown) => void;
    const load = vi.fn(() => new Promise((res) => { release = res; }));
    const poller = createSharedPoller<{ k: string }, unknown>((p) => p.k, load as never);

    poller.subscribe({ k: 'a' }, 60_000, () => {});
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    void poller.refresh({ k: 'a' });
    expect(load).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys independent', async () => {
    const load = vi.fn(async (p: { k: string }) => ({ k: p.k }));
    const poller = createSharedPoller<{ k: string }, { k: string }>((p) => p.k, load);
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    poller.subscribe({ k: 'b' }, 60_000, () => {});
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(poller.getState({ k: 'a' }).data).toEqual({ k: 'a' });
    expect(poller.getState({ k: 'b' }).data).toEqual({ k: 'b' });
  });

  it('a FAILED poll keeps the last good data and flips status to error', async () => {
    // "Couldn't reach the feed" must never be rendered as "the feed is empty" —
    // the recurring bug class this repo keeps re-learning.
    const load = vi
      .fn()
      .mockResolvedValueOnce({ games: [1] })
      .mockRejectedValueOnce(new Error('espn down'));
    const poller = createSharedPoller<{ k: string }, { games: number[] }>((p) => p.k, load);

    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    const good = poller.getState({ k: 'a' });
    expect(good.status).toBe('ok');

    await poller.refresh({ k: 'a' });
    const after = poller.getState({ k: 'a' });
    expect(after.status).toBe('error');
    expect(after.data).toEqual({ games: [1] });
    expect(after.fetchedAt).toBe(good.fetchedAt);
  });

  it('notifies every subscriber when state changes', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);
    const a = vi.fn();
    const b = vi.fn();
    poller.subscribe({ k: 'a' }, 60_000, a);
    poller.subscribe({ k: 'a' }, 60_000, b);
    await flush();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('polls on the MINIMUM interval any subscriber asks for', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);

    const stopStale = poller.subscribe({ k: 'a' }, 300_000, () => {});
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    load.mockClear();

    // A subscriber that has backed off to POLL_STALE can't slow down one that
    // is still watching a live game.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    stopStale();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('backs the whole page off once the live subscriber leaves', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);
    poller.subscribe({ k: 'a' }, 300_000, () => {});
    const stopLive = poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    stopLive();
    load.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops polling entirely when the last subscriber unsubscribes', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);
    const stop = poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    stop();
    load.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).not.toHaveBeenCalled();
  });

  it('does not re-fetch for a late joiner that can reuse good data', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    load.mockClear();
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it('retries for a joiner when the only prior attempt failed with no data', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ n: 2 });
    const poller = createSharedPoller<{ k: string }, { n: number }>((p) => p.k, load);
    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    expect(poller.getState({ k: 'a' }).status).toBe('error');

    poller.subscribe({ k: 'a' }, 60_000, () => {});
    await flush();
    expect(poller.getState({ k: 'a' })).toMatchObject({ status: 'ok', data: { n: 2 } });
  });

  it('reports idle for a key nobody has asked about', () => {
    const poller = createSharedPoller<{ k: string }, unknown>((p) => p.k, async () => null);
    expect(poller.getState({ k: 'nope' })).toEqual({ data: null, status: 'idle', fetchedAt: 0 });
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 6, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(6);
  });

  it('returns results in INPUT order regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([30, 10, 20]);
  });

  it('one hung/failed item does NOT blank the batch', async () => {
    // The board must degrade to partial results, not to nothing.
    const out = await mapWithConcurrency([1, 2, 3], 2, async (i) => {
      if (i === 2) throw new Error('espn timeout');
      return i;
    });
    expect(out.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  });

  it('handles an empty list and a nonsense limit', async () => {
    expect(await mapWithConcurrency([], 6, async () => 1)).toEqual([]);
    const out = await mapWithConcurrency([1, 2], 0, async (i) => i);
    expect(out.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2]);
  });
});
