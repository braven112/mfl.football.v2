import { describe, it, expect } from 'vitest';
import {
  bordaPoints,
  ballotPointPool,
  tallyOwnersPoll,
  consensusRankMap,
  pairwiseAccuracy,
  contrarianIndex,
  homerIndex,
} from '../scripts/lib/owners-poll-math.mjs';

/** A 16-team field, matching TheLeague. */
const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const SLOTS = 7;

/** Composite ranks 1..16 in franchise order, so ties resolve predictably. */
const COMPOSITE = Object.fromEntries(FIELD.map((fid, i) => [fid, i + 1]));

const ballot = (franchiseId: string, ranking: string[]) => ({ franchiseId, ranking });

function tally(ballots: Array<{ franchiseId: string; ranking: string[] }>, quorum = 1) {
  return tallyOwnersPoll({
    ballots,
    eligibleFranchiseIds: FIELD,
    slots: SLOTS,
    quorum,
    compositeRankByFid: COMPOSITE,
  });
}

describe('bordaPoints', () => {
  it('pays slots points for 1st down to 1 for last slot', () => {
    expect(bordaPoints(1, 7)).toBe(7);
    expect(bordaPoints(4, 7)).toBe(4);
    expect(bordaPoints(7, 7)).toBe(1);
  });

  it('pays nothing outside the ballot', () => {
    expect(bordaPoints(8, 7)).toBe(0);
    expect(bordaPoints(0, 7)).toBe(0);
    expect(bordaPoints(1.5 as unknown as number, 7)).toBe(0);
  });

  it('gives every ballot an identical point pool', () => {
    // This is the fairness property the whole tally rests on: no voter can
    // buy influence by ranking differently.
    expect(ballotPointPool(7)).toBe(28);
    const spent = [1, 2, 3, 4, 5, 6, 7].reduce((sum, slot) => sum + bordaPoints(slot, 7), 0);
    expect(spent).toBe(ballotPointPool(7));
  });
});

