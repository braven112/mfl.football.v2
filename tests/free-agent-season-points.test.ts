import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveStatsSeasonYear, parseYtdPlayerScores } from '../src/utils/stats-season.mjs';
import { kickedOffSeason, snapCountSeason } from '../src/utils/snap-count-season.mjs';

/**
 * The Free Agents points column, pinned.
 *
 * Two bugs shipped together here and both are invisible to a page that still
 * renders: the column picked its season on the LABOR DAY clock (so it emptied
 * for the week between Labor Day and kickoff), and it summed
 * weekly-results-raw, which cannot see an unrostered player at all and
 * double-counts the ones it can (a franchise appears in two matchups in a
 * doubleheader week — every one of TheLeague's 260 scored 2026 players came
 * out at exactly 2x). See src/utils/stats-season.mjs.
 */

/**
 * Every page carrying a season-points column. Projected Free Agents is in the
 * list because it had the doubling too: Isaiah Likely's 27.8 rendered there as
 * 55.6 until the source moved to YTD.
 */
const POINTS_COLUMN_PAGES = [
  'src/pages/theleague/players.astro',
  'src/components/afl-family/PlayersPage.astro',
  'src/pages/theleague/front-office/projected-free-agents.astro',
];

describe('stats season resolves on the league start day, not Labor Day', () => {
  // 2026 is the season that makes the distinction visible: Labor Day was
  // Sep 7 and the NFL opened on WEDNESDAY Sep 9, so the two clocks disagree
  // for two days. Dates are noon PT to stay clear of the UTC boundary.
  const at = (iso: string) => new Date(`${iso}T12:00:00-07:00`);

  it('holds last season right through the Labor Day → kickoff gap', () => {
    // getCurrentSeasonYear() has already rolled to 2026 on both these days.
    // The points column must not follow it until there are games.
    expect(resolveStatsSeasonYear(at('2026-09-07'))).toBe(2025);
    expect(resolveStatsSeasonYear(at('2026-09-08'))).toBe(2025);
  });

  it('switches to the current season once week 1 has kicked off', () => {
    expect(resolveStatsSeasonYear(at('2026-09-10'))).toBe(2026);
    expect(resolveStatsSeasonYear(at('2026-12-01'))).toBe(2026);
  });

  it('keeps the just-finished season through the offseason', () => {
    // Feb → Labor Day. Naming the season before this one would show a
    // two-year-old total.
    expect(resolveStatsSeasonYear(at('2026-06-15'))).toBe(2025);
    expect(resolveStatsSeasonYear(at('2027-03-01'))).toBe(2026);
  });

  it('is the SAME function the snap-count columns use, not a copy', () => {
    // GP / Snaps / Snap% and Pts sit next to each other on both Free Agents
    // pages. Two implementations of one season boundary is how they end up
    // naming different years, so this is identity, not equality.
    expect(resolveStatsSeasonYear).toBe(kickedOffSeason);
    expect(snapCountSeason).toBe(kickedOffSeason);
  });
});

describe('YTD payload parsing', () => {
  it('reads real scores, keeps negatives AND zeroes, drops blank rows', () => {
    const map = parseYtdPlayerScores({
      playerScores: {
        week: 'YTD',
        playerScore: [
          { id: '13589', score: '414.62', week: 'YTD' },
          // A defense can finish a season under zero — a real total, not a
          // missing one.
          { id: '0507', score: '-4.40', week: 'YTD' },
          { id: '15929', score: '0.00', week: 'YTD' },
          { id: '', score: '', week: 'YTD' },
        ],
      },
    });
    expect(map.get('13589')).toBe(414.62);
    expect(map.get('0507')).toBe(-4.4);
    // 0.00 is a total we KNOW, not a total we are missing. Rendering it as a
    // dash would claim no data on a player MFL just reported on, and would be
    // impossible to square with keeping the negative above.
    expect(map.get('15929')).toBe(0);
    expect(map.has('')).toBe(false);
  });

  it('treats MFL\'s blank single-row placeholder as no data', () => {
    // This is what a season answers with before its first game, and it is
    // what sat committed in both leagues' 2026 feed. A caller that reads it
    // as "the feed has data" ships an empty column.
    const map = parseYtdPlayerScores({
      playerScores: { week: 'YTD', playerScore: { id: '', score: '', week: 'YTD' } },
    });
    expect(map.size).toBe(0);
  });

  it('survives a missing or malformed payload', () => {
    expect(parseYtdPlayerScores(null).size).toBe(0);
    expect(parseYtdPlayerScores({}).size).toBe(0);
  });
});

describe('both Free Agents pages read the full-pool feed', () => {
  for (const page of POINTS_COLUMN_PAGES) {
    it(`${page} names its points season and sources it from YTD`, () => {
      const src = readFileSync(page, 'utf8');
      // The column header carries the year, so a reader never has to guess
      // whether a total is this season's or last one's.
      expect(src).toMatch(/\{statsSeasonYear\} Pts/);
      expect(src).toContain('seasonPts');
      // "Last Yr" was the label on the broken column; its return means the
      // season gate came back out.
      expect(src).not.toContain('Last Yr');
    });
  }

  it('every server-rendered points column goes through the shared resolver', () => {
    // The AFL page reads a build-time snapshot, so its resolver call lives in
    // the builder script rather than the page.
    const sources = [
      'src/pages/theleague/players.astro',
      'src/pages/theleague/front-office/projected-free-agents.astro',
      'scripts/compute-afl-free-agents.mjs',
    ];
    for (const file of sources) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain('parseYtdPlayerScores');
      expect(src, file).toContain('resolveStatsSeasonYear');
      // The Labor Day clock must not be what names the season here. All three
      // of these pages shipped with `getCurrentSeasonYear()` assigned straight
      // to the season variable, and it reads identically at a glance.
      expect(src, file).not.toMatch(/=\s*getCurrentSeasonYear\(/);
    }
  });

  it('no points column falls back to a weekly-results sum', () => {
    // The weekly sum is kept for the rostered-weeks games/PPG pair, where its
    // doubleheader double appears top and bottom and cancels out. Feeding it
    // into the points column does not — that is the bug that put 55.6 on
    // screen for a 27.8 season.
    const files = [...POINTS_COLUMN_PAGES, 'scripts/compute-afl-free-agents.mjs'];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/ytdPtsMap\.get\([^)]*\)\s*\?\?\s*weeklyPtsMap/);
      // …and the points value itself never reads the weekly map.
      expect(src, file).not.toMatch(/seasonPts[^;\n]*weeklyPtsMap/);
    }
  });

  it('the fetch guard refuses a payload with no scored rows', () => {
    const src = readFileSync('scripts/fetch-mfl-feeds.mjs', 'utf8');
    expect(src).toContain("key: 'playerScores-ytd'");
    expect(src).toContain('W=YTD');
    // A row COUNT accepts MFL's single blank placeholder, which is exactly
    // how an empty feed got committed over both leagues.
    expect(src).toMatch(/parseFloat\(r\.score\)\s*>\s*0/);
  });
});
