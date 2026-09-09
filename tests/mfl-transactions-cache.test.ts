import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MFLRawTransaction } from '../src/types/contract-eligibility';

const getRedis = vi.fn();
vi.mock('../src/utils/redis-client', () => ({ getRedis: () => getRedis() }));

const {
  mergeTransactionRows,
  getCachedRecentTransactions,
  RECENT_TRANSACTION_DAYS,
} = await import('../src/utils/mfl-transactions-cache');

const row = (o: Partial<MFLRawTransaction> = {}): MFLRawTransaction => ({
  type: 'BBID_WAIVER',
  franchise: '0008',
  timestamp: '1788919200',
  transaction: '16778,|500000|',
  ...o,
});

describe('mergeTransactionRows', () => {
  it('keeps a live row the static feed has not caught up with', () => {
    const merged = mergeTransactionRows([row({ timestamp: '1788800000' })], [row()]);
    expect(merged).toHaveLength(2);
    expect(merged[0].timestamp).toBe('1788919200');
  });

  it('de-duplicates a row present in both lists', () => {
    expect(mergeTransactionRows([row()], [row()])).toHaveLength(1);
  });

  it('sorts newest first — findAcquisitionTransaction returns the first match it walks past', () => {
    const merged = mergeTransactionRows(
      [row({ timestamp: '1788700000' }), row({ timestamp: '1788900000' })],
      [row({ timestamp: '1788800000' })],
    );
    expect(merged.map(r => r.timestamp)).toEqual(['1788900000', '1788800000', '1788700000']);
  });

  it('treats rows that differ only by transaction string as distinct', () => {
    const merged = mergeTransactionRows(
      [row({ transaction: '16778,|500000|' })],
      [row({ transaction: '16778,|500000|15777,' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('keeps two AFL waiver rows that differ only in added/dropped', () => {
    // The bug this replaced: an AFL WAIVER row has NO `transaction` field —
    // the players are in added/dropped — so a franchise winning two claims in
    // one batch shares type, franchise and the batch timestamp. Keyed on
    // `transaction` alone those were identical and one vanished. 566 rows in
    // the AFL archive are this shape.
    const merged = mergeTransactionRows(
      [{ type: 'WAIVER', franchise: '0019', timestamp: '1198731601', added: '1757', dropped: '8252' } as never],
      [{ type: 'WAIVER', franchise: '0019', timestamp: '1198731601', added: '6786', dropped: '5429' } as never],
    );
    expect(merged).toHaveLength(2);
  });

  it('keeps two trades executed in the same second', () => {
    // Real: TheLeague 2008, franchise 0008 traded with 0012 and 0009 at
    // timestamp 1209846541. Neither row carries `transaction`.
    const merged = mergeTransactionRows(
      [{ type: 'TRADE', franchise: '0008', timestamp: '1209846541', franchise2: '0012', franchise1_gave_up: '7816,', franchise2_gave_up: '5724,' } as never],
      [{ type: 'TRADE', franchise: '0008', timestamp: '1209846541', franchise2: '0009', franchise1_gave_up: '3494,', franchise2_gave_up: '4883,' } as never],
    );
    expect(merged).toHaveLength(2);
  });

  it.each([
    ['IR', { activated: '', deactivated: '16594,' }, { activated: '13146,', deactivated: '' }],
    ['TAXI', { promoted: '16613,', demoted: '' }, { promoted: '', demoted: '15254,' }],
  ])('keeps two %s rows that differ only in their own field pair', (type, a, b) => {
    const base = { type, franchise: '0002', timestamp: '1788833640' };
    expect(
      mergeTransactionRows([{ ...base, ...a } as never], [{ ...base, ...b } as never]),
    ).toHaveLength(2);
  });

  it('still collapses one row whose fields arrive in a different ORDER', () => {
    // MFL's key order is nondeterministic between fetches, so an
    // order-sensitive key would read the same row as two.
    const a = { type: 'AUCTION_WON', franchise: '0012', timestamp: '1341920133', transaction: '10960|1300000' };
    const b = { transaction: '10960|1300000', timestamp: '1341920133', franchise: '0012', type: 'AUCTION_WON' };
    expect(mergeTransactionRows([a as never], [b as never])).toHaveLength(1);
  });

  it('treats an empty field and an absent one as the same row', () => {
    // A field carrying no value carries no identity; splitting on it would
    // duplicate a row across the two sources.
    const withEmpty = { type: 'LOCK_ALL_PLAYERS', franchise: '0001', timestamp: '1788400800', transaction: '' };
    const without = { type: 'LOCK_ALL_PLAYERS', franchise: '0001', timestamp: '1788400800' };
    expect(mergeTransactionRows([withEmpty as never], [without as never])).toHaveLength(1);
  });

  it('survives a null or empty side (no Redis, or a quiet few days)', () => {
    expect(mergeTransactionRows(null, null)).toEqual([]);
    expect(mergeTransactionRows([row()], null)).toHaveLength(1);
    expect(mergeTransactionRows(null, [row()])).toHaveLength(1);
  });
});

describe('getCachedRecentTransactions', () => {
  beforeEach(() => {
    getRedis.mockReset();
    vi.unstubAllGlobals();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns null with no Redis, so callers keep the static feed', async () => {
    getRedis.mockResolvedValue(null);
    expect(await getCachedRecentTransactions('2026', '13522')).toBeNull();
  });

  it('serves a fresh cache without touching MFL', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [row()], fetchedAt: Date.now() }),
      set: async () => 'OK',
    });
    const result = await getCachedRecentTransactions('2026', '13522');
    expect(result).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refetches when the cache is stale and asks MFL only for recent days', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [], fetchedAt: Date.now() - 10 * 60 * 1000 }),
      set,
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: { transaction: [row()] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getCachedRecentTransactions('2026', '13522');
    expect(result).toEqual([row()]);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('TYPE=transactions');
    expect(url).toContain(`DAYS=${RECENT_TRANSACTION_DAYS}`);
    expect(set).toHaveBeenCalled();
  });

  it('covers the 48-hour offseason window with margin', () => {
    expect(RECENT_TRANSACTION_DAYS).toBeGreaterThanOrEqual(3);
  });

  it('normalizes MFL collapsing a single row to an object', async () => {
    getRedis.mockResolvedValue({ get: async () => null, set: async () => 'OK' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: { transaction: row() } }),
    }));
    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([row()]);
  });

  it('reads a quiet few days as an empty list, not a failure', async () => {
    getRedis.mockResolvedValue({ get: async () => null, set: async () => 'OK' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: {} }),
    }));
    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([]);
  });

  it('falls back to the stale cache when the refresh fails', async () => {
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [row()], fetchedAt: Date.now() - 10 * 60 * 1000 }),
      set: async () => 'OK',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await getCachedRecentTransactions('2026', '13522')).toHaveLength(1);
  });

  it('returns null rather than throwing when Redis reads blow up', async () => {
    getRedis.mockResolvedValue({
      get: async () => { throw new Error('ECONNRESET'); },
      set: async () => 'OK',
    });
    expect(await getCachedRecentTransactions('2026', '13522')).toBeNull();
  });
});