describe('tallyOwnersPoll', () => {
  it('ranks by total Borda points', () => {
    const result = tally([
      ballot('0001', ['0002', '0003', '0004', '0005', '0006', '0007', '0008']),
      ballot('0002', ['0003', '0002', '0004', '0005', '0006', '0007', '0008']),
    ]);
    // 0002: 7 + 6 = 13. 0003: 6 + 7 = 13. Tie on points, broken below.
    // 0004: 5 + 5 = 10.
    expect(result.ranked!.map((r) => r.franchiseId).slice(0, 3)).toEqual(['0002', '0003', '0004']);
    expect(result.ranked![0].points).toBe(13);
    expect(result.ranked![2].points).toBe(10);
  });

  it('breaks a points tie on first-place votes, then on the composite', () => {
    // 0002 and 0003 both finish on 13; 0002 has one 1st, 0003 has one 1st too,
    // so it falls through to the composite (0002 is ranked ahead of 0003).
    const evenTie = tally([
      ballot('0001', ['0002', '0003', '0004', '0005', '0006', '0007', '0008']),
      ballot('0002', ['0003', '0002', '0004', '0005', '0006', '0007', '0008']),
    ]);
    expect(evenTie.ranked![0].franchiseId).toBe('0002');

    // Now give 0003 both first-place votes at equal points: it must win the tie
    // despite the composite favoring 0002.
    const firstPlaceWins = tallyOwnersPoll({
      ballots: [
        ballot('0001', ['0003', '0002', '0004', '0005', '0006', '0007', '0008']),
        ballot('0002', ['0003', '0002', '0004', '0005', '0006', '0007', '0008']),
      ],
      eligibleFranchiseIds: FIELD,
      slots: SLOTS,
      quorum: 1,
      compositeRankByFid: COMPOSITE,
    });
    expect(firstPlaceWins.ranked![0].franchiseId).toBe('0003');
    expect(firstPlaceWins.ranked![0].firstPlaceVotes).toBe(2);
  });

  it('puts teams with zero points in the unranked block, ordered by composite', () => {
    const result = tally([
      ballot('0001', ['0001', '0002', '0003', '0004', '0005', '0006', '0007']),
    ]);
    expect(result.ranked).toHaveLength(7);
    // 16-team field, 7 ranked → 9 unranked, in composite order.
    expect(result.unranked).toHaveLength(9);
    expect(result.unranked!.map((r) => r.franchiseId)).toEqual([
      '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016',
    ]);
  });

  it('returns null blocks — not empty ones — below quorum', () => {
    // A caller that forgets to check hasQuorum must crash, not silently render
    // a "consensus" backed by nobody.
    const result = tally([ballot('0001', ['0001', '0002', '0003', '0004', '0005', '0006', '0007'])], 8);
    expect(result.hasQuorum).toBe(false);
    expect(result.ranked).toBeNull();
    expect(result.unranked).toBeNull();
    expect(result.ballotsIn).toBe(1);
    expect(result.eligibleVoters).toBe(16);
  });

  it('reports delta as composite rank minus poll rank', () => {
    // 0016 is last by the composite but unanimous #1 with the owners.
    const result = tally([
      ballot('0001', ['0016', '0002', '0003', '0004', '0005', '0006', '0007']),
    ]);
    const top = result.ranked![0];
    expect(top.franchiseId).toBe('0016');
    expect(top.compositeRank).toBe(16);
    expect(top.delta).toBe(15);
  });

  it('ignores a franchise id that is not in this league', () => {
    // Both leagues number from 0001, so a stray id is a real hazard, not a typo.
    const result = tally([
      ballot('0001', ['9999', '0002', '0003', '0004', '0005', '0006', '0007']),
    ]);
    expect(result.ranked!.some((r) => r.franchiseId === '9999')).toBe(false);
    // The 7 points that would have gone to 9999 simply aren't awarded.
    expect(result.ranked!.reduce((s, r) => s + r.points, 0)).toBe(28 - 7);
  });

  it('normalizes unpadded franchise ids on both sides', () => {
    const result = tallyOwnersPoll({
      ballots: [ballot('1', ['2', '3', '4', '5', '6', '7', '8'])],
      eligibleFranchiseIds: FIELD,
      slots: SLOTS,
      quorum: 1,
      compositeRankByFid: COMPOSITE,
    });
    expect(result.ranked![0].franchiseId).toBe('0002');
    expect(result.ranked![0].points).toBe(7);
  });

  it('tracks how many ballots ranked a team and their average slot', () => {
    const result = tally([
      ballot('0001', ['0002', '0003', '0004', '0005', '0006', '0007', '0008']),
      ballot('0002', ['0009', '0010', '0011', '0012', '0013', '0014', '0002']),
    ]);
    const row = result.ranked!.find((r) => r.franchiseId === '0002')!;
    expect(row.ballotsRanking).toBe(2);
    expect(row.avgBallotRank).toBe(4); // slots 1 and 7
  });
});

describe('consensusRankMap', () => {
  it('continues numbering through the unranked block', () => {
    const result = tally([
      ballot('0001', ['0001', '0002', '0003', '0004', '0005', '0006', '0007']),
    ]);
    const map = consensusRankMap(result);
    expect(map.get('0001')).toBe(1);
    expect(map.get('0007')).toBe(7);
    expect(map.get('0008')).toBe(8); // first unranked, by composite
    expect(map.get('0016')).toBe(16);
    expect(map.size).toBe(16);
  });

  it('is empty below quorum', () => {
    expect(consensusRankMap(tally([], 8)).size).toBe(0);
  });
});

describe('pairwiseAccuracy', () => {
  const ranking = ['0001', '0002', '0003'];

  it('scores every ordered pair the ballot got right', () => {
    const actual = { '0001': 1, '0002': 2, '0003': 3 };
    expect(pairwiseAccuracy(ranking, actual)).toEqual({ pairs: 3, correct: 3, pct: 1 });
  });

  it('scores a fully inverted ballot at zero', () => {
    const actual = { '0001': 3, '0002': 2, '0003': 1 };
    expect(pairwiseAccuracy(ranking, actual)).toEqual({ pairs: 3, correct: 0, pct: 0 });
  });

  it('skips pairs it cannot judge rather than counting them wrong', () => {
    const actual = { '0001': 1, '0002': 2 }; // 0003 missing
    const result = pairwiseAccuracy(ranking, actual);
    expect(result.pairs).toBe(1);
    expect(result.correct).toBe(1);
  });

  it('returns a null pct when nothing could be judged', () => {
    expect(pairwiseAccuracy(ranking, {}).pct).toBeNull();
  });

  it('produces 21 pairs for a 7-slot ballot', () => {
    const full = ['0001', '0002', '0003', '0004', '0005', '0006', '0007'];
    const actual = Object.fromEntries(full.map((fid, i) => [fid, i + 1]));
    expect(pairwiseAccuracy(full, actual).pairs).toBe(21);
  });
});

