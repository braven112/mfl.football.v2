import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { recordBook } from '../src/utils/league-history/records.mjs';
import {
  franchiseKeepers as fk,
  ownerKeepers as ok,
  settledKeepers as sk,
} from '../src/utils/league-history/keepers.mjs';
import { ownerList as ol } from '../src/utils/league-history/owner.mjs';

/**
 * AFL keeper history (data/afl-fantasy/derived/keeper-history.json): every
 * franchise's keepers from 2005 on (2005-2008 estimated). Seasons through 2026
 * were rebuilt once from MFL's records; later seasons come from our own July roster snapshots
 * (scripts/compute-afl-keeper-history.mjs), and the two must agree where both
 * exist, or the yearly snapshot would quietly write a different rule.
 */

interface Keeper { id: string; name: string; position: string; streak: number; uncertain: boolean }
interface KeeperHistory {
  seasons: Array<{ y: number; franchiseId: string; team: string; estimated: boolean; keepers: Keeper[] }>;
  longest: (Keeper & { from: number; to: number }) | null;
}
interface Row { rank: number; value: number; name: string; context: string }
interface Board { id: string; rows: Row[]; population: unknown[] }
interface Book {
  ix: unknown;
  categories: Array<{ id: string }>;
  category: (id: string) => Board[];
}
interface Snapshot { date: string; rosters: unknown }

const franchiseKeepers = fk as unknown as (kh: unknown, ix: unknown, id: string, opts?: { ownerOnly?: boolean }) => KeeperHistory | null;
const ownerKeepers = ok as unknown as (kh: unknown, ix: unknown, ownerId: string) => KeeperHistory | null;
const settledKeepers = sk as unknown as (
  snapshots: Snapshot[],
  expected: string[],
  limit: number,
) => { date: string; byFranchise: Map<string, string[]> } | null;
const ownerList = ol as unknown as (ds: unknown) => Array<{ ownerId: string }>;
const book = (ds: unknown, opts: object) => recordBook(ds, opts) as unknown as Book;

const root = join(__dirname, '..', 'data', 'afl-fantasy');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const kh = read('derived/keeper-history.json');
const ds = read('derived/league-history.json');