// --- The composition, which is what the pages actually rely on ---
//
// The cache and the merge are each correct in isolation above; this pins the
// thing an owner sees. Dontayvion Wicks (16195) was signed as a plain free
// agent at 2026-09-09T02:59:05Z — a string the parser has always read
// correctly — and still had no contract-length control, because the acquisition
// was not in the build-time feed and there was no live path to find it in.
// Parsing and freshness are separate halves of the same bug.

describe('a live acquisition missing from the static feed', () => {
  it('becomes new-acquisition eligible once merged in', async () => {
    const { parseTransactions, getPlayerEligibility } = await import('../src/utils/contract-eligibility');

    const staticFeed: MFLRawTransaction[] = [
      // The feed as the cron last committed it: everything predates the signing.
      { type: 'FREE_AGENT', franchise: '0015', timestamp: '1788700000', transaction: '15332,|' },
    ];
    const live: MFLRawTransaction[] = [
      { type: 'FREE_AGENT', franchise: '0015', timestamp: '1788922745', transaction: '16195,|' },
    ];
    const roster = { id: '16195', salary: '500000.00', contractYear: '1', contractInfo: '', status: 'ROSTER' };
    const info = { id: '16195', name: 'Wicks, Dontayvion', position: 'WR', team: 'PHI', draft_year: '2023' };
    const now = new Date('2026-09-09T04:00:00Z');

    const withoutLive = getPlayerEligibility(
      '16195', '0015', roster, parseTransactions(staticFeed), info, 2026, now,
    );
    expect(withoutLive.eligible).toBe(false);

    const withLive = getPlayerEligibility(
      '16195', '0015', roster,
      parseTransactions(mergeTransactionRows(staticFeed, live)),
      info, 2026, now,
    );
    expect(withLive.eligible).toBe(true);
    expect(withLive.declarationType).toBe('new-acquisition');
    expect(withLive.deadlineTimestamp).toBe(1788922745 + 24 * 60 * 60);
  });
});

// --- MFL answers errors with HTTP 200 ---
//
// The repo rule (CLAUDE.md, lineups): res.ok is not "the call worked", and
// "nothing happened" must never merge with "couldn't read it". Here the two
// merging has a specific cost — an error body read as a quiet three days is
// cached as [] with a fresh timestamp, and because [] is truthy the
// `fresh ?? cached` fallback never fires, so a good list is evicted for the
// whole TTL exactly when MFL is already struggling.

describe('an MFL error body served as HTTP 200', () => {
  const errorBody = { error: 'An error has occurred - probably caused by one or more invalid parameters.' };

  beforeEach(() => {
    getRedis.mockReset();
    vi.unstubAllGlobals();
  });

  it('keeps serving the last good list instead of caching an empty one over it', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [row()], fetchedAt: Date.now() - 10 * 60 * 1000 }),
      set,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => errorBody }));

    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([row()]);
    expect(set, 'an error body must never be written to the cache').not.toHaveBeenCalled();
  });

  it('handles the {$t} error shape too', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [row()], fetchedAt: Date.now() - 10 * 60 * 1000 }),
      set,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { $t: 'Invalid league' } }),
    }));

    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([row()]);
    expect(set).not.toHaveBeenCalled();
  });

  it('treats a response with no transactions key as unreadable, not empty', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    getRedis.mockResolvedValue({
      get: async () => ({ transactions: [row()], fetchedAt: Date.now() - 10 * 60 * 1000 }),
      set,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([row()]);
    expect(set).not.toHaveBeenCalled();
  });

  it('still caches a genuinely quiet stretch — transactions present, no rows', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    getRedis.mockResolvedValue({ get: async () => null, set });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: {} }),
    }));

    expect(await getCachedRecentTransactions('2026', '13522')).toEqual([]);
    expect(set, 'a real empty stretch is cacheable').toHaveBeenCalled();
  });
});
