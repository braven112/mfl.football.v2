import { describe, it, expect } from 'vitest';
import {
  ownersPollBallotsKey,
  ownersPollCurrentKey,
  resolveBallotWindow,
  validateBallot,
  buildBallotRecord,
  parseStoredBallot,
  parseStoredWindow,
} from '../src/utils/owners-poll-ballot.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const SLOTS = 7;
const OK = ['0001', '0002', '0003', '0004', '0005', '0006', '0007'];

describe('KV keys', () => {
  it('always carries the league scope — there is no bare form', () => {
    // Both leagues have a franchise 0001, so an unscoped key is genuinely
    // ambiguous. Unlike rankings-scope's scopedKvKey, this has no legacy
    // TheLeague exception to preserve.
    expect(ownersPollBallotsKey('theleague', 2026, 5)).toBe('poll:theleague:2026-w5');
    expect(ownersPollBallotsKey('afl', 2026, 5)).toBe('poll:afl:2026-w5');
    expect(ownersPollCurrentKey('theleague')).toBe('poll:theleague:current');
  });

  it('never lets two leagues collide on one key', () => {
    expect(ownersPollBallotsKey('theleague', 2026, 5)).not.toBe(
      ownersPollBallotsKey('afl', 2026, 5),
    );
  });

  it('throws rather than building a key from junk', () => {
    // Failing loudly beats writing to `poll:undefined:...`.
    expect(() => ownersPollBallotsKey('', 2026, 5)).toThrow();
    expect(() => ownersPollBallotsKey('the league', 2026, 5)).toThrow();
    expect(() => ownersPollBallotsKey('theleague', 2026, 0)).toThrow();
    expect(() => ownersPollBallotsKey('theleague', 2026, 99)).toThrow();
    expect(() => ownersPollBallotsKey('theleague', 1999, 5)).toThrow();
    expect(() => ownersPollCurrentKey(undefined as unknown as string)).toThrow();
  });

  it('uses a scope segment every configured league can supply', () => {
    for (const league of Object.values(LEAGUES)) {
      expect(() => ownersPollCurrentKey(league.navSlug)).not.toThrow();
    }
  });
});

