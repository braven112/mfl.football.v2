import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordBook } from '../src/utils/league-history/records.mjs';
import { franchisePickTrades as fpt, picksTradedBySeason as pbs } from '../src/utils/league-history/pick-trades.mjs';
import { seasonBarChart as sbc } from '../src/utils/league-history/record-charts.mjs';

/**
 * AFL draft-pick trades (data/afl-fantasy/derived/pick-trades.json): every
 * traded pick's path and the trades that moved it, shown on franchise pages
 * and as the Record Book's Draft picks board.
 */

interface Item { kind: 'player' | 'pick'; name?: string; label?: string; fate?: string; guess?: boolean }
interface Trade { ts: number; season: number; partner: { id: string; name: string }; gave: Item[]; got: Item[] }
interface Board { id: string; rows: Array<{ rank: number; value: number; name: string; context: string }>; series?: Array<{ season: number; count: number }> }
interface Book { ix: unknown; categories: Array<{ id: string }>; category: (id: string) => Board[] }

const franchisePickTrades = fpt as unknown as (
  pt: unknown, ix: unknown, id: string, opts?: { ownerOnly?: boolean },
) => { trades: Trade[]; sent: number; received: number } | null;
const picksTradedBySeason = pbs as unknown as (pt: unknown) => Array<{ season: number; count: number }>;
const seasonBarChart = sbc as unknown as (s: Array<{ season: number; count: number }>, w: number) => { svg: string; take: string } | null;
const book = (ds: unknown, opts: object) => recordBook(ds, opts) as unknown as Book;

const root = join(__dirname, '..', 'data', 'afl-fantasy', 'derived');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const pt = read('pick-trades.json');
const ds = read('league-history.json');

describe('AFL pick-trades file', () => {
  it('ties every hop of every pick to a recorded trade between the same two teams', () => {
    expect(pt.picks.length).toBeGreaterThan(300);
    for (const p of pt.picks) {
      expect(p.hops.length, p.id).toBeGreaterThan(0);
      let holder = p.original;
      for (const h of p.hops) {
        expect(h.from, p.id).toBe(holder);
        const t = pt.trades[h.trade];
        expect(t, `${p.id} ${h.trade}`).toBeTruthy();
        expect(t.sides.map((s: { franchise: string }) => s.franchise).sort()).toEqual([h.from, h.to].sort());
        holder = h.to;
      }
      if (p.used) expect(p.used.by, p.id).toBe(holder);
    }
  });

  it('names every player in a trade or taken with a traded pick', () => {
    for (const t of Object.values(pt.trades) as Array<{ sides: Array<{ gave: Array<{ player?: string }> }> }>) {
      for (const s of t.sides) for (const g of s.gave) if (g.player) expect(pt.players[g.player]?.[0], g.player).toBeTruthy();
    }
    for (const p of pt.picks) if (p.used) expect(pt.players[p.used.player]?.[0], p.id).toBeTruthy();
  });
});

describe('pick trades on pages', () => {
  const b = book(ds, { picks: pt });

  it('adds the Draft picks category only when a league has pick trades', () => {
    expect(b.categories.map((c) => c.id)).toContain('picks');
    expect(book(ds, {}).categories.map((c) => c.id)).not.toContain('picks');
  });

  it('ranks the most-traded picks and carries a per-season count', () => {
    const [board] = b.category('picks');
    expect(board.id).toBe('pick-trades');
    expect(board.rows[0].value).toBe(4);
    expect(board.rows[0].context).toContain('→');
    const total = board.series!.reduce((n, s) => n + s.count, 0);
    expect(total).toBe(picksTradedBySeason(pt).reduce((n, s) => n + s.count, 0));
    const chart = seasonBarChart(board.series!, 290);
    expect(chart?.svg).toContain('<rect');
    expect(chart?.take).toMatch(/busiest season was \d{4}/);
  });

  it("shows a franchise both sides of each trade and what the picks became", () => {
    const all = franchisePickTrades(pt, b.ix, '0001')!;
    expect(all.trades.length).toBeGreaterThan(0);
    for (const t of all.trades) {
      expect(t.partner.name).toBeTruthy();
      expect([...t.gave, ...t.got].some((i) => i.kind === 'pick')).toBe(true);
      for (const i of [...t.gave, ...t.got]) if (i.kind === 'pick') expect(i.fate).toBeTruthy();
    }
    expect(all.trades.map((t) => t.ts)).toEqual([...all.trades.map((t) => t.ts)].sort((x, y) => y - x));
    const mine = franchisePickTrades(pt, b.ix, '0001', { ownerOnly: true })!;
    expect(mine.trades.length).toBeLessThanOrEqual(all.trades.length);
  });
});
