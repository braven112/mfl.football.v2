/**
 * The per-season league.json facts that decide how the transactions ledger
 * READS: whether bids show (FAAB), to how many decimals (cents), and whether
 * rows carry division context (division player pools).
 *
 * The cross-league half is the parity guard: TheLeague and the AFL render the
 * same shared TransactionsPage as archies, and they stay byte-for-byte what
 * they were only because every one of their seasons resolves to the empty
 * context. A season that ever answers otherwise changes their page.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ledgerLeagueContextFrom } from '../src/utils/transactions-feeds';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const feedPath = (slug: string, year: string) => path.join('data', slug, 'mfl-feeds', year, 'league.json');
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('ledgerLeagueContextFrom', () => {
  it('reads archies as a cents FAAB league with nine division pools', () => {
    const ctx = ledgerLeagueContextFrom(read(feedPath('archies', '2026')));
    expect(ctx.faabBudget).toBe(100);
    expect(ctx.amountDecimals).toBe(2);
    expect(ctx.divisions).toHaveLength(9);
    // MFL pads some names with a trailing space; the tag drops "Division".
    expect(ctx.divisions!.every((d) => d.name === d.name.trim())).toBe(true);
    expect(ctx.divisions!.find((d) => d.id === '03')?.abbrev).toBe('Tom Brady');
    expect(Object.keys(ctx.divisionOfFranchise)).toHaveLength(99);
  });

  it('degrades to the empty context on a missing or malformed feed', () => {
    for (const feed of [null, {}, { league: null }, 'nope']) {
      expect(ledgerLeagueContextFrom(feed)).toEqual({
        faabBudget: null,
        amountDecimals: 0,
        divisions: null,
        divisionOfFranchise: {},
      });
    }
  });

  it('gives divisions only to a DIVISION-pool league', () => {
    const league = {
      playerLimitUnit: 'LEAGUE',
      divisions: { division: [{ id: '00', name: 'A' }, { id: '01', name: 'B' }] },
      franchises: { franchise: [{ id: '0001', division: '00' }, { id: '0002', division: '01' }] },
    };
    expect(ledgerLeagueContextFrom({ league }).divisions).toBeNull();
    expect(ledgerLeagueContextFrom({ league: { ...league, playerLimitUnit: 'DIVISION' } }).divisions).toHaveLength(2);
  });

  it('shows whole dollars when the increment is a dollar or more', () => {
    expect(ledgerLeagueContextFrom({ league: { bbidIncrement: '25000' } }).amountDecimals).toBe(0);
    expect(ledgerLeagueContextFrom({ league: { bbidIncrement: '1' } }).amountDecimals).toBe(0);
    expect(ledgerLeagueContextFrom({ league: { bbidIncrement: '0.25' } }).amountDecimals).toBe(2);
  });
});

describe('parity: every non-package league season resolves to the empty context', () => {
  const fullLeagues = ALL_LEAGUES.filter((l) => l.slug === 'theleague' || l.slug === 'afl-fantasy');
  const seasons = fullLeagues.flatMap((l) => {
    const dir = path.join('data', l.slug, 'mfl-feeds');
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((y) => fs.existsSync(feedPath(l.slug, y))).map((y) => ({ slug: l.slug, year: y }))
      : [];
  });

  it('found both leagues’ seasons', () => {
    expect(new Set(seasons.map((s) => s.slug)).size).toBe(2);
    expect(seasons.length).toBeGreaterThan(20);
  });

  it('none is FAAB, cents, or division-pooled', () => {
    const off = seasons
      .map((s) => ({ ...s, ctx: ledgerLeagueContextFrom(read(feedPath(s.slug, s.year))) }))
      .filter(({ ctx }) => ctx.faabBudget !== null || ctx.amountDecimals !== 0 || ctx.divisions !== null)
      .map(({ slug, year }) => `${slug}/${year}`);
    expect(off).toEqual([]);
  });
});
