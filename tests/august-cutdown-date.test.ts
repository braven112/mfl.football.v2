/**
 * Cross-checks between the app (.ts) and script (.mjs) halves of the August
 * cuts automation, so the two sides can never drift:
 *
 *  1. getAugustCutdownDate — src/utils/contract-eligibility.ts vs
 *     scripts/lib/august-cutdown.mjs must agree on the exact instant for
 *     2024–2032. (The suite is pinned to America/Los_Angeles by
 *     tests/global-setup-timezone.ts, so the .ts local-time Date and the
 *     .mjs PT-instant Date are directly comparable.)
 *  2. The selection core's mirror constants must equal their canonical .ts
 *     homes (TARGET_ACTIVE_COUNT, ACQUISITION_TYPES).
 *  3. parseAcquisitionEvents (core .mjs) must agree with parseTransactions
 *     (contract-eligibility.ts) on real MFL transaction-string formats.
 *  4. The .ts selectAutoCuts wrapper and the .mjs core must return identical
 *     results for the same input.
 *  5. Credential-envelope helpers (scripts/lib/august-cutdown.mjs) must
 *     decrypt exactly what src/utils/autocut-storage.ts's scheme encrypts,
 *     for both key-derivation paths.
 */
import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { getAugustCutdownDate as appCutdownDate, ACQUISITION_TYPES, parseTransactions } from '../src/utils/contract-eligibility';
import { TARGET_ACTIVE_COUNT } from '../src/utils/salary-calculations';
import { selectAutoCuts as selectAutoCutsTs } from '../src/utils/august-cut-selection';
import { isCredentialFresh as isCredentialFreshTs } from '../src/utils/autocut-storage';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  getAugustCutdownDate as scriptCutdownDate,
  getAugustCutdownWallClock,
  calendarDaysUntilCutdown,
  deriveCredentialKey,
  decryptCredentialRecord,
  isCredentialFresh as isCredentialFreshMjs,
} from '../scripts/lib/august-cutdown.mjs';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  selectAutoCuts as selectAutoCutsCore,
  parseAcquisitionEvents,
  AUGUST_CUT_TARGET,
  AUGUST_CUT_ACQUISITION_TYPES,
} from '../src/utils/august-cut-selection-core.mjs';

const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032];

describe('getAugustCutdownDate — app (.ts) vs script (.mjs) cross-check', () => {
  it.each(YEARS)('%i: both implementations return the same instant', (year) => {
    expect(scriptCutdownDate(year).getTime()).toBe(appCutdownDate(year).getTime());
  });

  it.each(YEARS)('%i: the deadline is a Sunday between Aug 15 and Aug 21 at 8:45 PM', (year) => {
    const wc = getAugustCutdownWallClock(year);
    expect(wc.month).toBe(8);
    expect(wc.day).toBeGreaterThanOrEqual(15);
    expect(wc.day).toBeLessThanOrEqual(21);
    expect(wc.hour).toBe(20);
    expect(wc.minute).toBe(45);
    // Calendar-pure Sunday check (UTC weekday of the pure calendar date).
    expect(new Date(Date.UTC(year, 7, wc.day)).getUTCDay()).toBe(0);
  });

  it('2026 deadline is Sunday Aug 16', () => {
    expect(getAugustCutdownWallClock(2026).day).toBe(16);
  });

  it('2027 deadline is Sunday Aug 15 (regression: the old `|| 7` guard pushed Aug-1-is-Sunday years to the 4th Sunday)', () => {
    expect(getAugustCutdownWallClock(2027).day).toBe(15);
    expect(appCutdownDate(2027).getDate()).toBe(15);
    // 2032 is the next Aug-1-on-Sunday year.
    expect(getAugustCutdownWallClock(2032).day).toBe(15);
  });

  it('script instant is 8:45 PM PDT expressed in UTC (03:45 next day)', () => {
    const d = scriptCutdownDate(2026);
    expect(d.toISOString()).toBe('2026-08-17T03:45:00.000Z'); // Aug 16 20:45 PDT
  });

  it('calendarDaysUntilCutdown is a PT midnight-to-midnight diff (never rounds "tomorrow evening" to 0)', () => {
    // 2026 deadline day is Aug 16. 11 PM PT on Aug 15 is still 1 day out.
    expect(calendarDaysUntilCutdown(2026, new Date('2026-08-15T23:00:00-07:00'))).toBe(1);
    // Deadline-day morning is 0 (the live gate still blocks until 8:45 PM).
    expect(calendarDaysUntilCutdown(2026, new Date('2026-08-16T06:00:00-07:00'))).toBe(0);
    // The day after is negative.
    expect(calendarDaysUntilCutdown(2026, new Date('2026-08-17T06:00:00-07:00'))).toBe(-1);
    // A week out.
    expect(calendarDaysUntilCutdown(2026, new Date('2026-08-09T20:00:00-07:00'))).toBe(7);
  });
});

