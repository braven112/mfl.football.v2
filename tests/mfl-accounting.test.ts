/**
 * Guard tests for the MFL accounting client.
 *
 * The sign convention is the load-bearing one here: MFL credits on POSITIVE
 * and charges on NEGATIVE, and getting it backwards pays a prize as a bill
 * with no error from MFL to catch it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  creditAmount,
  chargeAmount,
  parseAmount,
  normalizeFranchiseId,
  normalizeAccountingExport,
  validateRecord,
  formatAmount,
} from '../src/utils/mfl-accounting';

describe('sign convention', () => {
  it('credits a prize as a POSITIVE amount', () => {
    // A $300 championship prize must INCREASE the franchise's balance.
    expect(creditAmount(300)).toBe(300);
    expect(creditAmount(-300)).toBe(300);
  });

  it('charges dues as a NEGATIVE amount', () => {
    expect(chargeAmount(100)).toBe(-100);
    expect(chargeAmount(-100)).toBe(-100);
  });
});

describe('parseAmount', () => {
  it('reads currency formatting a commissioner would paste', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('-25')).toBe(-25);
    expect(parseAmount('  42.50 ')).toBe(42.5);
    expect(parseAmount(17)).toBe(17);
  });

  it('reads accounting parentheses as negative', () => {
    // "(50.00)" in a spreadsheet export is a $50 CHARGE, not a $50 credit.
    expect(parseAmount('(50.00)')).toBe(-50);
  });

  it('refuses junk rather than guessing zero', () => {
    // Returning 0 here would write a real ledger line that moves no money.
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('$')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('normalizeFranchiseId', () => {
  it('pads to four digits so "1" is not a different team than "0001"', () => {
    expect(normalizeFranchiseId('1')).toBe('0001');
    expect(normalizeFranchiseId('0015')).toBe('0015');
    expect(normalizeFranchiseId(' 7 ')).toBe('0007');
  });
});

describe('normalizeAccountingExport', () => {
  it('reads the nested franchise/transaction shape', () => {
    const ledger = normalizeAccountingExport({
      accounting: {
        franchise: [
          {
            id: '0001',
            transaction: [
              { amount: '-100.00', description: '2026 dues', timestamp: '1700000000' },
              { amount: '300.00', description: '2025 League Champion', timestamp: '1700000100' },
            ],
          },
        ],
      },
    });
    expect(ledger.balances['0001']).toBe(200);
    expect(ledger.records).toHaveLength(2);
  });

  it('reads the flat transaction shape', () => {
    const ledger = normalizeAccountingExport({
      accounting: {
        transaction: [{ franchise_id: '2', amount: '-50', description: 'fee' }],
      },
    });
    expect(ledger.balances['0002']).toBe(-50);
  });

  it('survives MFL collapsing a one-item list to a bare object', () => {
    // The classic MFL trap: one record comes back unwrapped.
    const ledger = normalizeAccountingExport({
      accounting: {
        franchise: { id: '0003', transaction: { amount: '25', description: 'credit' } },
      },
    });
    expect(ledger.balances['0003']).toBe(25);
    expect(ledger.records).toHaveLength(1);
  });

  it('keeps a stated balance when a franchise reports no transactions', () => {
    // Summary-only payload: balances without records is a legitimate state and
    // must not read as "this franchise is square".
    const ledger = normalizeAccountingExport({
      accounting: { franchise: [{ id: '0004', balance: '-75.00' }] },
    });
    expect(ledger.balances['0004']).toBe(-75);
    expect(ledger.records).toHaveLength(0);
  });

  it('sorts newest first', () => {
    const ledger = normalizeAccountingExport({
      accounting: {
        franchise: [
          {
            id: '0001',
            transaction: [
              { amount: '1', description: 'older', timestamp: '100' },
              { amount: '2', description: 'newer', timestamp: '200' },
            ],
          },
        ],
      },
    });
    expect(ledger.records[0].description).toBe('newer');
  });
});

describe('validateRecord', () => {
  const good = { franchiseId: '0001', amount: -100, description: 'dues' };

  it('accepts a well-formed record', () => {
    expect(validateRecord(good)).toBeNull();
  });

  it('rejects a zero amount', () => {
    // MFL accepts it; it writes a line that moves no money, which is how a
    // mis-parsed column becomes a real-looking transaction.
    expect(validateRecord({ ...good, amount: 0 })).toMatch(/zero/i);
  });

  it('rejects a missing description', () => {
    expect(validateRecord({ ...good, description: '   ' })).toMatch(/required/i);
  });

  it('rejects a non-numeric franchise', () => {
    expect(validateRecord({ ...good, franchiseId: 'Pigskins' })).toMatch(/franchise/i);
  });
});

describe('formatAmount', () => {
  it('keeps the minus outside the dollar sign', () => {
    expect(formatAmount(-100)).toBe('-$100.00');
    expect(formatAmount(45)).toBe('$45.00');
  });
});

/* ── Network-shaped behaviour ───────────────────────────────────────────── */

