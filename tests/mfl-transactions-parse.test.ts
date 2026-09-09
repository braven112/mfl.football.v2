/**
 * Guards for the transactions normalizer.
 *
 * Each `describe` below is a shape that actually exists in the committed MFL
 * archive and that a reasonable-looking parser gets wrong. The final block
 * sweeps every season of both leagues, which is what catches a shape nobody
 * thought to write a case for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeTransaction,
  normalizeTransactions,
  parsePickToken,
  extractTransactionRows,
  type TransactionRow,
} from '../src/utils/mfl-transactions';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const one = (raw: Record<string, unknown>, opts = {}) => normalizeTransaction(raw, opts);

describe('the two waiver encodings', () => {
  it('reads BBID_WAIVER from the pipe string', () => {
    const row = one({
      type: 'BBID_WAIVER',
      franchise: '0008',
      timestamp: '1788400800',
      transaction: '14063,|425000|15777,',
    });
    expect(row).toMatchObject({
      kind: 'blind-bid',
      added: ['14063'],
      dropped: ['15777'],
      amount: 425000,
    });
  });

  it('reads plain WAIVER from the added/dropped FIELDS', () => {
    // 1,477 rows in TheLeague and 7,083 in the AFL use this shape. A parser
    // that only knows the pipe string returns an empty row for all of them.
    const row = one({
      type: 'WAIVER',
      franchise: '0008',
      timestamp: '1788832800',
      added: '0501,',
      dropped: '16809,',
    });
    expect(row).toMatchObject({ kind: 'waiver', added: ['0501'], dropped: ['16809'] });
  });

  it('does not confuse a WAIVER row that also carries an empty transaction string', () => {
    const row = one({
      type: 'WAIVER',
      franchise: '0008',
      timestamp: '1788832800',
      added: '0501,',
      dropped: '',
      transaction: '',
    });
    expect(row?.added).toEqual(['0501']);
  });
});

describe('added and dropped are both lists', () => {
  it('keeps every player in a seven-player drop', () => {
    const row = one({
      type: 'FREE_AGENT',
      franchise: '0002',
      timestamp: '1771138565',
      transaction: '|16342,14823,13299,13595,7836,10413,16757,',
    });
    expect(row?.dropped).toHaveLength(7);
    expect(row?.added).toEqual([]);
  });

  it('keeps every player when a WAIVER adds more than one', () => {
    const row = one({
      type: 'WAIVER',
      franchise: '0003',
      timestamp: '1700000000',
      added: '111,222,',
      dropped: '333,444,555,',
    });
    expect(row?.added).toEqual(['111', '222']);
    expect(row?.dropped).toEqual(['333', '444', '555']);
  });
});

describe('pipe segments vary within a type', () => {
  // AUCTION_WON is 3-segment 1,190 times and 2-segment 1,770 times.
  it.each([
    ['trailing pipe', '12140|425000|'],
    ['no trailing pipe', '12140|425000'],
  ])('reads an AUCTION_WON with %s', (_label, transaction) => {
    const row = one({ type: 'AUCTION_WON', franchise: '0002', timestamp: '1786480320', transaction });
    expect(row).toMatchObject({ kind: 'auction', added: ['12140'], amount: 425000 });
  });
});

describe('the comma is not consistent across types', () => {
  it('strips the terminator on roster types and tolerates its absence on auctions', () => {
    const fa = one({ type: 'FREE_AGENT', franchise: '0011', timestamp: '1786938819', transaction: '17048,|' });
    const auction = one({ type: 'AUCTION_WON', franchise: '0011', timestamp: '1786938819', transaction: '17048|425000|' });
    expect(fa?.added).toEqual(['17048']);
    expect(auction?.added).toEqual(['17048']);
  });
});

describe('rows that are not signings', () => {
  it.each([
    'IR',
    'TAXI',
    'AUCTION_BID',
    'AUCTION_INIT',
    'LOCK_ALL_PLAYERS',
    'UNLOCK_ALL_PLAYERS',
    'AUTO_PROCESS_WAIVERS',
    'BBID_AUTO_PROCESS_WAIVERS',
    'PROCESS_WAIVERS',
    'LOAD_ROSTERS',
  ])('excludes %s', (type) => {
    expect(one({ type, franchise: '0002', timestamp: '1788400800', transaction: '12140|425000|' })).toBeNull();
  });

  it('excludes a row with no franchise even when the type is a real signing', () => {
    // 26 AUCTION_WON rows in the archive have an empty franchise. They cannot
    // be attributed, filtered or crested, so they are not renderable.
    expect(one({ type: 'AUCTION_WON', franchise: '', timestamp: '1786480320', transaction: '12140|425000|' })).toBeNull();
  });

  it('excludes a row with an unusable timestamp', () => {
    expect(one({ type: 'FREE_AGENT', franchise: '0002', timestamp: '', transaction: '17048,|' })).toBeNull();
  });

  it('excludes a row that moves nobody', () => {
    expect(one({ type: 'FREE_AGENT', franchise: '0002', timestamp: '1788400800', transaction: '|' })).toBeNull();
  });
});

describe('commissioner attribution', () => {
  it('flags a by_commish row rather than dropping it', () => {
    const row = one({
      type: 'FREE_AGENT',
      franchise: '0012',
      timestamp: '1771138565',
      by_commish: '1',
      transaction: '|16608,',
    });
    expect(row?.byCommish).toBe(true);
  });

  it('treats an absent flag as owner-executed', () => {
    const row = one({ type: 'FREE_AGENT', franchise: '0012', timestamp: '1771138565', transaction: '|16608,' });
    expect(row?.byCommish).toBe(false);
  });

  it('treats "0" as owner-executed', () => {
    const row = one({ type: 'FREE_AGENT', franchise: '0012', timestamp: '1771138565', by_commish: '0', transaction: '|16608,' });
    expect(row?.byCommish).toBe(false);
  });
});

describe('draft picks in trades', () => {
  it('parses a future pick', () => {
    expect(parsePickToken('FP_0005_2026_3')).toEqual({
      raw: 'FP_0005_2026_3',
      scope: 'future',
      franchiseId: '0005',
      year: 2026,
      round: 3,
      pick: null,
    });
  });

  it('parses a current-draft pick, un-zero-indexing both numbers', () => {
    // 683 DP_ tokens in the archive against 543 FP_ — the notation a parser
    // is most likely to skip is the one that appears most.
    expect(parsePickToken('DP_0_11')).toMatchObject({ scope: 'current', round: 1, pick: 12 });
    expect(parsePickToken('DP_3_0')).toMatchObject({ scope: 'current', round: 4, pick: 1 });
  });

  it('returns null for a plain player id so it is not mistaken for a pick', () => {
    expect(parsePickToken('13630')).toBeNull();
  });

  it('splits a trade into two sides of players and picks', () => {
    const row = one({
      type: 'TRADE',
      franchise: '0005',
      franchise2: '0011',
      franchise1_gave_up: 'FP_0005_2026_3,',
      franchise2_gave_up: '13630,DP_0_11,',
      timestamp: '1763180188',
      comments: '',
    });
    expect(row?.kind).toBe('trade');
    expect(row?.trade?.sides[0]).toMatchObject({ franchiseId: '0005', players: [], picks: [{ round: 3 }] });
    expect(row?.trade?.sides[1]).toMatchObject({ franchiseId: '0011', players: ['13630'] });
    expect(row?.trade?.sides[1].picks).toHaveLength(1);
  });

  it('excludes a one-sided trade row', () => {
    expect(one({ type: 'TRADE', franchise: '0005', franchise2: '', timestamp: '1763180188' })).toBeNull();
  });
});

describe('pricing', () => {
  it('prices an FCFS pickup at the league minimum it is handed', () => {
    const row = one(
      { type: 'FREE_AGENT', franchise: '0011', timestamp: '1786938819', transaction: '17048,|' },
      { freeAgentPrice: 425000 }
    );
    expect(row?.amount).toBe(425000);
  });

  it('leaves an FCFS pickup unpriced when the league has no minimum', () => {
    const row = one(
      { type: 'FREE_AGENT', franchise: '0011', timestamp: '1786938819', transaction: '17048,|' },
      { freeAgentPrice: null }
    );
    expect(row?.amount).toBeNull();
  });

  it('never prices a drop-only row', () => {
    // Stamping the minimum here would read as though a release cost money.
    const row = one(
      { type: 'FREE_AGENT', franchise: '0011', timestamp: '1786938819', transaction: '|16775,' },
      { freeAgentPrice: 425000 }
    );
    expect(row?.amount).toBeNull();
  });

  it('prefers the feed bid over the league minimum on a blind bid', () => {
    const row = one(
      { type: 'BBID_WAIVER', franchise: '0008', timestamp: '1788400800', transaction: '14063,|2500000|' },
      { freeAgentPrice: 425000 }
    );
    expect(row?.amount).toBe(2500000);
  });
});

describe('feed envelope and ordering', () => {
  it('accepts the full export, the inner object, and a bare array alike', () => {
    const row = { type: 'FREE_AGENT', franchise: '0011', timestamp: '1786938819', transaction: '17048,|' };
    expect(extractTransactionRows({ transactions: { transaction: [row] } })).toHaveLength(1);
    expect(extractTransactionRows({ transaction: [row] })).toHaveLength(1);
    expect(extractTransactionRows([row])).toHaveLength(1);
    // MFL sends a lone transaction as an object rather than a one-item array.
    expect(extractTransactionRows({ transactions: { transaction: row } })).toHaveLength(1);
    expect(extractTransactionRows(undefined)).toEqual([]);
  });

  it('sorts newest first regardless of the order MFL sent', () => {
    const mk = (timestamp: string, id: string) => ({
      type: 'FREE_AGENT', franchise: '0001', timestamp, transaction: `${id},|`,
    });
    const rows = normalizeTransactions([mk('100', '1'), mk('300', '3'), mk('200', '2')]);
    expect(rows.map((r) => r.at)).toEqual([300000, 200000, 100000]);
  });

  it('collapses a row MFL emitted twice', () => {
    // Real shape: TheLeague 2012-07-10 and 2017-05-27 each carry two
    // byte-identical AUCTION_WON records for one win.
    const raw = { type: 'AUCTION_WON', franchise: '0012', timestamp: '1341920133', transaction: '10960|1300000' };
    expect(normalizeTransactions([raw, { ...raw }])).toHaveLength(1);
  });

  it('gives two claims in one blind-bid batch distinct ids', () => {
    // Every claim in a run shares the deadline's single timestamp, so
    // type+timestamp+franchise is not unique.
    const at = '1788400800';
    const rows = normalizeTransactions([
      { type: 'BBID_WAIVER', franchise: '0008', timestamp: at, transaction: '111,|425000|999,' },
      { type: 'BBID_WAIVER', franchise: '0008', timestamp: at, transaction: '222,|425000|888,' },
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});

/**
 * The sweep. Every committed season of every league that has the feed, run
 * through the normalizer, asserting only things that must hold for ALL data.
 * This is what catches a shape no hand-written case anticipated.
 */
