import { describe, it, expect } from 'vitest';
import {
  canonicalRivalryPair,
  parseRivalryPair,
  formatRivalryRecord,
  rivalryIntensity,
  formatSeasonRanges,
  describeCoverageGap,
  incompleteCoverageSeasons,
} from '../src/utils/rivalries';

// Which games count is pinned in tests/head-to-head.test.ts (the one
// definition, league-history/rivalry.mjs); this is the formula that ranks them.
describe('rivalry scoring', () => {
  it('ranks an even series above a lopsided one with the same volume', () => {
    expect(rivalryIntensity(10, 5, 5, 0, 0)).toBeGreaterThan(rivalryIntensity(10, 10, 0, 0, 0));
    expect(rivalryIntensity(10, 10, 0, 0, 0)).toBe(0);
  });

  it('weights playoff meetings above regular-season ones', () => {
    expect(rivalryIntensity(6, 3, 3, 0, 2)).toBeGreaterThan(rivalryIntensity(6, 3, 3, 0, 0));
  });

  it('formats records with ties only when they exist', () => {
    expect(formatRivalryRecord(14, 9, 0)).toBe('14-9');
    expect(formatRivalryRecord(14, 9, 1)).toBe('14-9-1');
  });
});

describe('pairing slugs', () => {
  it('is direction-independent so both franchises share one URL', () => {
    expect(canonicalRivalryPair('0012', '0001')).toBe('0001-vs-0012');
    expect(canonicalRivalryPair('0001', '0012')).toBe(canonicalRivalryPair('0012', '0001'));
  });

  it('round-trips through parseRivalryPair', () => {
    expect(parseRivalryPair(canonicalRivalryPair('0007', '0021'))).toEqual(['0007', '0021']);
  });

  it('rejects malformed and self-referential slugs', () => {
    expect(parseRivalryPair('0001')).toBeNull();
    expect(parseRivalryPair('0001-vs-0001')).toBeNull();
    expect(parseRivalryPair('0001-vs-0002-vs-0003')).toBeNull();
    expect(parseRivalryPair('')).toBeNull();
  });
});

describe('formatSeasonRanges', () => {
  it('collapses contiguous runs and keeps gaps visible', () => {
    // The AFL's real shape: 2003 is empty, 2004-2006 are complete, the hole
    // resumes at 2007. A naive min-max would claim 2004-2006 are damaged too.
    expect(formatSeasonRanges([2003, 2007, 2008, 2009, 2010, 2011, 2012, 2013,
      2014, 2015, 2016, 2017, 2018, 2019])).toBe('2003, 2007–2019');
  });

  it('renders a lone season without a dash', () => {
    expect(formatSeasonRanges([2016])).toBe('2016');
  });

  it('sorts, dedupes and handles an empty list', () => {
    expect(formatSeasonRanges([2009, 2007, 2008, 2008])).toBe('2007–2009');
    expect(formatSeasonRanges([])).toBe('');
  });
});

describe('describeCoverageGap', () => {
  // The real AFL shape, established against MFL in August 2026: 2007-2011 and
  // 2016-2019 kept only weeks 14-17, while 2012-2015 kept 14 of 17.
  const AFL_COVERAGE = [
    ...[2007, 2008, 2009, 2010, 2011].map((year) => ({ year, seasonStarted: true, weeksWithGames: 4, weeksInFeed: 17 })),
    ...[2012, 2013, 2014, 2015].map((year) => ({ year, seasonStarted: true, weeksWithGames: 14, weeksInFeed: 17 })),
    ...[2016, 2017, 2018, 2019].map((year) => ({ year, seasonStarted: true, weeksWithGames: 4, weeksInFeed: 17 })),
    { year: 2020, seasonStarted: true, weeksWithGames: 17, weeksInFeed: 17 },
    { year: 2026, seasonStarted: false, weeksWithGames: 0, weeksInFeed: 18 },
  ];

  it('does not claim postseason-only for seasons that kept 14 of 17 weeks', () => {
    const note = describeCoverageGap(AFL_COVERAGE)!;
    expect(note).toContain('2007–2011, 2016–2019 retain only their postseason weeks');
    expect(note).toContain('2012–2015 are missing their opening weeks');
    // The bug this replaced: one blanket "postseason weeks only" covering all 13.
    expect(note).not.toMatch(/2007–2019 retain only their postseason/);
  });

  it('ignores complete seasons and seasons that have not started', () => {
    const years = incompleteCoverageSeasons(AFL_COVERAGE).map((c) => c.year);
    expect(years).not.toContain(2020);
    expect(years).not.toContain(2026);
  });

  it('returns null when every season is complete', () => {
    expect(describeCoverageGap([{ year: 2020, seasonStarted: true, weeksWithGames: 17, weeksInFeed: 17 }])).toBeNull();
    expect(describeCoverageGap([])).toBeNull();
  });

  // The AFL's live shape since every recoverable season was pulled back from
  // the authenticated schedule view: 2003 alone, and it is not "postseason
  // weeks only" — that season was played on Yahoo and has no game data at all.
  it('says a season with zero games has none, rather than calling it postseason-only', () => {
    const note = describeCoverageGap([
      { year: 2003, seasonStarted: true, weeksWithGames: 0, weeksInFeed: 17 },
      ...[2004, 2005].map((year) => ({ year, seasonStarted: true, weeksWithGames: 17, weeksInFeed: 17 })),
    ])!;
    expect(note).toContain('2003 has no game-by-game results at all');
    expect(note).not.toContain('postseason');
  });

  it('agrees in number when only one season is affected', () => {
    const one = describeCoverageGap([
      { year: 2003, seasonStarted: true, weeksWithGames: 0, weeksInFeed: 17 },
    ])!;
    expect(one).toContain("MFL's archive for this season is incomplete");
    expect(one).not.toMatch(/\bhave\b|\bretain\b|\btheir\b/);

    const many = describeCoverageGap(AFL_COVERAGE)!;
    expect(many).toContain("MFL's archives for these seasons are incomplete");
  });

  it('reads as a list, not a chain of ands, when all three shapes are present', () => {
    const note = describeCoverageGap([
      { year: 2003, seasonStarted: true, weeksWithGames: 0, weeksInFeed: 17 },
      { year: 2007, seasonStarted: true, weeksWithGames: 4, weeksInFeed: 17 },
      { year: 2012, seasonStarted: true, weeksWithGames: 14, weeksInFeed: 17 },
      { year: 2025, seasonStarted: true, weeksWithGames: 17, weeksInFeed: 17 },
    ])!;
    expect(note).toContain(', and 2012 is missing its opening weeks');
    expect(note).not.toContain(', and 2007');
  });

  it('never calls the season being played a gap', () => {
    // Two weeks into 2026, its sixteen unplayed weeks are not missing from
    // MFL's archive — the note used to say 2026 "retains only its postseason
    // weeks" on every franchise page.
    const coverage = [
      { year: 2003, seasonStarted: true, weeksWithGames: 0, weeksInFeed: 17 },
      { year: 2025, seasonStarted: true, weeksWithGames: 17, weeksInFeed: 17 },
      { year: 2026, seasonStarted: true, weeksWithGames: 2, weeksInFeed: 18 },
    ];
    expect(describeCoverageGap(coverage)).not.toContain('2026');
    expect(describeCoverageGap(coverage.slice(1))).toBeNull();
  });
});