describe('selection core (.mjs) mirrors of canonical .ts constants', () => {
  it('AUGUST_CUT_TARGET === TARGET_ACTIVE_COUNT', () => {
    expect(AUGUST_CUT_TARGET).toBe(TARGET_ACTIVE_COUNT);
  });

  it('AUGUST_CUT_ACQUISITION_TYPES === ACQUISITION_TYPES', () => {
    expect(AUGUST_CUT_ACQUISITION_TYPES).toEqual(ACQUISITION_TYPES);
  });
});

describe('parseAcquisitionEvents (.mjs) vs parseTransactions (.ts)', () => {
  // Every real MFL transaction-string format from the feeds + insights doc.
  const rawTransactions = [
    { timestamp: '1783996868', type: 'FREE_AGENT', transaction: '|15254,', franchise: '0004' }, // drop-only
    { timestamp: '1783562639', type: 'AUCTION_WON', transaction: '16752|425000|', franchise: '0015' },
    { timestamp: '1783398055', type: 'AUCTION_INIT', transaction: '16752|425000|', franchise: '0015' }, // not an acquisition
    { timestamp: '1783011112', type: 'FREE_AGENT', transaction: '15281|,', franchise: '0007' }, // add-only
    { timestamp: '1783011000', type: 'FREE_AGENT', transaction: '15281|13193,', franchise: '0007' }, // add/drop swap
    { timestamp: '1782000000', type: 'BBID_WAIVER', transaction: '14836,|5000000|13604,', franchise: '0002' },
    { timestamp: '1782000500', type: 'BBID_WAIVER', transaction: '14837,|1|,', franchise: '0002' }, // BBID add-only
    { timestamp: '1781000000', type: 'TRADE', transaction: '13604,|16752,', franchise: '0001' }, // trades NEVER count
    { timestamp: '1780517920', type: 'BBID_AUTO_PROCESS_WAIVERS', transaction: '', franchise: '0000' }, // batch marker
  ] as never[];

  it('produces the same acquisition events (type/franchise/timestamp/addedPlayerIds)', () => {
    const fromCore = parseAcquisitionEvents(rawTransactions);
    const fromTs = parseTransactions(rawTransactions).map((r) => ({
      type: r.type,
      franchise: r.franchise,
      timestamp: r.timestamp,
      addedPlayerIds: r.addedPlayerIds,
    }));
    expect(fromCore).toEqual(fromTs);
    // Sanity: the drop-only, TRADE, AUCTION_INIT, and batch rows were excluded.
    expect(fromCore.map((e: { addedPlayerIds: string[] }) => e.addedPlayerIds[0])).toEqual([
      '16752',
      '15281',
      '15281',
      '14836',
      '14837',
    ]);
  });
});

describe('selectAutoCuts — .ts wrapper vs .mjs core parity', () => {
  it('returns identical results for the same input', () => {
    const input = {
      activeRoster: [
        ...Array.from({ length: 24 }, (_, i) => ({ id: String(i + 1), status: 'ROSTER' })),
        { id: '99', status: 'TAXI_SQUAD' },
      ],
      markedPlayerIds: ['5'],
      acquisitions: [
        { type: 'FREE_AGENT', timestamp: 200, addedPlayerIds: ['7'], franchise: '0001' },
        { type: 'TRADE', timestamp: 300, addedPlayerIds: ['8'], franchise: '0001' },
        { type: 'BBID_WAIVER', timestamp: 100, addedPlayerIds: ['9'], franchise: '0001' },
      ],
      franchiseId: '0001',
    };
    const fromTs = selectAutoCutsTs(input);
    const fromCore = selectAutoCutsCore(input);
    expect(fromCore).toEqual(fromTs);
    // And the shared behavior is right: marked first, then newest non-trade
    // acquisitions (7 @200 before 9 @100; 8's trade record doesn't count).
    expect(fromTs.cuts.map((c) => c.playerId)).toEqual(['5', '7']);
  });
});