describe('the committed archive', () => {
  const seasons: { slug: string; year: string; feed: unknown }[] = [];
  for (const league of ALL_LEAGUES) {
    const base = join(process.cwd(), league.dataPath, 'mfl-feeds');
    if (!existsSync(base)) continue;
    for (const year of readdirSync(base)) {
      const file = join(base, year, 'transactions.json');
      if (!existsSync(file)) continue;
      try {
        seasons.push({ slug: league.slug, year, feed: JSON.parse(readFileSync(file, 'utf-8')) });
      } catch {
        // A corrupt feed is a sync problem, not a parser problem.
      }
    }
  }

  it('found seasons to sweep in more than one league', () => {
    expect(seasons.length).toBeGreaterThan(20);
    expect(new Set(seasons.map((s) => s.slug)).size).toBeGreaterThan(1);
  });

  const rowsFor = (s: (typeof seasons)[number]) =>
    normalizeTransactions(s.feed, { freeAgentPrice: 425000 });

  it('normalizes every season without throwing, and produces rows', () => {
    let total = 0;
    for (const season of seasons) total += rowsFor(season).length;
    expect(total).toBeGreaterThan(10000);
  });

  it('holds every row invariant across the whole archive', () => {
    const problems: string[] = [];
    for (const season of seasons) {
      const ids = new Set<string>();
      for (const row of rowsFor(season)) {
        const where = `${season.slug}/${season.year} ${row.rawType}`;
        if (!row.franchiseId) problems.push(`${where}: empty franchiseId`);
        if (!Number.isFinite(row.at) || row.at <= 0) problems.push(`${where}: bad timestamp`);
        if (!Array.isArray(row.added) || !Array.isArray(row.dropped)) problems.push(`${where}: added/dropped not arrays`);
        if (row.amount !== null && (!Number.isFinite(row.amount) || row.amount <= 0)) problems.push(`${where}: bad amount ${row.amount}`);
        if (row.kind === 'trade' && row.trade === null) problems.push(`${where}: trade row with no trade detail`);
        if (row.kind !== 'trade' && row.trade !== null) problems.push(`${where}: non-trade row carrying trade detail`);
        if (row.kind !== 'trade' && row.added.length === 0 && row.dropped.length === 0) problems.push(`${where}: row moves nobody`);
        if (ids.has(row.id)) problems.push(`${where}: duplicate id ${row.id}`);
        ids.add(row.id);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('never emits a player id that is really a draft-pick token', () => {
    // The failure mode this pins: a pick token falling through the player
    // branch and later resolving to nobody in the UI.
    const leaked: string[] = [];
    for (const season of seasons) {
      for (const row of rowsFor(season)) {
        const ids = row.trade ? row.trade.sides.flatMap((s) => s.players) : [...row.added, ...row.dropped];
        for (const id of ids) {
          if (/^(FP|DP)_/.test(id)) leaked.push(`${season.slug}/${season.year}: ${id}`);
        }
      }
    }
    expect(leaked.slice(0, 10)).toEqual([]);
  });

  it('classifies both waiver encodings in whichever league uses them', () => {
    const kindsByLeague = new Map<string, Set<string>>();
    for (const season of seasons) {
      const set = kindsByLeague.get(season.slug) ?? new Set<string>();
      for (const row of rowsFor(season)) set.add(row.rawType);
      kindsByLeague.set(season.slug, set);
    }
    // Both leagues run plain WAIVER somewhere in their history — the shape a
    // 2026-only reading makes look AFL-exclusive.
    expect([...(kindsByLeague.get('theleague') ?? [])]).toContain('WAIVER');
    expect([...(kindsByLeague.get('afl-fantasy') ?? [])]).toContain('WAIVER');
    expect([...(kindsByLeague.get('theleague') ?? [])]).toContain('BBID_WAIVER');
  });
});
