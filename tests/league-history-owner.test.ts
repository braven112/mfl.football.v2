import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHistoryDataset as buildDataset } from '../src/utils/league-history/dataset.mjs';
import { indexDataset } from '../src/utils/league-history/records.mjs';
import { ownerHistory as history, ownerIdForSlug, ownerList } from '../src/utils/league-history/owner.mjs';

/**
 * League History owner pages — one owner's career across every slot they
 * held, co-owned seasons counted for each co-owner, consolation games left
 * out, and head to head grouped by the opponent's holding with the franchise
 * pair of the last meeting (what the rivalry page is keyed by).
 */

interface H2H { key: string; record: string; games: number; last: { y: number; f: string; of: string }; lastPairCurrent: boolean; active: boolean }
interface OwnerHistory {
  name: string;
  active: boolean;
  seasons: Array<{ y: number; franchiseId: string }>;
  regular: { record: string };
  playoffs: { record: string };
  finals: Array<{ y: number }>;
  titles: Array<{ y: number }>;
  teams: Array<{ franchiseId: string; from: number; to: number; coOwners: Array<{ ownerId: string }> }>;
  headToHead: H2H[];
  highs: { game: { s: number; f: string } | null };
}
const ownerHistory = history as unknown as (ix: unknown, ownerId: string) => OwnerHistory | null;

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
  g(2020, 1, '0001', 150, '0002', 100),
  g(2020, 2, '0002', 120, '0003', 110),
  g(2020, 3, '0001', 130, '0002', 125, true), // final: both made the playoffs
  g(2020, 3, '0003', 140, '0002', 60, true), // consolation: 0003 missed
  g(2021, 1, '0003', 99, '0002', 99), // tie
  g(2021, 2, '0001', 101, '0003', 100, true),
];

const ds = buildDataset({ league: 'test', games, ledgerRows, ownerTenures: tenures, firstPlayoffWeeks: { 2020: 3, 2021: 2 } });
const ix = indexDataset(ds);

describe('League History owner history', () => {
  it('finds owners by page slug', () => {
    expect(ownerIdForSlug(ds, 'bea')).toBe('own-b');
    expect(ownerIdForSlug(ds, 'nobody')).toBeNull();
    expect((ownerList(ds) as unknown[]).length).toBe(4);
  });

  it('follows an owner across slots and leaves consolation games out', () => {
    const h = ownerHistory(ix, 'own-b')!;
    expect(h.seasons.map((s) => `${s.y}:${s.franchiseId}`)).toEqual(['2020:0002', '2021:0003']);
    expect(h.regular.record).toBe('1-1-1');
    expect(h.playoffs.record).toBe('0-2');
    expect(h.finals.map((s) => s.y)).toEqual([2020, 2021]);
    expect(h.titles).toEqual([]);
    expect(h.teams.map((t) => t.franchiseId)).toEqual(['0003', '0002']);
    // The 60-point consolation loss is not a career game.
    expect(h.highs.game).toMatchObject({ s: 125, f: '0002' });
  });

  it('groups head to head by holding and keys rivalry links on the last meeting', () => {
    const h = ownerHistory(ix, 'own-b')!;
    const ann = h.headToHead.find((o) => o.key === 'own-a')!;
    expect(ann.record).toBe('0-3');
    expect(ann.last).toMatchObject({ y: 2021, f: '0003', of: '0001' });
    expect(ann.lastPairCurrent).toBe(true);
    expect(h.headToHead.find((o) => o.key === 'own-c+own-d')!.record).toBe('0-0-1');
    // 0003 had no owner on record in 2020: it is the slot, and gone now.
    expect(h.headToHead.find((o) => o.key === 'slot:0003')!.active).toBe(false);
  });

  it('counts a co-owned season for each co-owner', () => {
    for (const id of ['own-c', 'own-d']) {
      const h = ownerHistory(ix, id)!;
      expect(h.regular.record).toBe('0-0-1');
      expect(h.teams[0]!.coOwners.map((c) => c.ownerId)).toEqual([id === 'own-c' ? 'own-d' : 'own-c']);
    }
  });

  it('is null for an owner the dataset never credits, and for a slot-grouped index', () => {
    expect(ownerHistory(ix, 'own-z')).toBeNull();
    expect(ownerHistory(indexDataset(ds, { groupBy: 'franchise' }), 'own-a')).toBeNull();
  });
});

describe('League History owner pages, real data', () => {
  for (const league of ['theleague', 'afl-fantasy']) {
    it(`${league}: every owner on record has a history`, () => {
      const data = JSON.parse(readFileSync(join(__dirname, `../data/${league}/derived/league-history.json`), 'utf8'));
      const index = indexDataset(data);
      for (const { ownerId } of ownerList(data) as Array<{ ownerId: string }>) {
        expect(ownerHistory(index, ownerId), ownerId).not.toBeNull();
      }
    });
  }
});
