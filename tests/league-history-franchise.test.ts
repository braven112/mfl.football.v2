import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexDataset } from '../src/utils/league-history/records.mjs';
import { champions as champs } from '../src/utils/league-history/home.mjs';
import { franchiseHistory as fh, franchiseList as fl } from '../src/utils/league-history/franchise.mjs';

/**
 * League History franchise pages: built only from the dataset, so every
 * league with one gets them. Every title lands on exactly one franchise's
 * rafters, and a franchise's games add up to its record.
 */

interface Tally { w: number; l: number; t: number }
interface History {
  titles: number[];
  finals: number[];
  seasons: Array<{ y: number; live: boolean }>;
  regular: Tally;
  playoffs: Tally;
  games: number;
  owners: Array<{ seasons: number }>;
  headToHead: Array<Tally & { games: number }>;
}
const franchiseHistory = fh as unknown as (ix: unknown, id: string, opts?: { ownerOnly?: boolean }) => History | null;
const franchiseList = fl as unknown as (ds: unknown) => Array<{ franchiseId: string; active: boolean }>;
const champions = champs as unknown as (ix: unknown) => Array<{ year: number }>;

describe.each(['theleague', 'afl-fantasy'])('%s franchise history', (slug) => {
  const ds = JSON.parse(readFileSync(join(__dirname, '..', 'data', slug, 'derived', 'league-history.json'), 'utf8'));
  const ix = indexDataset(ds);
  const list = franchiseList(ds);
  const all = list.map((f) => franchiseHistory(ix, f.franchiseId)!);

  it('lists every franchise id, the active ones first', () => {
    const latest = ds.seasons[ds.seasons.length - 1];
    expect(list.filter((f) => f.active)).toHaveLength(Object.keys(latest.teams).length);
    const firstFormer = list.findIndex((f) => !f.active);
    if (firstFormer >= 0) expect(list.slice(firstFormer).every((f) => !f.active)).toBe(true);
  });

  it('hangs every championship banner on exactly one franchise', () => {
    const years = all.flatMap((h) => h.titles).sort();
    expect(years).toEqual(champions(ix).map((b) => b.year).sort());
    for (const h of all) for (const y of h.titles) expect(h.finals).toContain(y);
  });

  it('adds the head-to-head games up to the franchise record', () => {
    for (const h of all) {
      const vs = h.headToHead.reduce((n, o) => n + o.games, 0);
      expect(vs).toBe(h.games);
      const wins = h.headToHead.reduce((n, o) => n + o.w, 0);
      expect(wins).toBe(h.regular.w + h.playoffs.w);
    }
  });

  it('credits every season to one owner', () => {
    for (const h of all) expect(h.owners.reduce((n, o) => n + o.seasons, 0)).toBe(h.seasons.length);
  });

  it('narrows to the current owner run, games and seasons alike', () => {
    for (const f of list) {
      const whole = franchiseHistory(ix, f.franchiseId)!;
      const mine = franchiseHistory(ix, f.franchiseId, { ownerOnly: true })!;
      expect(mine.owners).toHaveLength(1);
      expect(mine.seasons.length).toBeLessThanOrEqual(whole.seasons.length);
      expect(mine.headToHead.reduce((n, o) => n + o.games, 0)).toBe(mine.games);
      expect(mine.games).toBeLessThanOrEqual(whole.games);
    }
  });

  it('returns null for a franchise the league never had', () => {
    expect(franchiseHistory(ix, '9999')).toBeNull();
  });
});
