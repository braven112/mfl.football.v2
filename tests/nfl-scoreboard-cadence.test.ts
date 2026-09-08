/**
 * The ESPN scoreboard poll cadence.
 *
 * `useNflScoreboard` OR-ed the page's game-day hint into `liveNow`
 * unconditionally. That hint comes from `getDailySlot`, is computed
 * server-side, and is fixed for the life of the page — and the live-scoring
 * slot stays open long past the last whistle (Sunday 8:30pm+ and Monday 11pm+
 * both still return it). So POLL_STALE was unreachable on a game day and every
 * subscriber stayed at 60s for hours after the last game had gone final.
 *
 * The trap that makes this harder than it looks, and that the first attempt at
 * the fix walked straight into: **ESPN's slate is a whole WEEK, not a day.**
 * `buildEspnScoreboardUrl` asks for `?week=N`, so Thursday through Monday all
 * arrive together. "Some game is still `pre`" is therefore true from Thursday
 * lunchtime to Monday night, and an `allFinal` test is false all Sunday evening
 * because Monday's game has not kicked off. The rule has to read the clock.
 *
 * The shared store runs at the MINIMUM interval any subscriber asks, and both
 * LiveScoreboard and NflGamesStrip subscribe to the same key — so one pinned
 * subscriber pinned the page. That is why this lives in the hook rather than
 * at either call site.
 *
 * The decision is a pure function specifically so it can be tested here:
 * vitest runs `environment: 'node'` with no DOM harness, so a rule left inside
 * the hook could only be guarded by scanning source text.
 */

import { describe, it, expect } from 'vitest';
import { shouldPollLive, KICKOFF_SOON_MS, POLL_STALE } from '../src/hooks/useNflScoreboard';

/** A real Week 1 shape: Thursday night, the Sunday windows, Monday night. */
const SUN_1PM = Date.parse('2026-09-13T17:00:00Z');
const HOUR = 3_600_000;

const game = (state: 'pre' | 'in' | 'post', kickoff: number) =>
  ({ state, date: new Date(kickoff).toISOString() });

/** Thu final, Sunday early/late/SNF, Monday night — the whole week, as ESPN sends it. */
const week = (states: { thu: 'pre'|'in'|'post'; early: 'pre'|'in'|'post'; snf: 'pre'|'in'|'post'; mnf: 'pre'|'in'|'post' }) => [
  game(states.thu, SUN_1PM - 3 * 24 * HOUR),
  game(states.early, SUN_1PM),
  game(states.snf, SUN_1PM + 7.5 * HOUR),
  game(states.mnf, SUN_1PM + 27 * HOUR),
];

describe('shouldPollLive', () => {
  it('SUNDAY EVENING: backs off once the day is done, even with Monday still pre', () => {
    // The actual bug. Every Sunday game final at 11pm ET, MNF ~21h out — and
    // the page's hint still says "live-scoring" because the slot runs to
    // midnight. The first attempt at this fix used `every(state === 'post')`,
    // which is FALSE here because of MNF, so it changed nothing at all.
    const sundayLate = SUN_1PM + 10 * HOUR;
    const slate = week({ thu: 'post', early: 'post', snf: 'post', mnf: 'pre' });
    expect(shouldPollLive(slate, true, sundayLate)).toBe(false);
  });

  it('SUNDAY MORNING: backs off hours out, then wakes before kickoff', () => {
    const slate = week({ thu: 'post', early: 'pre', snf: 'pre', mnf: 'pre' });
    expect(shouldPollLive(slate, true, SUN_1PM - 4 * HOUR)).toBe(false);
    // Inside the window the board goes fast again — without needing the hint.
    expect(shouldPollLive(slate, false, SUN_1PM - 10 * 60_000)).toBe(true);
  });

  it('the kickoff window is wider than POLL_STALE, so a slow board is never late', () => {
    // A board on the 5-minute cadence must get at least one tick inside the
    // window before kickoff, or it starts the game late.
    expect(KICKOFF_SOON_MS).toBeGreaterThan(POLL_STALE);
  });

  it('a game in progress is live regardless of the hint', () => {
    expect(shouldPollLive(week({ thu: 'post', early: 'in', snf: 'pre', mnf: 'pre' }), false, SUN_1PM + HOUR)).toBe(true);
  });

  it('a pre game whose kickoff has passed still counts — ESPN flips state late', () => {
    const slate = [game('pre', SUN_1PM)];
    expect(shouldPollLive(slate, false, SUN_1PM + 2 * 60_000)).toBe(true);
  });

  it('the whole week final backs off, hint or not', () => {
    const slate = week({ thu: 'post', early: 'post', snf: 'post', mnf: 'post' });
    expect(shouldPollLive(slate, true, SUN_1PM + 30 * HOUR)).toBe(false);
    expect(shouldPollLive(slate, false, SUN_1PM + 30 * HOUR)).toBe(false);
  });

  it('an EMPTY slate is "nothing loaded yet", never "all final"', () => {
    // [].every(...) is true, so a naive allFinal test drops the FIRST load to
    // POLL_STALE. With no data the page's hint is all there is.
    expect(shouldPollLive([], true)).toBe(true);
    expect(shouldPollLive([], false)).toBe(false);
  });

  it('a game with no parseable date never forces the fast cadence', () => {
    expect(shouldPollLive([{ state: 'pre', date: '' }], false, SUN_1PM)).toBe(false);
    expect(shouldPollLive([{ state: 'pre', date: 'not a date' }], false, SUN_1PM)).toBe(false);
  });
});
