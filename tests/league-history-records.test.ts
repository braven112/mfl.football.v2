import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHistoryDataset as buildDataset, holdingsBySeason } from '../src/utils/league-history/dataset.mjs';
import {
  buildCategory as buildBoards,
  eraDataset,
  historyEras,
  indexDataset,
  recordBook,
  recordWatch as watchBoards,
} from '../src/utils/league-history/records.mjs';

interface Row { value: number; rank: number; entity: { key: string; name: string } }
interface Board { id: string; rows: Row[] }
interface Dataset {
  games: unknown[][];
  seasons: Array<{ y: number; done: number; teams: Record<string, { h: string; r: string }> }>;
}
// The engine is plain .mjs; these are the shapes the tests read.
const buildHistoryDataset = buildDataset as unknown as (args: object) => Dataset;
const buildCategory = buildBoards as unknown as (ix: unknown, category: string, scope?: string) => Board[];
interface Watch { name: string; projected: number; rank: number; played: number; full: number }
const recordWatch = watchBoards as unknown as (ix: unknown, boards: Board[]) => Record<string, Watch[]>;

/**
 * League History engine — the owner attribution the Record Book groups by, and
 * the board definitions that are easy to get wrong (doubleheaders, what counts
 * as a postseason game, shared ranks, minimum games).
 */

const tenures = {
  owners: [
    { ownerId: 'own-a', displayName: 'Ann', slug: 'ann', tenures: [{ franchiseId: '0001', seasons: [{ year: 2020 }, { year: 2021 }] }] },
    // Bea moves from slot 0002 to slot 0003 and keeps one career.
    { ownerId: 'own-b', displayName: 'Bea', slug: 'bea', tenures: [
      { franchiseId: '0002', seasons: [{ year: 2020 }] },
      { franchiseId: '0003', seasons: [{ year: 2021 }] },
    ] },
    // Co-owners share slot 0002 in 2021.
    { ownerId: 'own-c', displayName: 'Cy', slug: 'cy', tenures: [{ franchiseId: '0002', seasons: [{ year: 2021 }] }] },
    { ownerId: 'own-d', displayName: 'Di', slug: 'di', tenures: [{ franchiseId: '0002', seasons: [{ year: 2021 }] }] },
  ],
};

const row = (year: number, franchiseId: string, extra: Record<string, unknown> = {}) => ({
  year, franchiseId, name: `Team ${franchiseId}`, wins: 1, losses: 1, ties: 0, pointsFor: 200,
  divisionName: 'East', playoffResult: 'missed', ...extra,
});

const ledgerRows = [
  row(2020, '0001', { playoffResult: 'champion' }),
  row(2020, '0002', { playoffResult: 'runner-up' }),
  row(2020, '0003'),
  row(2021, '0001', { playoffResult: 'champion' }),
  row(2021, '0002'),
  row(2021, '0003', { playoffResult: 'runner-up' }),
];

const g = (year: number, week: number, winnerId: string, winnerScore: number, loserId: string, loserScore: number, isPlayoff = false) =>
  ({ year, week, winnerId, winnerScore, loserId, loserScore, isPlayoff });

const games = [
  // 2020 week 1 is a doubleheader: 0001's one weekly score counts in two games.
  g(2020, 1, '0001', 150, '0002', 100),
  g(2020, 1, '0001', 150, '0003', 90),
  g(2020, 2, '0002', 120, '0003', 110),
  g(2020, 3, '0001', 130, '0002', 125, true), // final: both made the playoffs
  g(2020, 3, '0003', 140, '0002', 60, true), // consolation: 0003 missed
  g(2021, 1, '0003', 99, '0002', 99), // tie
  g(2021, 2, '0001', 101, '0003', 100, true),
];

const ds = buildHistoryDataset({ league: 'test', games, ledgerRows, ownerTenures: tenures, firstPlayoffWeeks: { 2020: 3, 2021: 2 } });

describe('League History dataset', () => {
  it('credits each season to its holding, co-owners as one sorted set', () => {
    const h = holdingsBySeason(tenures);
    expect(h.get('0002|2020')).toBe('own-b');
    expect(h.get('0003|2021')).toBe('own-b');
    expect(h.get('0002|2021')).toBe('own-c+own-d');
  });

  it('falls back to the franchise slot when no owner is on record', () => {
    const d = buildHistoryDataset({ league: 't', games: [], ledgerRows: [row(2019, '0009')], ownerTenures: { owners: [] } });
    expect(d.seasons[0]!.teams['0009']!.h).toBe('slot:0009');
  });

  it('packs games as sorted tuples and marks a season done once it has a champion', () => {
    expect(ds.games[0]).toEqual([2020, 1, '0001', 150, '0002', 100, 0]);
    expect(ds.games).toHaveLength(games.length);
    expect(ds.seasons.map((s) => s.done)).toEqual([1, 1]);
    expect(ds.seasons[0]!.teams['0001']!.r).toBe('C');
  });
});

