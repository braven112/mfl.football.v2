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
