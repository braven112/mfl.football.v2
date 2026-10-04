import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatTradeAsset, franchiseEraInYear } from '../src/utils/franchise-trade-asset';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import aflHistory from '../data/afl-fantasy/derived/franchise-history.json';
import theleagueHistory from '../data/theleague/derived/franchise-history.json';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

describe('franchiseEraInYear', () => {
  const slot0005 = (aflConfig.teams as any[]).find((t) => t.franchiseId === '0005');

  it("names the AFL's 0005 by its 2007 identity, not today's", () => {
    // The June 2007 trade card read "Computer Jocks"; the slot was 420 All-Stars.
    expect(franchiseEraInYear(slot0005, 2007)?.name).toBe('420 All-Stars');
    expect(franchiseEraInYear(slot0005, 2007)?.icon).toMatch(/420_all_stars/);
  });

  it('labels a future pick by its origin team as named in the trade season', () => {
    const label = formatTradeAsset(
      'FP_0005_2008_1',
      {},
      (fid) => franchiseEraInYear((aflConfig.teams as any[]).find((t) => t.franchiseId === fid), 2007)?.name ?? fid
    );
    expect(label).toBe('2008 R1 pick (via 420 All-Stars)');
  });

  it('returns null inside the current identity so the caller keeps its label', () => {
    expect(franchiseEraInYear(slot0005, 2026)).toBeNull();
    expect(franchiseEraInYear(undefined, 2007)).toBeNull();
  });
});

describe('historical players.json backfill', () => {
  it('every season feed directory carries a players.json', () => {
    // scripts/fetch-historical-players.mjs fills these; without one, every
    // player traded that season renders as "Player #<id>".
    for (const league of ALL_LEAGUES) {
      const feeds = join(league.dataPath ?? '', 'mfl-feeds');
      if (!league.dataPath || !existsSync(feeds)) continue;
      const missing = readdirSync(feeds)
        .filter((y) => /^\d{4}$/.test(y))
        .filter((y) => !existsSync(join(feeds, y, 'players.json')));
      expect(missing, `${league.slug} seasons without players.json`).toEqual([]);
    }
  });

  it('every traded player id in the franchise ledgers resolves to a name', () => {
    for (const history of [theleagueHistory, aflHistory] as any[]) {
      const unresolved = new Set<string>();
      for (const fr of Object.values(history.franchises) as any[]) {
        for (const t of fr.trades ?? []) {
          for (const code of [...t.gaveUp, ...t.received]) {
            if (/^\d+$/.test(code) && !history.playerNames[code]) unresolved.add(code);
          }
        }
      }
      expect([...unresolved]).toEqual([]);
    }
  });
});
