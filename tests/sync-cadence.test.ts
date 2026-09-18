/**
 * The roster sync's cadence tiers.
 *
 * This is the module that decides how much the sync costs. Every dispatch it
 * allows becomes a workflow run and — because a changed sync commits to `main`
 * — a production build, which is 91% of the Vercel bill. Every dispatch it
 * withholds is a window where the site can be stale. Both directions have
 * already gone wrong in production:
 *
 *   - too slow: on 2026-09-16 TheLeague sat a full hour past the Wed 19:00 PT
 *     waiver run still serving pre-waiver rosters.
 *   - too fast: the flat 15-minute cadence that replaced it ran ~122 production
 *     builds a day against ~37 before.
 *
 * So the tiers are pinned here rather than left to read correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  syncCadenceDecision,
  TIER_INTERVAL_MINUTES,
  TICK_MINUTES,
  WAIVER_TAIL_HOURS,
  GAME_WINDOW_HOURS,
} from '../src/utils/sync-cadence';

const PT = 'America/Los_Angeles';

/** TheLeague's real 2026 WAIVER_BBID: Wed 19:00 PT, repeating 14 more weeks. */
const THELEAGUE_WAIVERS = [
  { type: 'WAIVER_BBID', start_time: '1789610400', happens: '14' },
];
/** The AFL runs an hour later, on WAIVER_REVERSE — a different type AND time. */
const AFL_WAIVERS = [
  { type: 'WAIVER_REVERSE', start_time: '1789614000', happens: '14' },
];

const at = (iso: string) => new Date(iso);
/** Snap to a minute that is a dispatch slot in every tier (minute 0). */
const onTheHour = (iso: string) => new Date(iso);

describe('sync cadence — tier resolution', () => {
  it('is idle with no calendars and no schedule, never silent', () => {
    // A feed that failed to load must not be able to switch the sync OFF.
    const d = syncCadenceDecision(at('2026-09-15T18:00:00Z'), {});
    expect(d.tier).toBe('idle');
    expect(d.intervalMinutes).toBe(60);
    expect(d.dispatch).toBe(true); // minute 0 — the hourly beat still lands
  });

  it('enters the waiver tier for the tail after a run', () => {
    const opts = { calendars: [THELEAGUE_WAIVERS], zone: PT };
    // Run is 2026-09-17T02:00Z (Wed 19:00 PT).
    expect(syncCadenceDecision(at('2026-09-17T02:00:00Z'), opts).tier).toBe('waiver');
    expect(syncCadenceDecision(at('2026-09-17T03:00:00Z'), opts).tier).toBe('waiver');
    expect(syncCadenceDecision(at('2026-09-17T03:59:00Z'), opts).tier).toBe('waiver');
  });

  it('leaves the waiver tier exactly WAIVER_TAIL_HOURS after the run', () => {
    const opts = { calendars: [THELEAGUE_WAIVERS], zone: PT };
    const runMs = 1789610400 * 1000;
    const edge = new Date(runMs + WAIVER_TAIL_HOURS * 3600_000);
    expect(syncCadenceDecision(edge, opts).tier).toBe('waiver');
    expect(syncCadenceDecision(new Date(edge.getTime() + 60_000), opts).tier).toBe('idle');
  });

  it('is NOT in the waiver tier before the run', () => {
    const opts = { calendars: [THELEAGUE_WAIVERS], zone: PT };
    expect(syncCadenceDecision(at('2026-09-17T01:55:00Z'), opts).tier).toBe('idle');
  });

  it('takes the UNION of both leagues — the AFL runs an hour later', () => {
    // 04:30Z is 2.5h past TheLeague's run (tail expired) but 30min past the
    // AFL's. Scoping the window to one league would leave AFL owners staring at
    // stale rosters — the original bug wearing a hat.
    const t = at('2026-09-17T04:30:00Z');
    expect(syncCadenceDecision(t, { calendars: [THELEAGUE_WAIVERS], zone: PT }).tier).toBe('idle');
    expect(
      syncCadenceDecision(t, { calendars: [THELEAGUE_WAIVERS, AFL_WAIVERS], zone: PT }).tier,
    ).toBe('waiver');
  });

  it('follows the WALL CLOCK across the November DST change', () => {
    // Recurrence 7 lands 2026-11-04 19:00 PT — after the Nov 1 transition, so
    // 03:00Z, not 02:00Z. A fixed +7×24h step would put it an hour early and
    // the waiver tier would open (and close) an hour off for the rest of the
    // season.
    const opts = { calendars: [THELEAGUE_WAIVERS], zone: PT };
    expect(syncCadenceDecision(at('2026-11-05T03:30:00Z'), opts).tier).toBe('waiver');
    expect(syncCadenceDecision(at('2026-11-05T02:30:00Z'), opts).tier).toBe('idle');
  });

  it('ignores a WAIVER_UNLOCK — it closes the window but runs no claims', () => {
    const unlockOnly = [{ type: 'WAIVER_UNLOCK', start_time: '1789610400' }];
    expect(
      syncCadenceDecision(at('2026-09-17T02:30:00Z'), { calendars: [unlockOnly], zone: PT }).tier,
    ).toBe('idle');
  });
});

