/**
 * Season accountability math (src/utils/owners-poll-voters.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  computeVoterSeason,
  sortByAccuracy,
  topHomer,
  topContrarian,
  type VoterIssue,
} from '../src/utils/owners-poll-voters';

const FIELD = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'];

/** An issue whose column ranks the field in the given order. */
function issue(
  week: number,
  order: string[],
  ballots?: Array<{ franchiseId: string; ranking: string[]; contrarianIndex?: number; homerIndex?: number }>,
  over: Partial<NonNullable<VoterIssue['ownersPoll']>> = {},
): VoterIssue {
  return {
    year: 2026,
    week,
    rankings: order.map((franchiseId, i) => ({ franchiseId, rank: i + 1 })),
    ownersPoll: ballots
      ? {
          status: 'closed',
          hasQuorum: true,
          slots: 4,
          ballotsIn: ballots.length,
          eligibleVoters: FIELD.length,
          ballots: ballots.map((b) => ({
            franchiseId: b.franchiseId,
            ranking: b.ranking,
            contrarianIndex: b.contrarianIndex ?? 0,
            homerIndex: b.homerIndex ?? 0,
          })),
          ...over,
        }
      : null,
  };
}

describe('computeVoterSeason', () => {
  it('scores accuracy against the FOLLOWING week, not the same week', () => {
    // Week 1's column says 1,2,3,4. Week 2's says 4,3,2,1 — a total inversion.
    // A ballot that copied week 1 should therefore score 0, not 100%.
    const copier = { franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] };
    const seer = { franchiseId: '0002', ranking: ['0004', '0003', '0002', '0001'] };

    const season = computeVoterSeason(
      [
        issue(1, ['0001', '0002', '0003', '0004'], [copier, seer]),
        issue(2, ['0004', '0003', '0002', '0001']),
      ],
      FIELD,
    );

    const byId = Object.fromEntries(season.voters.map((v) => [v.franchiseId, v]));
    expect(byId['0001'].accuracyPct).toBe(0);
    expect(byId['0002'].accuracyPct).toBe(1);
  });

  it('counts every eligible owner, including those who never voted', () => {
    // A leaderboard that omits the no-shows measures the wrong thing.
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [{ franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] }]),
        issue(2, FIELD),
      ],
      FIELD,
    );
    expect(season.voters).toHaveLength(FIELD.length);
    const silent = season.voters.find((v) => v.franchiseId === '0008')!;
    expect(silent.ballotsCast).toBe(0);
    expect(silent.accuracyPct).toBeNull();
    expect(silent.weeks).toEqual([
      { week: 1, voted: false, accuracyPct: null, contrarianIndex: null, homerIndex: null },
    ]);
  });

  it('excludes no-quorum weeks entirely', () => {
    // With no consensus there is nothing to measure a ballot against.
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [{ franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] }], {
          hasQuorum: false,
        }),
        issue(2, FIELD),
      ],
      FIELD,
    );
    expect(season.weeks).toEqual([]);
    expect(season.voters.every((v) => v.ballotsCast === 0)).toBe(true);
  });

  it('leaves the latest week unscored until the next column exists', () => {
    const season = computeVoterSeason(
      [issue(1, FIELD, [{ franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] }])],
      FIELD,
    );
    expect(season.unscoredWeeks).toEqual([1]);
    expect(season.voters.find((v) => v.franchiseId === '0001')!.accuracyPct).toBeNull();
    // Participation still counts — the ballot was cast.
    expect(season.voters.find((v) => v.franchiseId === '0001')!.ballotsCast).toBe(1);
  });

  it('pools pairs across weeks rather than averaging weekly percentages', () => {
    // Week 1: 4 ranked, all correct (6 pairs). Week 2: all wrong (6 pairs).
    // Pooled = 6/12 = 50%. A naive mean of 100% and 0% is also 50% here, so
    // the assertion that matters is the PAIR COUNT being carried through.
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [{ franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] }]),
        issue(2, ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'], [
          { franchiseId: '0001', ranking: ['0004', '0003', '0002', '0001'] },
        ]),
        issue(3, ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']),
      ],
      FIELD,
    );
    const row = season.voters.find((v) => v.franchiseId === '0001')!;
    expect(row.accuracyPairs).toBe(12);
    expect(row.accuracyPct).toBeCloseTo(0.5, 6);
  });

  it('averages contrarian and homer across the weeks a voter actually voted', () => {
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [
          { franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'], contrarianIndex: 2, homerIndex: 4 },
        ]),
        issue(2, FIELD, [
          { franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'], contrarianIndex: 4, homerIndex: 0 },
        ]),
        issue(3, FIELD),
      ],
      FIELD,
    );
    const row = season.voters.find((v) => v.franchiseId === '0001')!;
    expect(row.contrarianIndex).toBe(3);
    expect(row.homerIndex).toBe(2);
  });

  it('reports turnout as a rate across polled weeks', () => {
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [
          { franchiseId: '0001', ranking: ['0001', '0002', '0003', '0004'] },
          { franchiseId: '0002', ranking: ['0001', '0002', '0003', '0004'] },
        ]),
        issue(2, FIELD),
      ],
      FIELD,
    );
    expect(season.totalBallots).toBe(2);
    expect(season.turnoutRate).toBeCloseTo(2 / 8, 6);
  });

  it('ignores a ballot from a franchise no longer in the league', () => {
    const season = computeVoterSeason(
      [
        issue(1, FIELD, [{ franchiseId: '0099', ranking: ['0001', '0002', '0003', '0004'] }]),
        issue(2, FIELD),
      ],
      FIELD,
    );
    expect(season.voters.some((v) => v.franchiseId === '0099')).toBe(false);
    expect(season.totalBallots).toBe(1); // the issue's own count is untouched
  });
});

describe('sortByAccuracy', () => {
  it('sorts measured voters above unmeasured ones regardless of participation', () => {
    // Floating an unmeasured owner above a measured one would misrepresent
    // what the table claims to rank.
    const rows = [
      { franchiseId: 'A', accuracyPct: null, ballotsCast: 9 },
      { franchiseId: 'B', accuracyPct: 0.5, ballotsCast: 1 },
    ] as any;
    expect(sortByAccuracy(rows).map((r) => r.franchiseId)).toEqual(['B', 'A']);
  });

  it('breaks an accuracy tie on ballots cast', () => {
    const rows = [
      { franchiseId: 'A', accuracyPct: 0.7, ballotsCast: 2 },
      { franchiseId: 'B', accuracyPct: 0.7, ballotsCast: 9 },
    ] as any;
    expect(sortByAccuracy(rows).map((r) => r.franchiseId)).toEqual(['B', 'A']);
  });
});

describe('topHomer / topContrarian', () => {
  const rows = [
    { franchiseId: 'A', homerIndex: 3, contrarianIndex: 1 },
    { franchiseId: 'B', homerIndex: -2, contrarianIndex: 5 },
  ] as any;

  it('picks the highest of each', () => {
    expect(topHomer(rows)!.franchiseId).toBe('A');
    expect(topContrarian(rows)!.franchiseId).toBe('B');
  });

  it('has no homer when nobody rates themselves above the room', () => {
    expect(topHomer([{ franchiseId: 'B', homerIndex: -2 }] as any)).toBeNull();
  });
});
