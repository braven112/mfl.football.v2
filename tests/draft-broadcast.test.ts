/**
 * Pure logic behind the AFL draft broadcast board.
 *
 * The value meter is the line the room reacts to, so its sign convention and
 * threshold are pinned here — a meter that calls a two-pick wobble a STEAL
 * stops meaning anything, and an inverted sign would celebrate every reach.
 */

import { describe, it, expect } from 'vitest';
import {
  computePickValue,
  formatPickValue,
  findOnTheClock,
  recentPicks,
  upcomingPicks,
  positionRunCount,
  medianRank,
  applyRehearsal,
  VALUE_THRESHOLD_PICKS,
} from '../src/utils/draft-broadcast';
import type { DraftRoomPick } from '../src/types/draft-room';
import type { BroadcastPlayer } from '../src/types/draft-broadcast';

function slot(overall: number, playerId = '', franchiseId = '0001'): DraftRoomPick {
  return {
    round: Math.ceil(overall / 12),
    pickInRound: ((overall - 1) % 12) + 1,
    overallPickNumber: overall,
    franchiseId,
    playerId,
    timestamp: '',
    comments: '',
    isTraded: false,
  };
}

function player(id: string, position: string, adp?: number): BroadcastPlayer {
  return {
    id,
    name: `Player ${id}`,
    position,
    nflTeam: 'KCC',
    headshot: '',
    adpAveragePick: adp,
  } as BroadcastPlayer;
}

describe('computePickValue', () => {
  it('calls a player taken well after his ADP a steal', () => {
    const value = computePickValue(40, player('a', 'RB', 20));
    expect(value.verdict).toBe('steal');
    expect(value.delta).toBe(20);
  });

  it('calls a player taken well before his ADP a reach', () => {
    const value = computePickValue(10, player('a', 'RB', 40));
    expect(value.verdict).toBe('reach');
    // delta is reported absolute — the direction lives in the verdict.
    expect(value.delta).toBe(30);
  });

  it('stays quiet inside the threshold', () => {
    const value = computePickValue(20 + VALUE_THRESHOLD_PICKS - 1, player('a', 'RB', 20));
    expect(value.verdict).toBe('on-script');
  });

  it('reports unknown when the player has no ADP', () => {
    expect(computePickValue(12, player('a', 'RB')).verdict).toBe('unknown');
    expect(computePickValue(12, undefined).verdict).toBe('unknown');
  });

  it('measures against averagePick, not rank', () => {
    // adpRank is an ORDINAL and is deliberately ignored — comparing a rank to a
    // pick number is only coincidentally meaningful.
    const ordinalOnly = { adpRank: 3 } as BroadcastPlayer;
    expect(computePickValue(60, ordinalOnly).verdict).toBe('unknown');
  });
});

describe('formatPickValue', () => {
  it('labels each verdict, and says nothing when there is nothing to say', () => {
    expect(formatPickValue({ verdict: 'steal', delta: 23 })).toContain('STEAL');
    expect(formatPickValue({ verdict: 'reach', delta: 11 })).toContain('REACH');
    expect(formatPickValue({ verdict: 'on-script', delta: 2 })).toBe('RIGHT ON SCRIPT');
    expect(formatPickValue({ verdict: 'unknown', delta: 0 })).toBeNull();
  });
});

describe('findOnTheClock', () => {
  it('returns the first EMPTY slot, not one past the last filled', () => {
    // MFL lets a commissioner fill a slot out of order. Taking "last filled + 1"
    // would skip whoever is actually still on the clock.
    const board = [slot(1, 'a'), slot(2), slot(3, 'c'), slot(4)];
    expect(findOnTheClock(board)?.overallPickNumber).toBe(2);
  });

  it('returns null on a complete board', () => {
    expect(findOnTheClock([slot(1, 'a'), slot(2, 'b')])).toBeNull();
  });
});

describe('recentPicks / upcomingPicks', () => {
  const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4), slot(5), slot(6), slot(7)];

  it('lists the newest selections first', () => {
    expect(recentPicks(board, 2).map((p) => p.overallPickNumber)).toEqual([3, 2]);
  });

  it('lists the slots after the one on the clock', () => {
    // On the clock is 4, so "up next" starts at 5.
    expect(upcomingPicks(board, 2).map((p) => p.overallPickNumber)).toEqual([5, 6]);
  });

  it('returns nothing upcoming when the board is complete', () => {
    expect(upcomingPicks([slot(1, 'a')], 3)).toEqual([]);
  });
});

describe('positionRunCount', () => {
  const players = new Map<string, BroadcastPlayer>([
    ['a', player('a', 'RB')],
    ['b', player('b', 'WR')],
    ['c', player('c', 'RB')],
    ['d', player('d', 'RB')],
  ]);

  it('counts the position within the window, including the pick just made', () => {
    const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4, 'd')];
    expect(positionRunCount(board, players, 4, 'RB', 8)).toBe(3);
  });

  it('ignores picks outside the window', () => {
    const board = [slot(1, 'a'), slot(20, 'c'), slot(21, 'd')];
    expect(positionRunCount(board, players, 21, 'RB', 8)).toBe(2);
  });

  it('never counts picks that come after the one being revealed', () => {
    // A reveal replayed from the queue must not narrate the future.
    const board = [slot(1, 'a'), slot(2, 'c'), slot(3, 'd')];
    expect(positionRunCount(board, players, 1, 'RB', 8)).toBe(1);
  });

  it('returns 0 for an unknown position', () => {
    expect(positionRunCount([slot(1, 'a')], players, 1, '', 8)).toBe(0);
  });
});

describe('medianRank', () => {
  it('takes the median so one outlier source cannot drag the consensus', () => {
    // A superflex-style outlier at 4 must not pull a consensus of ~30.
    expect(medianRank([28, 30, 32, 4])).toBe(29);
  });

  it('handles odd counts and ignores non-finite values', () => {
    expect(medianRank([10, 20, 30])).toBe(20);
    // NaN is dropped first, so this is an EVEN pair [5, 7] → 6, not the
    // odd-length middle. Dropping before measuring is the point: a source
    // that lacks the player must not count as a vote.
    expect(medianRank([NaN, 5, 7])).toBe(6);
    expect(medianRank([])).toBeUndefined();
  });
});

describe('applyRehearsal', () => {
  it('keeps picks up to N and empties the rest, preserving slot identity', () => {
    const board = [slot(1, 'a', '0001'), slot(2, 'b', '0002'), slot(3, 'c', '0003')];
    const rehearsed = applyRehearsal(board, 2);

    expect(rehearsed.map((p) => p.playerId)).toEqual(['a', 'b', '']);
    // The emptied slot must keep its franchise, or the board forgets who is
    // on the clock — which is the entire point of rehearsing.
    expect(rehearsed[2].franchiseId).toBe('0003');
    expect(rehearsed[2].overallPickNumber).toBe(3);
  });

  it('empties the whole board at 0', () => {
    const rehearsed = applyRehearsal([slot(1, 'a'), slot(2, 'b')], 0);
    expect(rehearsed.every((p) => p.playerId === '')).toBe(true);
  });
});