describe('Record Book boards', () => {
  const ix = indexDataset(ds);
  const board = (cat: string, id: string, scope = 'all') =>
    buildCategory(ix, cat, scope).find((b) => b.id === id)!;

  it('counts a doubleheader score once on a score board', () => {
    const rows = board('single-game', 'most-points').rows;
    expect(rows.filter((r) => r.value === 150)).toHaveLength(1);
  });

  it('keeps consolation games out of postseason and career totals', () => {
    const playoffs = board('career', 'career-wins', 'playoffs').rows;
    const holders = Object.fromEntries(playoffs.map((r) => [r.entity.key, r.value]));
    // 0003's 140-60 consolation win is not a playoff win.
    expect(holders['slot:0003']).toBeUndefined();
    expect(holders['own-a']).toBe(2);
    // ...but it is still a single-game score under "All games".
    expect(board('single-game', 'biggest-win').rows[0]!.value).toBe(80);
  });

  it('follows an owner across slots and gives tied values a shared rank', () => {
    const wins = board('career', 'career-wins', 'regular').rows;
    const bea = wins.find((r) => r.entity.key === 'own-b');
    // Bea: 2020 week 2 win as 0002; the 2021 tie as 0003 is not a win.
    expect(bea!.value).toBe(1);
    expect(bea!.entity.name).toBe('Bea');
    const coOwned = wins.find((r) => r.entity.key === 'own-c+own-d');
    expect(coOwned?.entity.name).toBe('Cy & Di');
    const ranks = board('postseason', 'titles').rows.map((r) => r.rank);
    expect(ranks).toEqual([1]);
  });

  it('holds back rate boards until the minimum games', () => {
    expect(board('career', 'career-pct', 'regular').rows).toHaveLength(0);
  });

  it('caches boards per dataset', () => {
    const book = recordBook(ds);
    expect(recordBook(ds)).toBe(book);
    expect(book.category('season')).toBe(book.category('season'));
  });
});

describe('Record Book eras and record watch', () => {
  it('offers the last ten seasons once a league has more than ten', () => {
    const long = { firstSeason: 2010, lastSeason: 2026, seasons: [], games: [] };
    expect(historyEras(long).map((e: { id: string; from: number | null }) => [e.id, e.from])).toEqual([['all', null], ['last10', 2017]]);
    expect(historyEras({ ...long, firstSeason: 2020 })).toHaveLength(1);
  });

  it('cuts an era to its seasons and games', () => {
    const cut = eraDataset(ds, 2021) as unknown as Dataset;
    expect(cut.seasons.map((s) => s.y)).toEqual([2021]);
    expect(cut.games.every((g) => g[0] === 2021)).toBe(true);
    expect(eraDataset(ds, null)).toBe(ds);
  });

  it('projects points by weeks and wins by games, and only past a quarter of the season', () => {
    // 2020 is the finished season: four teams play 4 games over 3 weeks
    // (week 1 a doubleheader). 2021 is live: 0001 has played 2 games in 1 week.
    const tg = (y: number, wk: number, w: string, l: string) => g(y, wk, w, 100, l, 90);
    const games2 = [
      tg(2020, 1, '0001', '0002'), tg(2020, 1, '0003', '0004'), tg(2020, 1, '0001', '0003'), tg(2020, 1, '0002', '0004'),
      tg(2020, 2, '0001', '0004'), tg(2020, 2, '0002', '0003'), tg(2020, 3, '0001', '0002'), tg(2020, 3, '0003', '0004'),
      tg(2021, 1, '0001', '0002'), tg(2021, 1, '0001', '0003'),
    ];
    const r = (y: number, f: string, w: number, l: number, pf: number, res = 'missed') =>
      row(y, f, { wins: w, losses: l, pointsFor: pf, playoffResult: res });
    const ledger = [
      r(2020, '0001', 4, 0, 300, 'champion'), r(2020, '0002', 2, 2, 290), r(2020, '0003', 2, 2, 280), r(2020, '0004', 0, 4, 270),
      r(2021, '0001', 2, 0, 200), r(2021, '0002', 0, 1, 90), r(2021, '0003', 0, 1, 90), r(2021, '0004', 0, 0, 0),
    ];
    const d = buildHistoryDataset({ league: 't', games: games2, ledgerRows: ledger, ownerTenures: { owners: [] }, firstPlayoffWeeks: {} });
    const ix = indexDataset(d);
    const w = recordWatch(ix, buildCategory(ix, 'season'));
    // 200 points in 1 of 3 weeks → 600, over the record 300; 2 wins in 2 of 4 games → 4, tying it.
    expect(w['most-points-season']![0]).toMatchObject({ name: 'Team 0001', projected: 600, rank: 1 });
    expect(w['most-wins']![0]).toMatchObject({ name: 'Team 0001', projected: 4, rank: 1, played: 2, full: 4 });
    // One game of four is not a quarter-season pace worth showing… (exactly 1/4 is).
    expect(w['most-points-season']!.map((x) => x.name)).not.toContain('Team 0004');
  });
});

describe('League History data files', () => {
  it.each(['theleague', 'afl-fantasy'])('%s: every game names two teams of its own season', (slug) => {
    const file = JSON.parse(readFileSync(join(__dirname, '..', 'data', slug, 'derived', 'league-history.json'), 'utf8'));
    expect(file.league).toBe(slug);
    const teams = new Map(file.seasons.map((s: { y: number; teams: object }) => [s.y, s.teams]));
    for (const [y, , wf, ws, lf, ls] of file.games) {
      const t = teams.get(y) as Record<string, unknown>;
      expect(t?.[wf], `${y} ${wf}`).toBeTruthy();
      expect(t?.[lf], `${y} ${lf}`).toBeTruthy();
      expect(ws).toBeGreaterThanOrEqual(ls);
    }
    for (const s of file.seasons) {
      for (const t of Object.values(s.teams) as Array<{ h: string }>) {
        for (const id of t.h.split('+')) {
          if (!id.startsWith('slot:')) expect(file.owners[id], `${s.y} ${id}`).toBeTruthy();
        }
      }
    }
  });
});
