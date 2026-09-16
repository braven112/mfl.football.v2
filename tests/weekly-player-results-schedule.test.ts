import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildWeeklyPlayerResults } from '../src/utils/weekly-player-results';

/**
 * Guard: the modal's Season Results table lost the NFL schedule the day the
 * season opened, and reported the loss as a season of bye weeks.
 *
 * MFL's `nflSchedule` export answers a W-LESS request with the FULL season in
 * the offseason and with the CURRENT WEEK ONLY from week 1 onward. The feed
 * `scripts/fetch-mfl-feeds.mjs` commits as `nflSchedule.json` is that W-less
 * request, so on 2026-09-09 every consumer needing all 18 weeks silently got
 * one. `buildWeeklyPlayerResults` reads `fullNflSchedule.nflSchedule[]`, found
 * nothing, and — because it treated "team not in this week's schedule" and
 * "no schedule for this week" as the same thing — stamped BYE on all 17 weeks.
 * PlayerDetailsModal renders a BYE row without its points, so every player on
 * both leagues' sites read 0.00 for a week they had actually scored.
 *
 * Three rules hold the fix:
 *   1. The W=ALL feed exists and is fetched from api.myfantasyleague.com —
 *      the per-league www## hosts reject W=ALL at HTTP 200.
 *   2. A week with no schedule loaded is UNKNOWN, never a bye, and keeps its
 *      points.
 *   3. A lineup row MFL has not scored yet is `null`, not 0 — scoring it 0
 *      counted unplayed weeks as games and dragged the per-game average to
 *      zero ("0.0 — 3 GAMES — 0.0 PER GAME" for a player who had scored 2.60).
 */

const ROOT = process.cwd();
const FETCH_SCRIPT = join(ROOT, 'scripts/fetch-mfl-feeds.mjs');

/** One franchise's week, in MFL's weeklyResults shape. */
const week = (num: number, players: Array<Record<string, string>>) => ({
  weeklyResults: {
    week: String(num),
    matchup: [{ franchise: [{ id: '0001', player: players }] }],
  },
});

const PLAYERS = { players: { player: [{ id: '14823', position: 'RB', team: 'PIT' }] } };
const LEAGUE = { league: { franchises: { franchise: [{ id: '0001', name: 'Pacific Pigskins' }] } } };

/** MFL's W=ALL shape: one entry per week. */
const fullSchedule = {
  fullNflSchedule: {
    nflSchedule: [
      { week: '1', matchup: [{ team: [{ id: 'PIT', isHome: '1' }, { id: 'ATL', isHome: '0' }] }] },
      // Week 2 exists but PIT is not in it — a genuine bye.
      { week: '2', matchup: [{ team: [{ id: 'KCC', isHome: '1' }, { id: 'NEP', isHome: '0' }] }] },
    ],
  },
};

/** MFL's in-season W-less shape: the current week alone, no week list. */
const singleWeekSchedule = {
  nflSchedule: {
    week: '1',
    matchup: [{ team: [{ id: 'PIT', isHome: '1' }, { id: 'ATL', isHome: '0' }] }],
  },
};

const build = (schedule: unknown, weeks: unknown[]) =>
  buildWeeklyPlayerResults(weeks as any[], schedule, {}, PLAYERS, LEAGUE, 3)['14823'];

describe('the W=ALL schedule feed', () => {
  it('is fetched, and from the API host that will answer it', () => {
    const src = readFileSync(FETCH_SCRIPT, 'utf8');
    const entry = src.match(/key: 'nflSchedule-full',\s*\n\s*url: `([^`]+)`/);
    expect(entry, "scripts/fetch-mfl-feeds.mjs must fetch a 'nflSchedule-full' feed").toBeTruthy();

    const url = entry![1];
    expect(url, 'the full schedule needs W=ALL — without it MFL serves the current week only').toContain('W=ALL');
    expect(
      url,
      'W=ALL must go to API_HOST: the per-league www## hosts answer it with an error payload at HTTP 200',
    ).toContain('${API_HOST}');
    expect(url).not.toContain('${host}');
  });

  it('is committed for the current season in every full-management league', () => {
    // Season year, not league year: this table is results-shaped.
    const seasonYear = new Date() >= new Date(`${new Date().getFullYear()}-09-01`)
      ? new Date().getFullYear()
      : new Date().getFullYear() - 1;

    for (const league of ['theleague', 'afl-fantasy']) {
      const file = join(ROOT, `data/${league}/mfl-feeds/${seasonYear}/nflSchedule-full.json`);
      if (!existsSync(file)) continue; // a season the cron has not opened yet
      const feed = JSON.parse(readFileSync(file, 'utf8'));
      expect(feed?.error, `${league}: committed an MFL error payload`).toBeUndefined();
      expect(
        Array.isArray(feed?.fullNflSchedule?.nflSchedule),
        `${league}/${seasonYear}/nflSchedule-full.json must carry fullNflSchedule.nflSchedule[]`,
      ).toBe(true);
      expect(feed.fullNflSchedule.nflSchedule.length).toBeGreaterThan(17);
    }
  });
});

describe('buildWeeklyPlayerResults', () => {
  it('marks a bye only when that week’s schedule says so', () => {
    const weeks = build(fullSchedule, [week(1, [{ id: '14823', score: '2.60', status: 'nonstarter' }])]);

    expect(weeks[0].st).toBe('NS');
    expect(weeks[0].opp).toBe('vs ATL');
    // Week 2 is in the schedule and PIT is not playing — a real bye.
    expect(weeks[1].st).toBe('BYE');
    // Week 3 is absent from the schedule entirely — unknown, not a bye.
    expect(weeks[2].st).not.toBe('BYE');
    expect(weeks[2].opp).toBeNull();
  });

  it('keeps a scored week’s points when the schedule is the single-week shape', () => {
    const weeks = build(singleWeekSchedule, [week(1, [{ id: '14823', score: '2.60', status: 'starter' }])]);

    expect(weeks[0].p).toBe(2.6);
    expect(weeks[0].opp).toBe('vs ATL');
    expect(weeks.some((w) => w.st === 'BYE'), 'an unknown week must never render as a bye').toBe(false);
  });

  it('keeps a scored week’s points when there is no schedule at all', () => {
    const weeks = build(null, [week(1, [{ id: '14823', score: '2.60', status: 'starter' }])]);

    expect(weeks[0].p).toBe(2.6);
    expect(weeks[0].opp).toBeNull();
    expect(weeks.some((w) => w.st === 'BYE')).toBe(false);
  });

  it('treats an unscored lineup row as no score, and a real 0.00 as zero', () => {
    const weeks = build(fullSchedule, [
      week(1, [{ id: '14823', score: '2.60', status: 'starter' }]),
      // MFL lists the lineup for an upcoming week with no `score` key at all.
      week(3, [{ id: '14823', status: 'starter' }]),
    ]);

    expect(weeks[0].p).toBe(2.6);
    expect(weeks[2].p, 'a week MFL has not scored is not a 0.00 game').toBeNull();

    const zeroed = build(fullSchedule, [week(1, [{ id: '14823', score: '0.00', status: 'starter' }])]);
    expect(zeroed[0].p, 'a player who actually scored nothing still played').toBe(0);
  });
});