describe('sync cadence — game windows', () => {
  const kickoff = 1789690500; // a real 2026 matchup kickoff from nflSchedule
  const opts = { kickoffs: [String(kickoff)], zone: PT };

  it('is in the game tier from kickoff', () => {
    expect(syncCadenceDecision(new Date(kickoff * 1000), opts).tier).toBe('game');
  });

  it('stays for GAME_WINDOW_HOURS, then drops to idle', () => {
    const end = new Date(kickoff * 1000 + GAME_WINDOW_HOURS * 3600_000);
    expect(syncCadenceDecision(end, opts).tier).toBe('game');
    expect(syncCadenceDecision(new Date(end.getTime() + 60_000), opts).tier).toBe('idle');
  });

  it('is not in the game tier before kickoff', () => {
    expect(syncCadenceDecision(new Date(kickoff * 1000 - 60_000), opts).tier).toBe('idle');
  });

  it('rejects a millisecond timestamp rather than disabling the tier', () => {
    // MFL reports kickoff in SECONDS. A ms value would place every game ~55,000
    // years out, silently turning the game tier off forever.
    const ms = { kickoffs: [String(kickoff * 1000)], zone: PT };
    expect(syncCadenceDecision(new Date(kickoff * 1000), ms).tier).toBe('idle');
  });

  it('lets the waiver tier outrank a simultaneous game', () => {
    const t = at('2026-09-17T02:30:00Z');
    const both = { calendars: [THELEAGUE_WAIVERS], kickoffs: [String(Math.floor(t.getTime() / 1000))], zone: PT };
    expect(syncCadenceDecision(t, both).tier).toBe('waiver');
  });
});

describe('sync cadence — dispatch slots', () => {
  it('uses the documented interval per tier', () => {
    expect(TIER_INTERVAL_MINUTES).toEqual({ waiver: 5, game: 15, idle: 60 });
  });

  it('every tier interval is a whole multiple of the cron tick', () => {
    // Otherwise a tier's slots would never align with when Vercel actually
    // fires, and that tier would dispatch erratically or not at all.
    for (const [tier, minutes] of Object.entries(TIER_INTERVAL_MINUTES)) {
      expect(minutes % TICK_MINUTES, `${tier} must be a multiple of the tick`).toBe(0);
      expect(60 % minutes, `${tier} must divide the hour`).toBe(0);
    }
  });

  it('nests the slots so crossing a tier boundary cannot skip a beat', () => {
    // Every idle slot is also a game slot is also a waiver slot.
    for (let m = 0; m < 60; m += 1) {
      const idle = m % TIER_INTERVAL_MINUTES.idle === 0;
      const game = m % TIER_INTERVAL_MINUTES.game === 0;
      const waiver = m % TIER_INTERVAL_MINUTES.waiver === 0;
      if (idle) expect(game, `minute ${m}`).toBe(true);
      if (game) expect(waiver, `minute ${m}`).toBe(true);
    }
  });

  it('dispatches every tick in the waiver tier', () => {
    const opts = { calendars: [THELEAGUE_WAIVERS], zone: PT };
    for (const m of [0, 5, 10, 25, 55]) {
      const t = new Date(Date.UTC(2026, 8, 17, 3, m));
      const d = syncCadenceDecision(t, opts);
      expect(d.tier).toBe('waiver');
      expect(d.dispatch, `minute ${m}`).toBe(true);
    }
  });

  it('dispatches only on the quarter hour in the game tier', () => {
    const kickoff = Math.floor(Date.UTC(2026, 8, 20, 17, 0) / 1000);
    const opts = { kickoffs: [String(kickoff)], zone: PT };
    const fired: number[] = [];
    for (let m = 0; m < 60; m += TICK_MINUTES) {
      const d = syncCadenceDecision(new Date(Date.UTC(2026, 8, 20, 18, m)), opts);
      expect(d.tier).toBe('game');
      if (d.dispatch) fired.push(m);
    }
    expect(fired).toEqual([0, 15, 30, 45]);
  });

  it('dispatches once an hour when idle', () => {
    const fired: number[] = [];
    for (let m = 0; m < 60; m += TICK_MINUTES) {
      const d = syncCadenceDecision(new Date(Date.UTC(2026, 6, 15, 12, m)), {});
      if (d.dispatch) fired.push(m);
    }
    expect(fired).toEqual([0]);
  });

  it('explains a skipped tick rather than returning a bare false', () => {
    const d = syncCadenceDecision(new Date(Date.UTC(2026, 6, 15, 12, 25)), {});
    expect(d.dispatch).toBe(false);
    expect(d.reason).toMatch(/between dispatches/);
  });
});

describe('sync cadence — projected cost', () => {
  it('is far cheaper than the flat 15-minute cadence it replaces', () => {
    // Walk a full week at the real tick and count dispatches, against the 672
    // a flat */15 would run. The waiver tail is the only thing running at full
    // speed, and it is two hours a week.
    const opts = { calendars: [THELEAGUE_WAIVERS, AFL_WAIVERS], zone: PT };
    let dispatches = 0;
    const start = Date.UTC(2026, 8, 14, 0, 0);
    for (let m = 0; m < 7 * 24 * 60; m += TICK_MINUTES) {
      if (syncCadenceDecision(new Date(start + m * 60_000), opts).dispatch) dispatches += 1;
    }
    const flatFifteen = (7 * 24 * 60) / 15;
    expect(dispatches).toBeLessThan(flatFifteen / 2);
    // And it must not collapse to nothing — the hourly floor always runs.
    expect(dispatches).toBeGreaterThanOrEqual(7 * 24);
  });
});