describe('fetchAccountingLedger', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('treats an empty 200 body as an auth failure, never an empty ledger', async () => {
    vi.doMock('../src/utils/mfl-fetch', () => ({
      mflFetch: async () => new Response('', { status: 200 }),
    }));
    const { fetchAccountingLedger } = await import('../src/utils/mfl-accounting');
    const result = await fetchAccountingLedger({
      leagueId: '13522',
      year: 2026,
      mflUserCookie: 'cookie',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authorized/i);
  });
});

describe('writeAccountingRecord', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  const league = { id: '13522', mflHost: 'www49.myfantasyleague.com' };

  it('rejects an MFL 200 that carries an <error> body', async () => {
    // response.ok is NOT "the write landed" — MFL reports rejections at 200.
    vi.doMock('../src/utils/mfl-fetch', () => ({
      mflFetch: async () => new Response('<error>Not the commissioner</error>', { status: 200 }),
    }));
    const { writeAccountingRecord } = await import('../src/utils/mfl-accounting');
    const result = await writeAccountingRecord(
      { franchiseId: '0001', amount: 300, description: 'prize' },
      { league, year: 2026, mflUserCookie: 'cookie' }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/commissioner/i);
  });

  it('posts a plain decimal amount to the league web host, not the api host', async () => {
    let seenUrl = '';
    let seenBody = '';
    vi.doMock('../src/utils/mfl-fetch', () => ({
      mflFetch: async (opts: any) => {
        seenUrl = opts.url;
        seenBody = opts.body;
        return new Response('<status>OK</status>', { status: 200 });
      },
    }));
    const { writeAccountingRecord } = await import('../src/utils/mfl-accounting');
    const result = await writeAccountingRecord(
      { franchiseId: '1', amount: -100, description: '2026 dues' },
      { league, year: 2026, mflUserCookie: 'cookie', mflCommishCookie: 'commish' }
    );

    expect(result.ok).toBe(true);
    // Commissioner imports are rejected on api.myfantasyleague.com.
    expect(seenUrl).toContain('www49.myfantasyleague.com');
    expect(seenUrl).not.toContain('api.myfantasyleague.com');
    expect(seenUrl).toContain('TYPE=accounting');
    // MFL cannot parse "$" or a thousands comma in AMOUNT.
    expect(seenBody).toContain('AMOUNT=-100.00');
    expect(seenBody).toContain('FRANCHISE=0001');
  });

  it('reports each row of a bulk write separately', async () => {
    let call = 0;
    vi.doMock('../src/utils/mfl-fetch', () => ({
      mflFetch: async () => {
        call += 1;
        return call === 2
          ? new Response('<error>Nope</error>', { status: 200 })
          : new Response('<status>OK</status>', { status: 200 });
      },
    }));
    const { writeAccountingRecords } = await import('../src/utils/mfl-accounting');
    const results = await writeAccountingRecords(
      [
        { franchiseId: '0001', amount: 10, description: 'a' },
        { franchiseId: '0002', amount: 10, description: 'b' },
        { franchiseId: '0003', amount: 10, description: 'c' },
      ],
      { league, year: 2026, mflUserCookie: 'cookie' }
    );
    // A failed row is a failed row, not an aborted batch.
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