describe('validateBallot', () => {
  it('accepts a well-formed ballot and returns normalized ids', () => {
    const result = validateBallot({
      ranking: ['1', '2', '3', '4', '5', '6', '7'],
      slots: SLOTS,
      eligibleFranchiseIds: FIELD,
    });
    expect(result).toEqual({ ok: true, ranking: OK });
  });

  it('requires exactly `slots` teams — short and long both fail', () => {
    // Exact, not minimum: Borda assumes an identical point pool per ballot,
    // so a short ballot is a differently-weighted opinion, not a smaller one.
    expect(validateBallot({ ranking: OK.slice(0, 6), slots: SLOTS, eligibleFranchiseIds: FIELD }).ok).toBe(false);
    expect(validateBallot({ ranking: [...OK, '0008'], slots: SLOTS, eligibleFranchiseIds: FIELD }).ok).toBe(false);
  });

  it('rejects a duplicated team', () => {
    const result = validateBallot({
      ranking: ['0001', '0001', '0003', '0004', '0005', '0006', '0007'],
      slots: SLOTS,
      eligibleFranchiseIds: FIELD,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only appear once/i);
  });

  it('rejects a franchise from another league', () => {
    const result = validateBallot({
      ranking: ['0099', '0002', '0003', '0004', '0005', '0006', '0007'],
      slots: SLOTS,
      eligibleFranchiseIds: FIELD,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in this league/i);
  });

  it('rejects non-id entries and non-array input', () => {
    expect(validateBallot({ ranking: 'nope', slots: SLOTS, eligibleFranchiseIds: FIELD }).ok).toBe(false);
    expect(
      validateBallot({
        ranking: [{ fid: '0001' }, '0002', '0003', '0004', '0005', '0006', '0007'],
        slots: SLOTS,
        eligibleFranchiseIds: FIELD,
      }).ok,
    ).toBe(false);
  });

  it('refuses when the league has no slots or no eligible field', () => {
    expect(validateBallot({ ranking: OK, slots: 0, eligibleFranchiseIds: FIELD }).ok).toBe(false);
    expect(validateBallot({ ranking: OK, slots: SLOTS, eligibleFranchiseIds: [] }).ok).toBe(false);
  });
});

describe('resolveBallotWindow', () => {
  const window = { opensAt: '2026-09-08T14:00:00Z', closesAt: '2026-09-10T01:00:00Z' };

  it('reports pending, open and closed across the window', () => {
    expect(resolveBallotWindow(Date.parse('2026-09-08T13:59:00Z'), window)).toBe('pending');
    expect(resolveBallotWindow(Date.parse('2026-09-09T12:00:00Z'), window)).toBe('open');
    expect(resolveBallotWindow(Date.parse('2026-09-10T01:00:00Z'), window)).toBe('closed');
  });

  it('is inclusive at open and exclusive at close', () => {
    expect(resolveBallotWindow(Date.parse(window.opensAt), window)).toBe('open');
    expect(resolveBallotWindow(Date.parse(window.closesAt), window)).toBe('closed');
  });

  it('fails CLOSED on anything malformed', () => {
    // An unparseable window must never accept writes.
    expect(resolveBallotWindow(Date.now(), null)).toBe('closed');
    expect(resolveBallotWindow(Date.now(), { opensAt: 'x', closesAt: 'y' })).toBe('closed');
    expect(resolveBallotWindow(NaN, window)).toBe('closed');
    expect(
      resolveBallotWindow(Date.parse('2026-09-09T12:00:00Z'), {
        opensAt: window.closesAt,
        closesAt: window.opensAt,
      }),
    ).toBe('closed');
  });

  it('accepts a Date as well as an epoch', () => {
    expect(resolveBallotWindow(new Date('2026-09-09T12:00:00Z'), window)).toBe('open');
  });
});

describe('buildBallotRecord', () => {
  it('preserves submittedAt across an edit and moves updatedAt', () => {
    const first = buildBallotRecord({
      franchiseId: '1',
      ranking: OK,
      now: new Date('2026-09-08T15:00:00Z'),
      previous: null,
    });
    expect(first.franchiseId).toBe('0001');
    expect(first.submittedAt).toBe('2026-09-08T15:00:00.000Z');
    expect(first.updatedAt).toBe(first.submittedAt);

    const edited = buildBallotRecord({
      franchiseId: '0001',
      ranking: OK,
      now: new Date('2026-09-09T20:00:00Z'),
      previous: first,
    });
    // A re-submission must not look like a fresh ballot.
    expect(edited.submittedAt).toBe(first.submittedAt);
    expect(edited.updatedAt).toBe('2026-09-09T20:00:00.000Z');
  });
});

describe('parseStoredBallot', () => {
  const opts = { slots: SLOTS, eligibleFranchiseIds: FIELD };
  const record = {
    franchiseId: '0001',
    ranking: OK,
    submittedAt: '2026-09-08T15:00:00.000Z',
    updatedAt: '2026-09-08T15:00:00.000Z',
  };

  it('reads a stored record, as an object or a JSON string', () => {
    expect(parseStoredBallot(record, opts)?.ranking).toEqual(OK);
    expect(parseStoredBallot(JSON.stringify(record), opts)?.ranking).toEqual(OK);
  });

  it('DROPS a ballot that no longer validates rather than repairing it', () => {
    // Padding or truncating would put an opinion nobody cast into the tally.
    expect(parseStoredBallot({ ...record, ranking: OK.slice(0, 5) }, opts)).toBeNull();
    expect(parseStoredBallot({ ...record, ranking: [...OK.slice(0, 6), '0099'] }, opts)).toBeNull();
    expect(parseStoredBallot({ ...record, franchiseId: '0099' }, opts)).toBeNull();
  });

  it('drops junk without throwing', () => {
    expect(parseStoredBallot('not json', opts)).toBeNull();
    expect(parseStoredBallot(null, opts)).toBeNull();
    expect(parseStoredBallot(42, opts)).toBeNull();
  });
});

describe('parseStoredWindow', () => {
  const window = {
    year: 2026,
    week: 5,
    opensAt: '2026-09-08T14:00:00Z',
    closesAt: '2026-09-10T01:00:00Z',
    slots: SLOTS,
    eligibleFranchiseIds: FIELD,
  };

  it('reads a well-formed pointer', () => {
    const parsed = parseStoredWindow(window);
    expect(parsed?.week).toBe(5);
    expect(parsed?.eligibleFranchiseIds).toHaveLength(16);
  });

  it('returns null for anything malformed — "no ballot is open" is the safe read', () => {
    expect(parseStoredWindow(null)).toBeNull();
    expect(parseStoredWindow('{')).toBeNull();
    expect(parseStoredWindow({ ...window, week: 0 })).toBeNull();
    expect(parseStoredWindow({ ...window, opensAt: 'nope' })).toBeNull();
    expect(parseStoredWindow({ ...window, eligibleFranchiseIds: [] })).toBeNull();
  });

  it('rejects a ballot depth that is not smaller than the field', () => {
    // slots >= field size would make "top N" the whole league, and the
    // unranked block a contradiction.
    expect(parseStoredWindow({ ...window, slots: 16 })).toBeNull();
    expect(parseStoredWindow({ ...window, slots: 0 })).toBeNull();
  });

  it('dedupes and normalizes the eligible field', () => {
    const parsed = parseStoredWindow({
      ...window,
      eligibleFranchiseIds: ['1', '0001', '2', '3', '4', '5', '6', '7', '8'],
    });
    expect(parsed?.eligibleFranchiseIds).toEqual([
      '0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008',
    ]);
  });
});

describe('registry config', () => {
  it('gives every league an ownersPoll block, so components never branch on undefined', () => {
    for (const [slug, league] of Object.entries(LEAGUES)) {
      expect(league.ownersPoll, `${slug} is missing ownersPoll`).toBeDefined();
      expect(typeof league.ownersPoll.enabled).toBe('boolean');
    }
  });

  it('runs the poll in TheLeague only for v1', () => {
    const enabled = Object.entries(LEAGUES)
      .filter(([, l]) => l.ownersPoll.enabled)
      .map(([slug]) => slug);
    expect(enabled).toEqual(['theleague']);
  });

  it('keeps ballot depth below the field size wherever the poll is enabled', () => {
    // slots >= field size makes "rank your top N" the whole league and the
    // unranked block a contradiction. This is the guard that catches a future
    // league being enabled with a copy-pasted depth.
    for (const [slug, league] of Object.entries(LEAGUES)) {
      if (!league.ownersPoll.enabled) continue;
      const fieldSize = league.slug === 'theleague' ? 16 : null;
      expect(league.ownersPoll.slots).toBeGreaterThan(0);
      expect(league.ownersPoll.quorum).toBeGreaterThan(0);
      if (fieldSize) {
        expect(league.ownersPoll.slots, `${slug} slots`).toBeLessThan(fieldSize);
        expect(league.ownersPoll.quorum, `${slug} quorum`).toBeLessThanOrEqual(fieldSize);
      }
    }
  });

  it('pins TheLeague at the decided 7 slots / 8 quorum, closing Thursday', () => {
    // Thursday, not Wednesday: the deadline rides the one owners already obey
    // (lineups before the first kickoff) rather than competing with it.
    expect(LEAGUES.theleague.ownersPoll).toMatchObject({
      enabled: true,
      slots: 7,
      quorum: 8,
      closeWeekday: 4,
      closeHourPT: 16,
    });
  });
});
