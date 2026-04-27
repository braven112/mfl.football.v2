import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  detectFranchiseChange,
  detectTradeBaitChanges,
  normalizeBlock,
  DEFAULT_SETTLE_WINDOW_MS,
  DEFAULT_MAX_SETTLE_WAIT_MS,
  MAX_ADDS_PER_TIP,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/trade-bait-detector.mjs';

/**
 * These tests lock in the per-franchise debouncing logic for Schefter's
 * trade-bait rumor feed. The detector is the whole contract for the
 * feature — if any of these flip red, the scanner is going to either
 * flood the feed or swallow a legitimate listing.
 *
 * Timeline convention used throughout: `now` starts at 1_000_000, one
 * "minute" = 60_000, one "hour" = 3_600_000. The default settle window
 * is 45 min (2_700_000ms).
 */

const T0 = 1_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const SETTLE = DEFAULT_SETTLE_WINDOW_MS;
const MAX_WAIT = DEFAULT_MAX_SETTLE_WAIT_MS;

function run(prevEntry: any, currentIds: string[], nowMs: number, opts: any = {}) {
  return detectFranchiseChange({
    franchiseId: '0001',
    currentIds,
    prevEntry,
    nowMs,
    settleWindowMs: opts.settleWindowMs ?? SETTLE,
    maxSettleWaitMs: opts.maxSettleWaitMs ?? MAX_WAIT,
  });
}

describe('normalizeBlock', () => {
  it('dedupes, trims, and sorts for stable comparison', () => {
    expect(normalizeBlock(['b', 'a', 'a', ' c '])).toEqual(['a', 'b', 'c']);
  });
  it('tolerates non-array input', () => {
    expect(normalizeBlock(undefined)).toEqual([]);
    expect(normalizeBlock(null as any)).toEqual([]);
  });
});

describe('detectFranchiseChange — per-franchise', () => {
  it('first run seeds silently — no emission even with 17 players already on the block', () => {
    const current = Array.from({ length: 17 }, (_, i) => String(10000 + i));
    const r = run(undefined, current, T0);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe('seed');
    expect(r.nextEntry.committedBlock).toEqual(normalizeBlock(current));
    expect(r.nextEntry.observedBlock).toEqual(normalizeBlock(current));
    expect(r.nextEntry.firstChangeTs).toBeNull();
    expect(r.nextEntry.lastChangeTs).toBeNull();
  });

  it('single add fires after the settle window — 1 player tip', () => {
    // T0: seed
    const seed = run(undefined, ['A'], T0);
    expect(seed.emit).toBe(false);

    // T0+1min: owner adds B → drifting
    const mid = run(seed.nextEntry, ['A', 'B'], T0 + MIN);
    expect(mid.emit).toBe(false);
    expect(mid.reason).toBe('drifting');
    expect(mid.netAdds).toEqual(['B']);

    // T0+1min + settle window: same observed block → settled → emit
    const out = run(mid.nextEntry, ['A', 'B'], T0 + MIN + SETTLE);
    expect(out.emit).toBe(true);
    expect(out.reason).toBe('settled');
    expect(out.netAdds).toEqual(['B']);
    expect(out.netRemoves).toEqual([]);
    expect(out.nextEntry.committedBlock).toEqual(['A', 'B']);
    expect(out.nextEntry.firstChangeTs).toBeNull();
  });

  it('six adds over 20 minutes coalesce into one post', () => {
    const seed = run(undefined, [], T0);
    const adds = ['A', 'B', 'C', 'D', 'E', 'F'];
    let state = seed.nextEntry;
    let now = T0;
    for (let i = 0; i < adds.length; i++) {
      now += 4 * MIN; // each add arrives 4 min after the prior
      const current = adds.slice(0, i + 1);
      const step = run(state, current, now);
      expect(step.emit).toBe(false);
      expect(step.reason).toBe('drifting');
      state = step.nextEntry;
    }
    // Let the settle window clear after the last change at T0 + 24min
    const fired = run(state, adds, now + SETTLE);
    expect(fired.emit).toBe(true);
    expect(fired.reason).toBe('settled');
    expect(fired.netAdds.sort()).toEqual([...adds].sort());
  });

  it('add and remove of the same player inside the window is silent', () => {
    const seed = run(undefined, ['A'], T0);
    const add = run(seed.nextEntry, ['A', 'B'], T0 + MIN);
    expect(add.reason).toBe('drifting');
    const removed = run(add.nextEntry, ['A'], T0 + 2 * MIN);
    // observedBlock changed back to committed so netAdds and netRemoves are empty
    expect(removed.emit).toBe(false);
    expect(removed.reason).toBe('no_change');
    expect(removed.nextEntry.firstChangeTs).toBeNull();
    expect(removed.nextEntry.lastChangeTs).toBeNull();
  });

  it('add → settle → emit → remove fires silently and advances committedBlock', () => {
    const seed = run(undefined, ['A'], T0);
    const driftStep = run(seed.nextEntry, ['A', 'B'], T0 + MIN);
    const emitted = run(driftStep.nextEntry, ['A', 'B'], T0 + MIN + SETTLE);
    expect(emitted.emit).toBe(true);
    // Later: owner quietly removes B
    const removed = run(emitted.nextEntry, ['A'], T0 + 2 * HOUR);
    const settledRemove = run(removed.nextEntry, ['A'], T0 + 2 * HOUR + SETTLE);
    expect(settledRemove.emit).toBe(false);
    expect(settledRemove.reason).toBe('silent_sync');
    expect(settledRemove.nextEntry.committedBlock).toEqual(['A']);
  });

  it('re-add after a silent remove emits again on the next settle', () => {
    // Start committed = [A, B]
    let state = {
      committedBlock: ['A', 'B'],
      observedBlock: ['A', 'B'],
      firstChangeTs: null,
      lastChangeTs: null,
    };
    // Remove B silently
    const remove = run(state, ['A'], T0);
    const removeSettled = run(remove.nextEntry, ['A'], T0 + SETTLE);
    expect(removeSettled.emit).toBe(false);
    expect(removeSettled.reason).toBe('silent_sync');
    state = removeSettled.nextEntry;

    // Re-add B
    const readd = run(state, ['A', 'B'], T0 + HOUR);
    expect(readd.emit).toBe(false);
    const readdFire = run(readd.nextEntry, ['A', 'B'], T0 + HOUR + SETTLE);
    expect(readdFire.emit).toBe(true);
    expect(readdFire.netAdds).toEqual(['B']);
  });

  it('max settle wait force-fires even when the owner keeps tweaking', () => {
    const seed = run(undefined, ['A'], T0);
    let state = seed.nextEntry;
    // Owner keeps bouncing a different player in and out so lastChangeTs resets every 5 min
    let now = T0;
    for (let i = 0; i < 100; i++) {
      now += 5 * MIN;
      if (now - T0 >= MAX_WAIT + MIN) break;
      const current = i % 2 === 0 ? ['A', 'X'] : ['A', 'Y'];
      const step = run(state, current, now);
      state = step.nextEntry;
    }
    // At this point now is past T0 + MAX_WAIT. The drift started at the
    // first flip (T0 + 5min) — max-wait fires.
    const final = run(state, ['A', 'X'], now);
    expect(final.emit).toBe(true);
    expect(final.reason === 'max_wait' || final.reason === 'settled').toBe(true);
    expect(final.netAdds).toContain('X');
  });

  it('pure removes never fire — emit=false, silent_sync when window clears', () => {
    const state = {
      committedBlock: ['A', 'B', 'C'],
      observedBlock: ['A', 'B', 'C'],
      firstChangeTs: null,
      lastChangeTs: null,
    };
    const r = run(state, ['A'], T0);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe('drifting');
    const rSettled = run(r.nextEntry, ['A'], T0 + SETTLE);
    expect(rSettled.emit).toBe(false);
    expect(rSettled.reason).toBe('silent_sync');
    expect(rSettled.netAdds).toEqual([]);
    expect(rSettled.netRemoves.sort()).toEqual(['B', 'C']);
    expect(rSettled.nextEntry.committedBlock).toEqual(['A']);
  });

  it('flags truncated when netAdds exceeds MAX_ADDS_PER_TIP', () => {
    const state = {
      committedBlock: [],
      observedBlock: [],
      firstChangeTs: null,
      lastChangeTs: null,
    };
    const huge = Array.from({ length: MAX_ADDS_PER_TIP + 5 }, (_, i) => `P${i}`);
    const step = run(state, huge, T0);
    const fired = run(step.nextEntry, huge, T0 + SETTLE);
    expect(fired.emit).toBe(true);
    expect(fired.truncated).toBe(true);
    expect(fired.netAdds.length).toBe(MAX_ADDS_PER_TIP + 5);
  });
});