describe('contrarianIndex', () => {
  it('is zero for a ballot that matches the consensus exactly', () => {
    const consensus = { '0001': 1, '0002': 2, '0003': 3 };
    expect(contrarianIndex(['0001', '0002', '0003'], consensus)).toBe(0);
  });

  it('grows with distance from the consensus', () => {
    const consensus = { '0001': 3, '0002': 2, '0003': 1 };
    // |3-1| + |2-2| + |1-3| = 4 over 3 entries
    expect(contrarianIndex(['0001', '0002', '0003'], consensus)).toBeCloseTo(4 / 3, 6);
  });

  it('is null when the consensus knows none of the ballot', () => {
    expect(contrarianIndex(['0001'], {})).toBeNull();
  });
});

describe('homerIndex', () => {
  // The baseline is the COLUMN's rank, not the room's consensus: the composite
  // is fixed before a ballot is cast, so an owner's score cannot move because
  // other people voted. Distance from the room is contrarianIndex's job.
  it('is positive when an owner ranks themselves above the column', () => {
    // The column has them 12th; they put themselves 1st.
    expect(
      homerIndex({
        franchiseId: '0001',
        ranking: ['0001', '0002', '0003', '0004', '0005', '0006', '0007'],
        compositeRankByFid: { '0001': 12 },
      }),
    ).toBe(11);
  });

  it('is negative when an owner ranks themselves below the column', () => {
    expect(
      homerIndex({
        franchiseId: '0001',
        ranking: ['0002', '0003', '0004', '0005', '0006', '0001', '0007'],
        compositeRankByFid: { '0001': 2 },
      }),
    ).toBe(-4);
  });

  it('does not move when the room changes its mind', () => {
    // Same ballot, same column rank, wildly different consensus around it.
    // Scored against the consensus this owner would swing from modest to homer
    // without touching their own ballot; the consensus is not read at all.
    // (Built as variables rather than inline literals so the deliberately
    // ignored keys are not excess-property errors — see the typecheck ratchet.)
    const ballot = {
      franchiseId: '0001',
      ranking: ['0001', '0002', '0003'],
      compositeRankByFid: { '0001': 4 },
    };
    const roomAdoresThem = { ...ballot, consensusRankByFid: { '0001': 1 } };
    const roomWroteThemOff = { ...ballot, consensusRankByFid: { '0001': 16 } };
    expect(homerIndex(roomAdoresThem)).toBe(3);
    expect(homerIndex(roomWroteThemOff)).toBe(3);
  });

  it('is null when an owner omitted their own team — omission is not a rank', () => {
    // This used to score slots+1, which read as modest at 7-of-16 and became
    // absurd at the AFL's 10-of-24: an owner who left their 24th-ranked team
    // off scored +13 and topped the Homer board for the humblest ballot on it.
    // "Not in my top N" spans most of the field; null says so honestly.
    expect(
      homerIndex({
        franchiseId: '0001',
        ranking: ['0002', '0003', '0004', '0005', '0006', '0007', '0008'],
        compositeRankByFid: { '0001': 10 },
      }),
    ).toBeNull();
  });

  it('is null when the column has no rank for the owner', () => {
    expect(
      homerIndex({
        franchiseId: '0001',
        ranking: ['0001'],
        compositeRankByFid: {},
      }),
    ).toBeNull();
  });

  it('does not depend on slots at all any more', () => {
    // slots was the old omission cap's input. A caller still passing it — the
    // close pass did until this change — must get the same answer.
    const args = {
      franchiseId: '0001',
      ranking: ['0002', '0001', '0003'],
      compositeRankByFid: { '0001': 6 },
    };
    const withShallowBallot = { ...args, slots: 7 };
    const withDeepBallot = { ...args, slots: 10 };
    expect(homerIndex(withShallowBallot)).toBe(4);
    expect(homerIndex(withDeepBallot)).toBe(4);
    expect(homerIndex(args)).toBe(4);
  });
});
