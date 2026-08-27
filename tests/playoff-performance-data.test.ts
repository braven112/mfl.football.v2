import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PlayoffPerformanceFile } from '../src/types/playoff-performance';

const root = resolve(__dirname, '..');
const read = <T>(p: string): T => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;

const data = read<PlayoffPerformanceFile>('data/theleague/derived/playoff-performance.json');
const champs = read<{ championships: { year: number; champion: string; runnerUp: string }[] }>(
  'data/theleague/championship-history.json'
).championships;

/** Seasons through 2025, so adding a completed 2026 doesn't silently move a
 *  pinned rate — a new season should make someone look at these numbers. */
const settled = data.seasons.filter((s) => s.year <= 2025);

describe('playoff-performance derived data', () => {
  it('covers every completed season from 2007 through 2025', () => {
    expect(settled.map((s) => s.year)).toEqual(
      Array.from({ length: 19 }, (_, i) => 2007 + i)
    );
  });

  it('agrees with the league championship history on every champion and runner-up', () => {
    for (const season of data.seasons) {
      const truth = champs.find((c) => c.year === season.year);
      expect(truth, `no recorded championship for ${season.year}`).toBeDefined();
      expect(season.champion.franchiseId, `${season.year} champion`).toBe(truth!.champion);
      expect(season.runnerUp.franchiseId, `${season.year} runner-up`).toBe(truth!.runnerUp);
    }
  });

  it('holds the headline rates the report is built on', () => {
    const count = (fn: (s: (typeof settled)[number]) => boolean) => settled.filter(fn).length;
    expect(settled).toHaveLength(19);
    expect(count((s) => s.topSeedWonTitle)).toBe(4);
    expect(count((s) => s.topSeedReachedFinal)).toBe(7);
    expect(count((s) => s.allPlayLeaderWonTitle)).toBe(5);
    expect(count((s) => s.topSeedIsAllPlayLeader)).toBe(9);
  });

  it('totals in the file match the seasons in the file', () => {
    const n = (fn: (s: PlayoffPerformanceFile['seasons'][number]) => boolean) =>
      data.seasons.filter(fn).length;
    expect(data.totals.seasons).toBe(data.seasons.length);
    expect(data.totals.topSeedTitles).toBe(n((s) => s.topSeedWonTitle));
    expect(data.totals.allPlayLeaderTitles).toBe(n((s) => s.allPlayLeaderWonTitle));
    expect(data.totals.topSeedIsAllPlayLeader).toBe(n((s) => s.topSeedIsAllPlayLeader));
  });

  /**
   * The whole reason the #1 seed is read off the bracket instead of the
   * standings feed. In both these seasons MFL's leagueStandings put a
   * different team in row 1 than the one that actually took the bye, so a
   * regression to "feed row 0 is the 1 seed" fails right here.
   */
  it('takes the #1 seed from the bye, not from standings row order', () => {
    const byYear = new Map(data.seasons.map((s) => [s.year, s]));
    expect(byYear.get(2008)?.topSeed.franchiseId).toBe('0008'); // Bring the Pain, feed row 2
    expect(byYear.get(2010)?.topSeed.franchiseId).toBe('0015'); // Dark Magicians, feed row 2
  });

  /**
   * All-play must be cut at the regular season. MFL's published all_play_pct
   * spans the playoff weeks, and on the full-season figure 2018's leader is
   * still the Wabbits but 2016's flips — pinning a season where the champion
   * did NOT lead all-play keeps the cut honest.
   */
  it('cuts all-play at the last regular-season week', () => {
    const byYear = new Map(data.seasons.map((s) => [s.year, s]));
    expect(byYear.get(2018)?.lastRegularSeasonWeek).toBe(13);
    expect(byYear.get(2024)?.lastRegularSeasonWeek).toBe(14);
    for (const s of data.seasons) {
      expect(s.lastRegularSeasonWeek, `${s.year} cutoff`).toBeGreaterThan(0);
      expect(s.allPlayLeader.allPlayPct).toBeGreaterThan(0);
      expect(s.allPlayLeader.allPlayPct).toBeLessThanOrEqual(1);
    }
  });

  it('names a real franchise in every slot', () => {
    for (const s of data.seasons) {
      for (const [slot, team] of Object.entries({
        topSeed: s.topSeed,
        champion: s.champion,
        runnerUp: s.runnerUp,
        allPlayLeader: s.allPlayLeader,
      })) {
        expect(team.franchiseId, `${s.year} ${slot} id`).toMatch(/^\d{4}$/);
        expect(team.name?.trim(), `${s.year} ${slot} name`).toBeTruthy();
        expect(team.name, `${s.year} ${slot} name is not an id`).not.toBe(team.franchiseId);
        // MFL stores franchise 0016 as " Running Down The Dream", leading
        // space and all — untrimmed it renders as a misaligned table cell.
        expect(team.name, `${s.year} ${slot} name is trimmed`).toBe(team.name.trim());
      }
    }
  });
});