describe('detectTradeBaitChanges — whole-snapshot', () => {
  it('seeds every franchise silently on first run', () => {
    const current = {
      '0001': { playerIds: ['A', 'B'] },
      '0005': { playerIds: ['C'] },
    };
    const { nextState, emissions } = detectTradeBaitChanges({
      currentByFranchise: current,
      prevState: undefined,
      nowMs: T0,
    });
    expect(emissions).toEqual([]);
    expect(Object.keys(nextState).sort()).toEqual(['0001', '0005']);
    expect(nextState['0001'].committedBlock).toEqual(['A', 'B']);
  });

  it('emits per-franchise on independent timelines', () => {
    // Franchise 0001 has been drifting with B added and the window is clear;
    // franchise 0005 has been settled on C the whole time.
    const now = T0 + 2 * HOUR;
    const prev: Record<string, any> = {
      '0001': {
        committedBlock: ['A'],
        observedBlock: ['A', 'B'],
        firstChangeTs: now - SETTLE - MIN,
        lastChangeTs: now - SETTLE - MIN,
      },
      '0005': { committedBlock: ['C'], observedBlock: ['C'], firstChangeTs: null, lastChangeTs: null },
    };
    const current = {
      '0001': {
        playerIds: ['A', 'B'],
        willGiveUpComment: 'looking for WR depth',
        willTakeComment: '',
      },
      '0005': { playerIds: ['C'] },
    };
    const { emissions, nextState } = detectTradeBaitChanges({
      currentByFranchise: current,
      prevState: prev,
      nowMs: now,
    });
    expect(emissions.length).toBe(1);
    expect(emissions[0].franchiseId).toBe('0001');
    expect(emissions[0].netAdds).toEqual(['B']);
    expect(emissions[0].willGiveUpComment).toBe('looking for WR depth');
    expect(nextState['0001'].committedBlock).toEqual(['A', 'B']);
    expect(nextState['0005'].committedBlock).toEqual(['C']);
  });

  it('handles a franchise that dropped out of the fetch (block went empty)', () => {
    const prev = {
      '0001': { committedBlock: ['A'], observedBlock: ['A'], firstChangeTs: null, lastChangeTs: null },
    };
    const { emissions, nextState } = detectTradeBaitChanges({
      currentByFranchise: {},
      prevState: prev,
      nowMs: T0,
    });
    expect(emissions).toEqual([]);
    // Drift starts now — next cycle past the window will silent_sync
    expect(nextState['0001'].firstChangeTs).toBe(T0);
    expect(nextState['0001'].committedBlock).toEqual(['A']);
  });
});
