import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordBook } from '../src/utils/league-history/records.mjs';
import {
  headToHeadMeetings,
  rivalEntries,
  rivalryHistory,
  rivalryPairs,
  rivalrySeries,
} from '../src/utils/league-history/rivalry.mjs';
import { describeSeries } from '../src/utils/rivalry-intensity.mjs';
import { seriesSnapshot } from '../src/utils/matchup-preview-visuals.mjs';
import { meetingsBetween } from '../src/utils/front-page';

/**
 * The site's one head-to-head definition (league-history/rivalry.mjs): a
 * pairing's record is the games its two CURRENT owners played each other, from
 * whichever slots they held, regular season and playoffs, consolation games
 * left out. Every surface that prints a series reads it, so the behaviour is
 * pinned once here and the real data is checked for agreement between the
 * file's own three views of it (the per-pair tally, the game list, and the
 * rivalry page). tests/head-to-head-source-guard.test.ts keeps every caller on it.
 */

const team = (h: string, r = 'P') => ({ n: h.toUpperCase(), i: null, h, w: 0, l: 0, t: 0, pf: 0, r });

/**
 * o1 holds 0001 throughout. 0002 was o9's in 2024 and o2's since. o3 held 0003
 * in 2024 and moved to 0004, and o4 took over 0003.
 */
const ds = {
  league: 'test',
  owners: { o1: { name: 'One' }, o2: { name: 'Two' }, o3: { name: 'Three' }, o4: { name: 'Four' }, o9: { name: 'Nine' } },
  seasons: [
    { y: 2024, done: 1, pw: 15, teams: { '0001': team('o1'), '0002': team('o9'), '0003': team('o3') } },
    { y: 2025, done: 1, pw: 15, teams: { '0001': team('o1'), '0002': team('o2'), '0004': team('o3', 'M') } },
    { y: 2026, done: 0, pw: 15, teams: { '0001': team('o1'), '0002': team('o2'), '0003': team('o4'), '0004': team('o3') } },
  ],
  // [year, week, winner, winnerScore, loser, loserScore, playoffWeek]
  games: [
    [2024, 1, '0001', 100, '0002', 90, 0], // against 0002's former owner: not counted
    [2024, 2, '0003', 110, '0001', 95, 0], // o3 from 0003: counts for 0001-0004
    [2025, 1, '0001', 120, '0002', 100, 0],
    [2025, 2, '0002', 101, '0001', 99, 0],
    [2025, 3, '0001', 130, '0004', 80, 0],
    [2025, 15, '0001', 140, '0002', 120, 1], // both made the playoffs: a playoff game
    [2025, 16, '0001', 150, '0004', 70, 1], // 0004 missed them: consolation, not counted
    [2026, 1, '0001', 105, '0002', 105, 0], // a tie
  ],
};
const ix = recordBook(ds).ix;