describe('credential envelope — script decrypt matches autocut-storage scheme', () => {
  // Mirrors autocut-storage.ts#captureCredential exactly: v2 envelope with the
  // normalized franchise id bound as GCM AAD (item G).
  const FID = '0007';
  function normFid(id: string) {
    const s = String(id ?? '').trim();
    return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
  }
  function encrypt(cookie: string, key: Buffer, franchiseId = FID) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(normFid(franchiseId), 'utf8'));
    const data = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()]);
    return {
      v: 2,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
      capturedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  it('direct path: a 32-byte base64 env value is used as the AES key verbatim', () => {
    const rawKey = randomBytes(32);
    const key = deriveCredentialKey(rawKey.toString('base64'));
    expect(Buffer.compare(key, rawKey)).toBe(0);
    const record = encrypt('cookie-value-abc', rawKey);
    expect(decryptCredentialRecord(record, key, FID)).toEqual({
      cookie: 'cookie-value-abc',
      capturedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('scrypt path: any other env value is stretched with the autocut:cred:v1 salt', () => {
    const passphrase = 'not-a-32-byte-base64-value';
    const expected = scryptSync(passphrase, 'autocut:cred:v1', 32);
    const key = deriveCredentialKey(passphrase);
    expect(Buffer.compare(key, expected)).toBe(0);
    const record = encrypt('cookie-via-scrypt', expected);
    expect(decryptCredentialRecord(record, key, FID)).toEqual({
      cookie: 'cookie-via-scrypt',
      capturedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('binds the envelope to its franchise: A\'s envelope under B\'s id fails decrypt (transplant)', () => {
    const key = deriveCredentialKey(randomBytes(32).toString('base64'));
    const recordForA = encrypt('cookie-for-A', key, '0001');
    // Correct franchise → decrypts.
    expect(decryptCredentialRecord(recordForA, key, '0001')).toEqual({
      cookie: 'cookie-for-A',
      capturedAt: '2026-08-01T00:00:00.000Z',
    });
    // Same key, different franchise AAD → GCM tag fails → treated as missing.
    expect(decryptCredentialRecord(recordForA, key, '0002')).toBeNull();
    // Normalization still matches: '1' addresses the same envelope as '0001'.
    expect(decryptCredentialRecord(recordForA, key, '1')).not.toBeNull();
  });

  it('rejects non-v2 envelopes (fail-closed) and returns null on wrong key/tamper/malformed', () => {
    const key = deriveCredentialKey(randomBytes(32).toString('base64'));
    const otherKey = randomBytes(32);
    const record = encrypt('cookie', otherKey);
    expect(decryptCredentialRecord(record, key, FID)).toBeNull(); // wrong key
    expect(decryptCredentialRecord(null, key, FID)).toBeNull();
    // v1 (legacy) and any other version are rejected fail-closed.
    expect(decryptCredentialRecord({ v: 1, alg: 'aes-256-gcm' }, key, FID)).toBeNull();
    expect(decryptCredentialRecord({ v: 3, alg: 'aes-256-gcm' }, key, FID)).toBeNull();
    expect(decryptCredentialRecord(record, null, FID)).toBeNull();
  });

  it('missing env value yields no key', () => {
    expect(deriveCredentialKey(undefined)).toBeNull();
    expect(deriveCredentialKey('')).toBeNull();
  });

  it('isCredentialFresh matches the .ts implementation', () => {
    const now = new Date('2026-08-16T00:00:00Z');
    const cases: Array<[string | null, number]> = [
      ['2026-08-01T00:00:00Z', 30],
      ['2026-07-01T00:00:00Z', 30],
      ['2026-08-20T00:00:00Z', 30], // future = corrupt
      ['garbage', 30],
      [null, 30],
      ['2026-07-17T00:00:00Z', 30], // exactly 30 days
    ];
    for (const [capturedAt, maxAge] of cases) {
      expect(isCredentialFreshMjs(capturedAt, maxAge, now)).toBe(
        isCredentialFreshTs(capturedAt, maxAge, now),
      );
    }
  });
});
