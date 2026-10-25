import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexDataset } from '../src/utils/league-history/records.mjs';
import { champions as champs, dynasties as dyn, seasonGrid as grid } from '../src/utils/league-history/home.mjs';

/**
 * League History home: one banner per champion, owners ranked by titles, and
 * a grid row per owner that splits current owners from former ones.
 */

interface Banner { year: number; name: string }
interface GridOut { years: number[]; live: number | null; rows: Array<{ key: string; titles: number }>; former: Array<{ key: string }> }
const champions = champs as unknown as (ix: unknown) => Banner[];
const dynasties = dyn as unknown as (ix: unknown) => Array<{ titles: number[] }>;
const seasonGrid = grid as unknown as (ix: unknown) => GridOut;

describe.each(['theleague', 'afl-fantasy'])('%s history home', (slug) => {
  const ds = JSON.parse(readFileSync(join(__dirname, '..', 'data', slug, 'derived', 'league-history.json'), 'utf8'));
  const ix = indexDataset(ds);

  it('raises one banner per finished season, newest first', () => {
    const banners = champions(ix);
    const done = ds.seasons.filter((s: { done: number }) => s.done).length;
    expect(banners).toHaveLength(done);
    expect(banners[0]!.year).toBeGreaterThan(banners[banners.length - 1]!.year);
  });

  it('counts every title exactly once across the dynasties', () => {
    const titles = dynasties(ix).reduce((n, d) => n + d.titles.length, 0);
    expect(titles).toBe(champions(ix).length);
  });

  it('puts every franchise in the latest season on a current row', () => {
    const g = seasonGrid(ix);
    const latest = ds.seasons[ds.seasons.length - 1];
    expect(g.rows.length).toBeLessThanOrEqual(Object.keys(latest.teams).length);
    expect(g.rows.length).toBeGreaterThan(0);
    const keys = new Set(g.rows.map((r) => r.key));
    for (const r of g.former) expect(keys.has(r.key)).toBe(false);
  });
});