describe('the head-to-head definition', () => {
  it('counts the current owners’ games, regular season and playoffs, ties apart', () => {
    expect(rivalryPairs(ix).get('0001-0002')).toMatchObject({ games: 4, wa: 2, wb: 1, t: 1, playoffs: 1 });
  });

  it('leaves out games against a former owner', () => {
    expect(headToHeadMeetings(ix, '0001', '0002')!.some((m: any) => m.y === 2024)).toBe(false);
  });

  it('follows an owner who moved slots, and leaves consolation games out', () => {
    const games = headToHeadMeetings(ix, '0001', '0004')!;
    expect(games.map((m: any) => [m.y, m.wk])).toEqual([
      [2024, 2],
      [2025, 3],
    ]);
    expect(games[0].franchiseB).toBe('0003');
  });

  it('reads from the side asked for', () => {
    const fromB = headToHeadMeetings(ix, '0002', '0001')!;
    expect(fromB.filter((m: any) => m.winner === 'A')).toHaveLength(1);
    expect(fromB.filter((m: any) => m.winner === 'B')).toHaveLength(2);
  });

  it('ranks rivals over the meetings floor, from the franchise’s side', () => {
    expect(rivalEntries(ix, '0002')).toEqual([
      expect.objectContaining({ opponentId: '0001', wins: 1, losses: 2, ties: 1, games: 4, playoffGames: 1 }),
    ]);
    expect(rivalEntries(ix, '0001', { minMeetings: 0 }).map((r: any) => r.opponentId)).toEqual(
      expect.arrayContaining(['0002', '0004']),
    );
  });

  it('gives describeSeries a record it can attribute, never a disputed one', () => {
    const s = (rivalrySeries(ix) as Record<string, any>)['0001-0002'];
    expect(s).toMatchObject({ perspective: '0001', wins: 2, losses: 1, ties: 1, disputed: false });
    expect(describeSeries(s, '0002', '0001', (id: string) => (id === '0001' ? 'One' : 'Two'))).toBe(
      '4 meetings, One up 2-1-1',
    );
  });

  it('is what the matchup preview and the front page print', () => {
    expect(seriesSnapshot(ix, '0002', '0001')).toMatchObject({ games: 4, aWins: 1, bWins: 2, ties: 1, playoffGames: 1 });
    expect(seriesSnapshot(ix, '0003', '0001')).toBeNull();
    expect(seriesSnapshot(undefined, '0002', '0001')).toBeNull();
    const facts = meetingsBetween(ix, '0001', '0002')!;
    expect(facts.map((m) => [m.year, m.week, m.score, m.opponentScore])).toEqual([
      [2025, 1, 120, 100],
      [2025, 2, 99, 101],
      [2025, 15, 140, 120],
      [2026, 1, 105, 105],
    ]);
  });
});

const tally = (games: any[]) => ({
  games: games.length,
  wa: games.filter((m) => m.winner === 'A').length,
  wb: games.filter((m) => m.winner === 'B').length,
  t: games.filter((m) => !m.winner).length,
  playoffs: games.filter((m) => m.kind === 'playoffs').length,
});

// The pairing tally and the game list are two implementations of one rule (the
// tally is the fast one every page ranks with); on real data they must agree
// pairing for pairing, and with the rivalry page.
describe.each(['theleague', 'afl-fantasy', 'archies'])('%s: one record per pairing', (slug) => {
  const data = JSON.parse(readFileSync(join(__dirname, '..', 'data', slug, 'derived', 'league-history.json'), 'utf8'));
  const real = recordBook(data).ix;
  const pairs = [...rivalryPairs(real).values()] as any[];
  // Archie's has thousands of pairings; every pairing with a real series, and a sample of the rest.
  const checked = slug === 'archies' ? pairs.filter((p, i) => p.games >= 4 || i % 25 === 0) : pairs;

  it('has pairings to check', () => expect(checked.length).toBeGreaterThan(10));

  it('the game list adds up to the tally', () => {
    for (const p of checked) {
      const { games, wa, wb, t, playoffs } = p;
      expect(tally(headToHeadMeetings(real, p.a, p.b)!), `${p.a}-${p.b}`).toEqual({ games, wa, wb, t, playoffs });
    }
  });

  it('the rivalry page shows the same record', () => {
    for (const p of checked.slice(0, 150)) {
      const s = rivalryHistory(real, p.a, p.b)!.series;
      expect([s.games, s.a, s.b, s.t], `${p.a}-${p.b}`).toEqual([p.games, p.wa, p.wb, p.t]);
    }
  });

  it('both sides of a rivalry read the same series', () => {
    for (const p of checked.filter((x) => x.games >= 4).slice(0, 150)) {
      const fromA = rivalEntries(real, p.a).find((r: any) => r.opponentId === p.b)!;
      const fromB = rivalEntries(real, p.b).find((r: any) => r.opponentId === p.a)!;
      expect([fromA.wins, fromA.losses], `${p.a}-${p.b}`).toEqual([fromB.losses, fromB.wins]);
    }
  });
});
