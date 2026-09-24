/**
 * The roster page's contract-declaration eligibility wiring
 * (src/utils/rosters/eligibility.ts).
 *
 * Extracted in Phase 7 from ~105 lines of frontmatter. The ENGINE
 * (`getTeamEligibility`) has always had tests; what had none was the wiring
 * that decides what it is fed — and per the contracts-eligibility rules, that
 * wiring is where this feature fails silently. A player the engine never sees
 * renders as plain contract years with no "Declare Contract" action: a no-op,
 * never an error.
 *
 * So these cases are about INPUTS, not about eligibility maths:
 *
 * - Live transactions layered over the build-time feed. Without them a claim
 *   processed after the last sync is invisible, and a declaration window is
 *   only 24 hours in season.
 * - The Redis roster snapshot preferred over the static feed, which can be
 *   ~20 minutes behind — long enough for a freshly-acquired rookie to still
 *   carry empty contractInfo and never light up the rookie override.
 * - MFL's single-object-vs-array shape, in both the feed and the overlay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getTeamEligibility = vi.fn();
const mergeTransactionRows = vi.fn();

vi.mock('../src/utils/contract-eligibility', () => ({
  getTeamEligibility: (...a: unknown[]) => getTeamEligibility(...a),
}));
vi.mock('../src/utils/mfl-transactions-cache', () => ({
  mergeTransactionRows: (...a: unknown[]) => mergeTransactionRows(...a),
}));

const { resolveEligibility } = await import('../src/utils/rosters/eligibility');

const eligiblePlayer = (over: Record<string, unknown> = {}) => ({
  playerId: '11111',
  eligible: true,
  declarationType: 'extension',
  yearOptions: [2, 3],
  deadlineTimestamp: 1_700_000_000,
  isExpired: false,
  currentYears: 1,
  currentSalary: 500_000,
  contractInfo: '',
  isRookieContract: false,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  eligibilityYear: 2026,
  isCurrentLeagueYear: true,
  staticTransactions: [{ type: 'BBID_WAIVER', transaction: '11111,|500000|' }],
  liveTransactions: [{ type: 'FREE_AGENT', transaction: '22222,|300000|' }],
  playersFeed: { '11111': { id: '11111', position: 'WR' } },
  staticFranchises: [{ id: '0001', player: [{ id: '11111', salary: '500000' }] }],
  cachedRosterPlayers: null,
  frozenSalaryAverages: { extensionSalaries: { WR: 4_000_000 } },
  now: new Date('2026-09-23T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  getTeamEligibility.mockReset();
  mergeTransactionRows.mockReset();
  mergeTransactionRows.mockImplementation((a: unknown[], b: unknown[] | null) => [
    ...(a ?? []), ...(b ?? []),
  ]);
  getTeamEligibility.mockReturnValue({ players: [eligiblePlayer()] });
});

describe('what the engine is fed', () => {
  it('layers live transactions over the build-time feed', () => {
    resolveEligibility(input());

    expect(mergeTransactionRows).toHaveBeenCalledWith(
      [{ type: 'BBID_WAIVER', transaction: '11111,|500000|' }],
      [{ type: 'FREE_AGENT', transaction: '22222,|300000|' }],
    );
    // Both rows reach the engine — a claim processed since the last sync is
    // exactly the case a 24-hour declaration window cannot afford to miss.
    expect(getTeamEligibility.mock.calls[0][2]).toHaveLength(2);
  });

  it('ignores the live overlay for a historical year', () => {
    resolveEligibility(input({ isCurrentLeagueYear: false }));
    // Last year's page must not have this year's transactions layered in.
    expect(mergeTransactionRows).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('prefers the Redis roster snapshot over the static feed', () => {
    const out = resolveEligibility(input({
      cachedRosterPlayers: {
        '11111': { franchiseId: '0001', salary: '500000', contractYear: '1', contractInfo: 'RC', status: 'ROSTER' },
        '33333': { franchiseId: '0002', salary: '900000', contractYear: '2', contractInfo: '', status: 'ROSTER' },
      },
    }));

    expect(out.usedLiveRosters).toBe(true);
    // Two franchises from the snapshot, not the one the static feed carries —
    // the static feed lags ~20 min, which is how a fresh rookie's override
    // stays dark.
    expect(out.franchises.map((f) => f.id)).toEqual(['0001', '0002']);
    expect(getTeamEligibility).toHaveBeenCalledTimes(2);
  });

  it('falls back to the static feed when Redis has nothing', () => {
    const out = resolveEligibility(input({ cachedRosterPlayers: null }));
    expect(out.usedLiveRosters).toBe(false);
    expect(out.franchises.map((f) => f.id)).toEqual(['0001']);
  });

  it('does not use a live snapshot for a historical year', () => {
    const out = resolveEligibility(input({
      isCurrentLeagueYear: false,
      cachedRosterPlayers: { '11111': { franchiseId: '0009' } },
    }));
    expect(out.usedLiveRosters).toBe(false);
    expect(out.franchises.map((f) => f.id)).toEqual(['0001']);
  });

  it('accepts MFL’s single-player-as-object shape', () => {
    // MFL serves one player as an object and many as an array; array-wrapping
    // the object is what keeps a one-player franchise from vanishing.
    resolveEligibility(input({
      staticFranchises: [{ id: '0001', player: { id: '11111', salary: '500000' } }],
    }));
    expect(getTeamEligibility.mock.calls[0][1]).toEqual([{ id: '11111', salary: '500000' }]);
  });

  it('drops rows with no player id rather than passing them through', () => {
    resolveEligibility(input({
      staticFranchises: [{ id: '0001', player: [{ id: '11111' }, { salary: '1' }, null] }],
    }));
    expect(getTeamEligibility.mock.calls[0][1]).toEqual([{ id: '11111' }]);
  });

  it('passes the league year, clock and frozen averages straight through', () => {
    const now = new Date('2026-09-23T00:00:00Z');
    resolveEligibility(input({ now }));
    const [, , , playersMap, year, clock, averages] = getTeamEligibility.mock.calls[0];
    expect(year).toBe(2026);
    expect(clock).toBe(now);
    expect(averages).toEqual({ extensionSalaries: { WR: 4_000_000 } });
    expect(playersMap.get('11111')).toEqual({ id: '11111', position: 'WR' });
  });
});

describe('what the client is given', () => {
  it('keeps only eligible players, and only the fields the UI needs', () => {
    getTeamEligibility.mockReturnValue({
      players: [
        eligiblePlayer({ playerId: '11111', tagSalary: 9_000_000 }),
        eligiblePlayer({ playerId: '22222', eligible: false }),
      ],
    });

    const { eligibilityByTeam } = resolveEligibility(input());

    expect(Object.keys(eligibilityByTeam['0001'])).toEqual(['11111']);
    expect(eligibilityByTeam['0001']['11111'].tagSalary).toBe(9_000_000);
    // Absent extras stay absent rather than serializing as undefined.
    expect('extensionSalary' in eligibilityByTeam['0001']['11111']).toBe(false);
  });

  it('omits a team with nothing to declare, rather than an empty object', () => {
    getTeamEligibility.mockReturnValue({ players: [eligiblePlayer({ eligible: false })] });
    const { eligibilityByTeam } = resolveEligibility(input());
    // The client checks presence; an empty object would read as "has some".
    expect(eligibilityByTeam).toEqual({});
  });

  it('skips a franchise with no id instead of keying on undefined', () => {
    const out = resolveEligibility(input({
      staticFranchises: [{ player: [{ id: '11111' }] }, { id: '0002', player: [{ id: '11111' }] }],
    }));
    expect(Object.keys(out.eligibilityByTeam)).toEqual(['0002']);
  });
});
