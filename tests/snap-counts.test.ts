/**
 * The Free Agents page's GP / Snaps / Snap% columns.
 *
 * All four rules below are bugs that shipped together, and they were visible
 * on one screenshot from week 2 of the 2026 season: Kareem Hunt at 529 snaps
 * and 47.1%, next to an EMPTY GP, for a season that was two games old.
 *
 *   1. The season shown was picked by filename sort — "newest file wins" —
 *      and nothing scheduled the fetch, so the newest file on disk was the
 *      2025 season captured in February 2026.
 *   2. Snap% averaged the per-game percentages, weighting a 45-play game the
 *      same as an 80-play one.
 *   3. The aggregation key carried the TEAM, so a midseason trade split a
 *      player in two — and both halves resolved to the same MFL id, so the
 *      second write silently replaced the first. Jakobi Meyers shipped as 463
 *      of his 872 snaps.
 *   4. GP rendered inside the snap-count group but was fed from the FANTASY
 *      weekly results of a different season, which is why it was a dash.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { aggregateSnapCounts, matchToMflPlayers } from '../scripts/lib/snap-counts.mjs';
import { snapCountSeason, pickSnapCountSeason } from '../src/utils/snap-count-season.mjs';
import { nflWeekOneKickoff } from '../src/utils/pecking-order-season-window.mjs';

/**
 * BOTH free-agent pages carry these columns and they are forked siblings, so
 * every page assertion below runs over each of them. A rule that only one copy
 * obeys is the bug class this repo calls sibling drift.
 */
const PLAYER_PAGES = [
  path.join('src', 'pages', 'theleague', 'players.astro'),
  path.join('src', 'pages', 'afl-fantasy', 'players.astro'),
];
const pageSources = new Map(PLAYER_PAGES.map((p) => [p, fs.readFileSync(p, 'utf8')]));

/** One NFLverse row. `offense_pct` is a fraction (0-1), as NFLverse ships it. */
const row = (over: Record<string, unknown>) => ({
  game_type: 'REG',
  season: '2026',
  week: '1',
  player: 'Test Player',
  pfr_player_id: 'TestP00',
  position: 'RB',
  team: 'KC',
  offense_snaps: '0',
  offense_pct: '0',
  ...over,
}) as Record<string, string>;

describe('snap count season selection', () => {
  // TheLeague's 2026 season opened WEDNESDAY Sep 9 — the "Thursday after
  // Labor Day" derivation is wrong for it, which is why this reads kickoff
  // from nfl-week-starts rather than counting days from Labor Day.
  const kickoff2026 = nflWeekOneKickoff(2026);

  it('shows the last completed season right up to kickoff', () => {
    const justBefore = new Date(kickoff2026.getTime() - 60_000);
    expect(snapCountSeason(justBefore)).toBe(2025);
  });

  it('switches to the new season the moment it kicks off', () => {
    expect(snapCountSeason(kickoff2026)).toBe(2026);
    expect(snapCountSeason(new Date(kickoff2026.getTime() + 60_000))).toBe(2026);
  });

  it('stays on the season being played all the way through January', () => {
    expect(snapCountSeason(new Date('2027-01-20T12:00:00Z'))).toBe(2026);
  });

  it('holds last season through the whole offseason, Labor Day included', () => {
    expect(snapCountSeason(new Date('2026-03-01T12:00:00Z'))).toBe(2025);
    // The Labor Day → kickoff gap: the season year has rolled but no game has
    // been played, and week 1 snaps do not exist yet.
    expect(snapCountSeason(new Date('2026-09-08T12:00:00Z'))).toBe(2025);
  });

  it('reads the year off the Pacific clock, not UTC', () => {
    // 2027-01-01T02:00Z is still Dec 31 2026 in PT. Under a UTC year this
    // resolves a season later, and since neither has kicked off in winter the
    // two answers are a whole season apart.
    expect(snapCountSeason(new Date('2027-01-01T02:00:00Z'))).toBe(2026);
  });

  it('falls back to the newest season we hold, never forward', () => {
    const inSeason = new Date(kickoff2026.getTime() + 86_400_000);
    // The real gap: kickoff has passed but the first Tuesday fetch has not run.
    expect(pickSnapCountSeason([2024, 2025], inSeason)).toBe(2025);
    expect(pickSnapCountSeason([2024, 2025, 2026], inSeason)).toBe(2026);
    // A season we somehow hold from the future is never promoted.
    expect(pickSnapCountSeason([2025, 2027], inSeason)).toBe(2025);
    expect(pickSnapCountSeason([], inSeason)).toBe(null);
  });
});