describe('AFL keeper history file', () => {
  it('covers every franchise, every season from 2005', () => {
    const years = Object.keys(kh.seasons).map(Number).sort((a, b) => a - b);
    expect(years[0]).toBe(2005);
    for (let y = 2005; y <= years.at(-1)!; y++) {
      const season = kh.seasons[String(y)];
      expect(season, `${y}`).toBeTruthy();
      expect(Object.keys(season)).toHaveLength(24);
      for (const [f, ids] of Object.entries(season) as Array<[string, string[]]>) {
        // Six is the late-cutdown penalty state, which two seasons carry.
        expect([6, 7], `${y} ${f}`).toContain(ids.length);
      }
    }
  });

  it('marks only the inferred seasons as estimated, and every guess is a kept player', () => {
    expect(kh.estimated.seasons).toEqual([2005, 2006, 2007, 2008]);
    for (const [y, byFranchise] of Object.entries(kh.estimated.uncertain) as Array<[string, Record<string, string[]>]>) {
      expect(kh.estimated.seasons).toContain(Number(y));
      for (const [f, ids] of Object.entries(byFranchise)) {
        for (const id of ids) expect(kh.seasons[y][f], `${y} ${f} ${id}`).toContain(id);
      }
    }
    // Estimated seasons are always a full seven: the league has always kept seven.
    for (const y of kh.estimated.seasons) {
      for (const ids of Object.values(kh.seasons[String(y)]) as string[][]) expect(ids).toHaveLength(7);
    }
  });

  it('names every kept player', () => {
    for (const season of Object.values(kh.seasons) as Array<Record<string, string[]>>) {
      for (const ids of Object.values(season)) {
        for (const id of ids) expect(kh.players[id]?.[0], id).toBeTruthy();
      }
    }
  });

  it('matches the July roster snapshots wherever both exist', () => {
    const feeds = join(root, 'mfl-feeds');
    let compared = 0;
    for (const year of readdirSync(feeds).filter((y) => /^\d{4}$/.test(y))) {
      if (!kh.seasons[year]) continue;
      let names: string[] = [];
      try {
        names = readdirSync(join(feeds, year, 'roster-history'));
      } catch {
        continue;
      }
      const snapshots = names
        .filter((n) => new RegExp(`^rosters-${year}-07-(1[6-9]|[23]\\d)\\.json$`).test(n))
        .map((n) => ({ date: n.slice(8, 18), rosters: JSON.parse(readFileSync(join(feeds, year, 'roster-history', n), 'utf8')) }));
      const league = JSON.parse(readFileSync(join(feeds, year, 'league.json'), 'utf8')).league;
      const ids = league.franchises.franchise.map((f: { id: string }) => f.id);
      const settled = settledKeepers(snapshots, ids, Number(league.maxKeepers));
      if (!settled) continue;
      for (const f of ids) expect(settled.byFranchise.get(f), `${year} ${f}`).toEqual([...kh.seasons[year][f]].sort());
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe('settledKeepers', () => {
  const roster = (id: string, players: Array<[string, string?]>) => ({
    id,
    player: players.map(([pid, status = 'ROSTER']) => ({ id: pid, status })),
  });
  const snap = (date: string, franchises: unknown[]) => ({ date, rosters: { rosters: { franchise: franchises } } });

  it('takes the first snapshot where every franchise is down to the limit', () => {
    const early = snap('2027-07-16', [roster('0001', [['a'], ['b'], ['c']]), roster('0002', [['d'], ['e']])]);
    const settled = snap('2027-07-18', [roster('0001', [['b'], ['a']]), roster('0002', [['d'], ['e']])]);
    const later = snap('2027-07-20', [roster('0001', [['a'], ['x']]), roster('0002', [['d'], ['e']])]);
    const out = settledKeepers([later, early, settled], ['0001', '0002'], 2);
    expect(out?.date).toBe('2027-07-18');
    expect(out?.byFranchise.get('0001')).toEqual(['a', 'b']);
  });

  it('leaves a player parked on injured reserve out of the keepers', () => {
    const s = snap('2027-07-17', [roster('0001', [['a'], ['b'], ['c', 'INJURED_RESERVE']])]);
    expect(settledKeepers([s], ['0001'], 2)?.byFranchise.get('0001')).toEqual(['a', 'b']);
  });

  it('returns null when a franchise never settles', () => {
    const s = snap('2027-07-17', [roster('0001', [['a'], ['b'], ['c']])]);
    expect(settledKeepers([s], ['0001'], 2)).toBeNull();
  });
});

describe('keeper pages and boards', () => {
  const b = book(ds, { keepers: kh });

  it('adds the Keepers category only when a league has keeper history', () => {
    expect(b.categories.map((c) => c.id)).toContain('keepers');
    expect(book(ds, {}).categories.map((c) => c.id)).not.toContain('keepers');
  });

  it('ranks the longest keeper streak', () => {
    const [streak, total] = b.category('keepers');
    expect(streak.id).toBe('keeper-streak');
    expect(streak.rows[0].name).toBe('Aaron Rodgers (QB)');
    expect(streak.rows[0].value).toBe(15);
    expect(total.id).toBe('keeper-seasons');
    expect(total.rows[0].value).toBeGreaterThanOrEqual(streak.rows[0].value);
    expect(streak.population.length).toBeGreaterThan(streak.rows.length);
  });

  it("counts a streak only inside the seasons shown, so an owner's view never inherits one", () => {
    for (const { franchiseId } of Object.entries(kh.seasons['2026']).map(([f]) => ({ franchiseId: f }))) {
      const mine = franchiseKeepers(kh, b.ix, franchiseId, { ownerOnly: true });
      if (!mine) continue;
      const shown = mine.seasons.length;
      for (const s of mine.seasons) for (const k of s.keepers) expect(k.streak).toBeLessThanOrEqual(shown);
    }
  });

  it('labels estimated seasons and best-guess players on the cards', () => {
    const all = Object.keys(kh.seasons['2005']).map((f) => franchiseKeepers(kh, b.ix, f)).filter(Boolean) as KeeperHistory[];
    const cards = all.flatMap((h) => h.seasons);
    expect(cards.filter((c) => c.y <= 2008).every((c) => c.estimated)).toBe(true);
    expect(cards.filter((c) => c.y >= 2009).some((c) => c.estimated)).toBe(false);
    const guesses = cards.filter((c) => c.y >= 2007).flatMap((c) => c.keepers.filter((k) => k.uncertain).map((k) => `${c.y}|${c.franchiseId}|${k.id}`));
    expect(guesses).toContain('2007|0005|3445');
    expect(guesses).toHaveLength(7);
    const [streak] = b.category('keepers') as unknown as Array<{ note: string }>;
    expect(streak.note).toMatch(/before 2009 are estimated/);
  });

  it('gives every owner with a keeper season a keepers section', () => {
    const withKeepers = ownerList(ds).filter((o) => ownerKeepers(kh, b.ix, o.ownerId));
    expect(withKeepers.length).toBeGreaterThan(20);
  });
});
