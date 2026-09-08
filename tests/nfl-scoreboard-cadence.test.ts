/**
 * The ESPN scoreboard poll cadence.
 *
 * `useNflScoreboard` OR-ed the page's game-day hint into `liveNow`
 * unconditionally. That hint comes from `getDailySlot` and is computed
 * server-side, fixed for the life of the page — and the live-scoring slot
 * stays open long past the last whistle (Sunday 8:30pm+ and Monday 11pm+ both
 * still return it). So POLL_STALE was unreachable on a game day and every
 * subscriber stayed at 60s for hours after every game had gone final.
 *
 * The shared store runs at the MINIMUM interval any subscriber asks, and both
 * LiveScoreboard and NflGamesStrip subscribe to the same key — so one pinned
 * subscriber pinned the whole page. That is why this lives in the hook rather
 * than at either call site.
 *
 * The decision is a pure function specifically so it can be tested here:
 * vitest runs `environment: 'node'` with no DOM harness, so a rule left inside
 * the hook could only be guarded by scanning source text.
 */

import { describe, it, expect } from 'vitest';
import { shouldPollLive } from '../src/hooks/useNflScoreboard';

const g = (...states: Array<'pre' | 'in' | 'post'>) => states.map((state) => ({ state }));

describe('shouldPollLive', () => {
  it('stops the fast cadence once every game is final, hint or no hint', () => {
    // The bug: the hint outlived the slate for hours every Sunday night.
    expect(shouldPollLive(g('post', 'post'), true)).toBe(false);
    expect(shouldPollLive(g('post'), true)).toBe(false);
    expect(shouldPollLive(g('post', 'post'), false)).toBe(false);
  });

  it('keeps the fast cadence before kickoff, which is what the hint is FOR', () => {
    // A slate of `pre` games is not "in progress" but is about to be. Dropping
    // the hint here would put the board on POLL_STALE all Sunday morning and
    // leave it up to five minutes late noticing kickoff.
    expect(shouldPollLive(g('pre', 'pre'), true)).toBe(true);
    // …and without the hint (not a game day), a pre-game slate can wait.
    expect(shouldPollLive(g('pre', 'pre'), false)).toBe(false);
  });

  it('polls fast whenever a game is actually in progress, hint or not', () => {
    expect(shouldPollLive(g('post', 'in', 'post'), false)).toBe(true);
    expect(shouldPollLive(g('in'), false)).toBe(true);
  });

  it('a mixed slate is not final until the LAST game is', () => {
    expect(shouldPollLive(g('post', 'post', 'pre'), true)).toBe(true);
    expect(shouldPollLive(g('post', 'post', 'pre'), false)).toBe(false);
    expect(shouldPollLive(g('post', 'post', 'in'), false)).toBe(true);
  });

  it('an EMPTY slate is "nothing loaded yet", never "all final"', () => {
    // Before the first poll lands there are no games to look at, and treating
    // that as a finished slate would drop the very first load to POLL_STALE.
    expect(shouldPollLive([], true)).toBe(true);
    expect(shouldPollLive([], false)).toBe(false);
  });
});
