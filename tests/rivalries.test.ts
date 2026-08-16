import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeRivalEntries,
  canonicalRivalryPair,
  parseRivalryPair,
  currentOwnerMeetings,
  tallyMeetings,
  formatRivalryRecord,
  MIN_RIVALRY_MEETINGS,
  formatSeasonRanges,
  describeCoverageGap,
  incompleteCoverageSeasons,
  type Matchup,
} from '../src/utils/rivalries';

const ROOT = path.resolve(__dirname, '..');

const meeting = (score: number, opponentScore: number, extra: Partial<Matchup> = {}): Matchup => ({
  year: 2020,
  week: 1,
  score,
  opponentScore,
  bothAttributed: true,
  ...extra,
});

describe('rivalry scoring', () => {
  it('excludes meetings played under a former owner', () => {
    const history = {
      '0002': [
        meeting(100, 90),
        meeting(80, 120),
        meeting(110, 95, { bothAttributed: false }),
      ],
    };
    expect(currentOwnerMeetings(history, '0002')).toHaveLength(2);
  });

  it('drops pairings under the meetings floor', () => {
    const history = {
      '0002': Array.from({ length: MIN_RIVALRY_MEETINGS - 1 }, () => meeting(100, 90)),
    };
    expect(computeRivalEntries(history, '0001')).toHaveLength(0);
  });

  it('ranks an even series above a lopsided one with the same volume', () => {
    const even = Array.from({ length: 10 }, (_, i) => meeting(i < 5 ? 100 : 80, i < 5 ? 90 : 120));
    const sweep = Array.from({ length: 10 }, () => meeting(100, 80));
    const entries = computeRivalEntries({ '0002': even, '0003': sweep }, '0001');
    expect(entries.map((e) => e.opponentId)).toEqual(['0002', '0003']);
    expect(entries[0].wins).toBe(5);
    expect(entries[1].wins).toBe(10);
  });

  it('weights playoff meetings above regular-season ones', () => {
    const base = Array.from({ length: 6 }, (_, i) => meeting(i < 3 ? 100 : 80, i < 3 ? 90 : 120));
    const withPlayoffs = base.map((m, i) => (i < 2 ? { ...m, isPlayoff: true } : m));
    const [plain] = computeRivalEntries({ '0002': base }, '0001');
    const [charged] = computeRivalEntries({ '0002': withPlayoffs }, '0001');
    expect(charged.playoffGames).toBe(2);
    expect(charged.intensity).toBeGreaterThan(plain.intensity);
  });

  it('skips self-matchups left by ownerHistory cross-attribution', () => {
    const history = { '0001': Array.from({ length: 8 }, () => meeting(100, 90)) };
    expect(computeRivalEntries(history, '0001')).toHaveLength(0);
  });

  it('counts ties as neither win nor loss', () => {
    const { wins, losses, ties } = tallyMeetings([meeting(100, 100), meeting(110, 90)]);
    expect([wins, losses, ties]).toEqual([1, 0, 1]);
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

// The formula moved out of theleague/franchises/[id].astro. Re-deriving
// TheLeague's top-5 here proves the extraction did not change the ranking any
// owner already sees on that page.
describe('parity with the inline implementation it replaced', () => {
  const historyPath = path.join(ROOT, 'data/theleague/derived/franchise-history.json');

  it('reproduces the previous ranking for every TheLeague franchise', () => {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    const inlineRanking = (fr: any, id: string) => {
      const entries: any[] = [];
      const matchupHistory: Record<string, any[]> = fr.matchupHistory || {};
      for (const oppId of Object.keys(matchupHistory)) {
        if (oppId === id) continue;
        const meetings = (matchupHistory[oppId] || []).filter((m) => m.bothAttributed);
        if (meetings.length < 4) continue;
        let wins = 0, losses = 0, ties = 0, playoffGames = 0;
        for (const m of meetings) {
          if (m.score > m.opponentScore) wins++;
          else if (m.score < m.opponentScore) losses++;
          else ties++;
          if (m.isPlayoff) playoffGames++;
        }
        const totalDecided = wins + losses + ties;
        const closeness = totalDecided > 0 ? 1 - Math.abs(wins - losses) / totalDecided : 0;
        entries.push({
          opponentId: oppId,
          wins, losses, ties,
          games: meetings.length,
          playoffGames,
          intensity: closeness * Math.log2(1 + meetings.length + playoffGames * 3),
        });
      }
      entries.sort((a, b) => b.intensity - a.intensity);
      return entries;
    };

    const ids = Object.keys(history.franchises);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const fr = history.franchises[id];
      expect(computeRivalEntries(fr.matchupHistory, id)).toEqual(inlineRanking(fr, id));
    }
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
    ])!;
    expect(note).toContain(', and 2012 is missing its opening weeks');
    expect(note).not.toContain(', and 2007');
  });
});
