import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * Guards for data/<league>/derived/top-players.json, the committed payload the
 * Top Players page renders (scripts/compute-top-players.mjs, wired into
 * prebuild). Every assertion here is a bug the plan predicted, not a spec
 * restated for its own sake:
 *
 * - The FREE-AGENT pool must be non-empty. This is the whole reason the page
 *   reads `player-scores-weekly.json` instead of `weekly-results-raw.json`,
 *   which records a player's score only for weeks he sat on some roster. The
 *   keeper report card shipped without this check and got a pool SHORTER than
 *   the number of startable slots. See docs/claude/insights/domains/mfl-api.md
 *   § 2026-08-10.
 * - `games` must count weeks actually SCORED. A week MFL has listed but not
 *   scored is absent, not zero; counting it reads "0.0 per game" for a player
 *   who has played once (the bug weekly-player-results.ts carries a comment
 *   about).
 * - Owners must be a LIST. The AFL is `duplicatePlayers: true` — the same NFL
 *   player is routinely rostered once per conference — so a scalar owner is
 *   how a rival's player ends up attributed to you.
 * - The week range must come from each league's own feed. TheLeague runs
 *   weeks 1-17 and the AFL 1-18; a hardcoded 17 silently drops the AFL's last
 *   week.
 */

interface Owner {
  id: string;
  name: string;
  icon: string | null;
}
interface TopPlayerRow {
  id: string;
  name: string;
  position: string;
  team: string | null;
  espnId: string | null;
  owners: Owner[];
  weeks: Record<string, number>;
  total: number;
  avg: number;
  games: number;
  best: number;
  rank: number;
  posRank: number;
}
interface TopPlayersPayload {
  seasonYear: number;
  startWeek: number;
  endWeek: number;
  lastRegularSeasonWeek: number | null;
  completedWeeks: number[];
  positions: string[];
  players: TopPlayerRow[];
}

const ROOT = resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8'));

// Every league that runs full management gets the page. Best Ball is
// draft-only with no live MFL syncing, so it has no scoring data behind a
// leaderboard (docs/claude/rules/best-ball.md).
const SCORING_LEAGUES = Object.values(LEAGUES as Record<string, { slug: string; dataPath: string; bestBall?: boolean }>)
  .filter((l) => !l.bestBall)
  .map((l) => ({ slug: l.slug, dataPath: l.dataPath }));