describe('snap count aggregation', () => {
  it('keeps a traded player whole instead of splitting him by team', () => {
    const rows = [
      row({ week: '1', team: 'LV', offense_snaps: '50', offense_pct: '0.8' }),
      row({ week: '2', team: 'LV', offense_snaps: '50', offense_pct: '0.8' }),
      row({ week: '3', team: 'JAX', offense_snaps: '60', offense_pct: '0.8' }),
    ];
    const [player] = aggregateSnapCounts(rows);
    expect(player.offenseSnaps).toBe(160);
    expect(player.gamesPlayed).toBe(3);
    // Team follows his LATEST game, which is what the MFL match tiebreaks on.
    expect(player.team).toBe('JAX');
  });

  it('never lets one player produce two rows that overwrite each other', () => {
    const rows = [
      row({ week: '1', team: 'LV', offense_snaps: '50', offense_pct: '0.8' }),
      row({ week: '3', team: 'JAX', offense_snaps: '60', offense_pct: '0.8' }),
    ];
    const mfl = [{ id: '1234', name: 'Player, Test', position: 'RB', team: 'JAC' }];
    const { matched } = matchToMflPlayers(aggregateSnapCounts(rows), mfl);
    expect(matched['1234'].offenseSnaps).toBe(110);
  });

  it('weights the percentage by team plays, not by game', () => {
    // 45 plays at 100% and 90 plays at 50% is 90 of 135 = 66.7%, not the
    // 75% an average of the two percentages reports.
    const rows = [
      row({ week: '1', offense_snaps: '45', offense_pct: '1.0' }),
      row({ week: '2', offense_snaps: '45', offense_pct: '0.5' }),
    ];
    const [player] = aggregateSnapCounts(rows);
    expect(player.offensePct).toBeCloseTo(66.7, 1);
  });

  it('counts only games he actually took a snap in', () => {
    const rows = [
      row({ week: '1', offense_snaps: '40', offense_pct: '0.6' }),
      // Active, special teams only: no offensive snaps, no snap share.
      row({ week: '2', offense_snaps: '0', offense_pct: '0', st_snaps: '12' }),
    ];
    const [player] = aggregateSnapCounts(rows);
    expect(player.gamesPlayed).toBe(1);
    expect(player.offensePct).toBeCloseTo(60, 1);
  });

  it('excludes preseason and playoff snaps', () => {
    const rows = [
      row({ week: '1', game_type: 'PRE', offense_snaps: '30', offense_pct: '0.5' }),
      row({ week: '1', offense_snaps: '40', offense_pct: '0.5' }),
      row({ week: '19', game_type: 'WC', offense_snaps: '70', offense_pct: '0.9' }),
    ];
    const [player] = aggregateSnapCounts(rows);
    expect(player.offenseSnaps).toBe(40);
  });

  it('lets a row with snaps but no percentage count toward the total only', () => {
    const rows = [
      row({ week: '1', offense_snaps: '40', offense_pct: '0.5' }),
      row({ week: '2', offense_snaps: '20', offense_pct: '0' }),
    ];
    const [player] = aggregateSnapCounts(rows);
    expect(player.offenseSnaps).toBe(60);
    // 40 of 80 implied plays — the denominator-less row cannot skew the ratio.
    expect(player.offensePct).toBeCloseTo(50, 1);
  });
});

describe.each(PLAYER_PAGES)('%s', (page) => {
  const pageSource = pageSources.get(page)!;

  it('resolves its snap season through the one shared rule', () => {
    // Not a second copy of the pick, and not "newest filename wins" — which
    // is the line that shipped the bug.
    expect(pageSource).toContain('resolveSnapCounts');
    expect(pageSource).not.toMatch(/snapCountModules\)\s*\.sort\(\)\s*\.reverse\(\)/);
  });

  it('reads the league-neutral snap file, not one league\'s copy', () => {
    expect(pageSource).toContain("data/nfl/snap-counts-*.json");
    expect(pageSource).not.toContain('nfl-cache/snap-counts');
  });

  it('keeps GP on the snap data beside it, not another season', () => {
    // TheLeague fed this from lastYrGamesMap (fantasy scoring, a different
    // season, empty in week 2) and rendered a dash next to 529 snaps. The
    // AFL's rows carry a `games` of their own that means something else
    // again, which is why the field is named for what it is.
    expect(pageSource).toMatch(/data-sort="snapGames"/);
    expect(pageSource).not.toMatch(/data-sort="games"/);
    expect(pageSource).not.toMatch(/games:\s*lastYrGamesMap\.get\(p\.id\)/);
  });

  it('stamps the season on every snap column', () => {
    const headers = pageSource.match(/data-sort="(snapGames|snaps|snapPct)"[\s\S]*?<\/th>/g) ?? [];
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      expect(header).toContain('snapSeasonLabel');
      expect(header).toContain('snapScopeTitle');
    }
  });

  it('gates the header and the cell on the same flag, so columns cannot misalign', () => {
    // A <th> the client's row builder has no matching <td> for shifts every
    // column after it by one.
    const headerGates = (pageSource.match(/\{hasSnapCounts && \(/g) ?? []).length;
    expect(headerGates).toBe(3);
    expect(pageSource).toMatch(/if \(hasSnapCounts\) \{/);
    // The row builder runs in the browser and can only see what define:vars
    // hands it.
    expect(pageSource).toMatch(/define:vars=\{\{[^}]*hasSnapCounts/);
  });

  it('ships the shared header stylesheet rather than a scoped copy', () => {
    expect(pageSource).toContain("styles/snap-columns.css");
  });
});

describe('the committed snap-count data', () => {
  const dir = path.join('data', 'nfl');
  const files = fs.readdirSync(dir).filter((f) => /^snap-counts-\d{4}\.json$/.test(f));

  it('holds a file for the season the page will ask for', () => {
    const seasons = files.map((f) => Number(f.match(/(\d{4})/)![1]));
    expect(pickSnapCountSeason(seasons, new Date())).not.toBe(null);
  });

  it.each(files)('%s declares its season and weeks, and no impossible share', (file) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(data.season).toBe(Number(file.match(/(\d{4})/)![1]));
    expect(data.weeksCovered).toBeGreaterThan(0);
    for (const [id, stats] of Object.entries(data.players) as [string, any][]) {
      expect(stats.offensePct, `${file} ${id}`).toBeLessThanOrEqual(100);
      expect(stats.gamesPlayed, `${file} ${id}`).toBeLessThanOrEqual(data.weeksCovered);
    }
  });
});
