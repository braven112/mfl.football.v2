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