describe('top-players derived payload', () => {
  it('covers every full-management league, and only those', () => {
    expect(SCORING_LEAGUES.map((l) => l.slug).sort()).toEqual(['afl-fantasy', 'theleague']);
  });

  for (const { slug, dataPath } of SCORING_LEAGUES) {
    describe(slug, () => {
      const payload: TopPlayersPayload = readJson(`${dataPath}/derived/top-players.json`);
      const { players } = payload;

      it('has rows', () => {
        expect(players.length).toBeGreaterThan(0);
      });

      it('sees the free-agent pool — the reason this feed exists', () => {
        const freeAgents = players.filter((p) => p.owners.length === 0);
        // weekly-results-raw.json would report ZERO here by construction.
        expect(freeAgents.length).toBeGreaterThan(0);
      });

      it('labels every row — a scoring id with no players.json entry is dropped, never shown blank', () => {
        for (const p of players) {
          expect(p.name.trim(), `player ${p.id} has no name`).not.toBe('');
          expect(p.position.trim(), `player ${p.id} has no position`).not.toBe('');
        }
      });

      it('totals equal the sum of the weekly scores', () => {
        for (const p of players) {
          const sum = Object.values(p.weeks).reduce((a, b) => a + b, 0);
          expect(p.total, `${p.name} total`).toBeCloseTo(sum, 2);
        }
      });

      it('games counts only weeks actually scored, and drives avg', () => {
        for (const p of players) {
          expect(p.games, `${p.name} games`).toBe(Object.keys(p.weeks).length);
          if (p.games > 0) {
            // avg is rounded from the UNROUNDED total, while `p.total` is the
            // rounded one, so the test cannot reconstruct avg exactly — a
            // tolerance is the right shape. But toBeCloseTo(_, 2) demands a
            // difference STRICTLY below 0.005 and so fails on the .xx5 boundary:
            // Detroit Lions' 3.59 / 2 = 1.795 rounds to 1.8, a difference of
            // exactly 0.005, which reddened CI on 2026-09-19.
            //
            // Bound both rounding steps instead: |p.total - raw| <= 0.005 and
            // |p.avg - raw/games| <= 0.005, so by the triangle inequality
            // |p.avg - p.total/games| <= 0.005 + 0.005/games. The 1e-9 absorbs
            // float representation error at the boundary.
            expect(
              Math.abs(p.avg - p.total / p.games),
              `${p.name} avg (total=${p.total}, games=${p.games})`,
            ).toBeLessThanOrEqual(0.005 + 0.005 / p.games + 1e-9);
            expect(p.best, `${p.name} best`).toBe(Math.max(...Object.values(p.weeks)));
          }
        }
      });

      it('ranks players 1..N by total descending', () => {
        expect(players.map((p) => p.rank)).toEqual(players.map((_, i) => i + 1));
        for (let i = 1; i < players.length; i += 1) {
          expect(players[i].total).toBeLessThanOrEqual(players[i - 1].total);
        }
      });

      it('numbers each position 1..N with no gaps or repeats', () => {
        const byPosition = new Map<string, number[]>();
        for (const p of players) {
          if (!byPosition.has(p.position)) byPosition.set(p.position, []);
          byPosition.get(p.position)!.push(p.posRank);
        }
        for (const [position, ranks] of byPosition) {
          expect(ranks, `${position} posRanks`).toEqual(ranks.map((_, i) => i + 1));
        }
        expect([...byPosition.keys()].sort()).toEqual(payload.positions);
      });

      it('carries the espn id that draws the headshot', () => {
        // Without `espnId`, getPlayerHeadshot cannot build a URL and every
        // avatar falls through to the grey silhouette — which is how the page
        // first shipped. DEF rows are exempt: they render a team logo.
        const offence = players.filter((p) => p.position !== 'DEF');
        const withId = offence.filter((p) => p.espnId);
        expect(withId.length / offence.length).toBeGreaterThan(0.9);
        for (const p of players) {
          if (p.espnId !== null) expect(p.espnId, `${p.name} espnId`).toMatch(/^\d+$/);
        }
      });

      it('gives every owner a crest, because the Owner column renders one', () => {
        // The crest is that column's only identifier now. A null icon makes
        // TeamIconCell fall back to the name, which is correct but means the
        // league config lost a `team.icon` — worth failing on.
        const owners = players.flatMap((p) => p.owners);
        expect(owners.length).toBeGreaterThan(0);
        for (const o of owners) {
          expect(o.icon, `${o.name} has no crest`).toBeTruthy();
        }
      });

      it('agrees with rosters.json about who owns whom — as a LIST', () => {
        const rosters = readJson(`${dataPath}/mfl-feeds/${payload.seasonYear}/rosters.json`);
        const franchises = rosters?.rosters?.franchise ?? [];
        const expected = new Map<string, Set<string>>();
        for (const f of Array.isArray(franchises) ? franchises : [franchises]) {
          const list = Array.isArray(f?.player) ? f.player : f?.player ? [f.player] : [];
          for (const p of list) {
            if (!p?.id) continue;
            if (!expected.has(p.id)) expected.set(p.id, new Set());
            expected.get(p.id)!.add(f.id);
          }
        }
        for (const p of players) {
          expect(new Set(p.owners.map((o) => o.id)), `${p.name} owners`).toEqual(
            expected.get(p.id) ?? new Set(),
          );
          for (const o of p.owners) expect(o.name.trim()).not.toBe('');
        }
      });

      it('takes its week range from the league feed, not a constant', () => {
        const feed = readJson(`${dataPath}/mfl-feeds/${payload.seasonYear}/league.json`)?.league;
        expect(payload.startWeek).toBe(Number(feed.startWeek));
        expect(payload.endWeek).toBe(Number(feed.endWeek));
      });

      it('reports only completed weeks, in order, inside the league range', () => {
        expect(payload.completedWeeks).toEqual([...payload.completedWeeks].sort((a, b) => a - b));
        expect(new Set(payload.completedWeeks).size).toBe(payload.completedWeeks.length);
        for (const w of payload.completedWeeks) {
          expect(w).toBeGreaterThanOrEqual(payload.startWeek);
          expect(w).toBeLessThanOrEqual(payload.endWeek);
        }
        // Every week any player scored in must be declared completed, and
        // every declared week must have scorers — otherwise the page's week
        // selector offers a week with nothing in it.
        const weeksSeen = new Set<number>();
        for (const p of players) for (const w of Object.keys(p.weeks)) weeksSeen.add(Number(w));
        expect([...weeksSeen].sort((a, b) => a - b)).toEqual(payload.completedWeeks);
      });

      it('stamps a season year whose feed directory it actually read', () => {
        expect(payload.seasonYear).toBeGreaterThan(2000);
        expect(() => readJson(`${dataPath}/mfl-feeds/${payload.seasonYear}/player-scores-weekly.json`)).not.toThrow();
      });
    });
  }

  it('gives the AFL its own week range — 1-18 against TheLeague 1-17', () => {
    const tl: TopPlayersPayload = readJson('data/theleague/derived/top-players.json');
    const afl: TopPlayersPayload = readJson('data/afl-fantasy/derived/top-players.json');
    // Not cosmetic: the weeklyResults loop in fetch-mfl-feeds.mjs hardcodes 17,
    // and copying that would drop the AFL's last week every season.
    expect(afl.endWeek).not.toBe(tl.endWeek);
  });
});
