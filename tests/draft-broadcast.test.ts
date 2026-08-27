/**
 * Pure logic behind the AFL draft broadcast board.
 *
 * The board-position line is what the room reacts to, so the keeper handling
 * behind it is pinned here. The AFL keeps 7 per franchise — 84 players gone
 * before 1.01 — and `duplicatePlayers` means the two conferences keep
 * INDEPENDENTLY. Pool the two and ~84 legitimately draftable players vanish
 * from a board they belong on.
 */

import { describe, it, expect } from 'vitest';
import {
  bestAvailableAt,
  formatBestAvailable,
  findOnTheClock,
  recentPicks,
  upcomingPicks,
  positionRunCount,
  applyRehearsal,
} from '../src/utils/draft-broadcast';
import {
  assignBoardRanks,
  loadConferenceKeepers,
} from '../src/utils/draft-broadcast-server';
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

describe('bestAvailableAt', () => {
  const players = new Map<string, BroadcastPlayer>([
    ['a', { ...player('a', 'RB'), boardRank: 1 } as BroadcastPlayer],
    ['b', { ...player('b', 'WR'), boardRank: 2 } as BroadcastPlayer],
    ['c', { ...player('c', 'TE'), boardRank: 3 } as BroadcastPlayer],
    ['d', { ...player('d', 'QB'), boardRank: 4 } as BroadcastPlayer],
    // A kept player carries no boardRank and must never occupy a position.
    ['kept', player('kept', 'RB')],
  ]);

  it('calls the top of the board the best available', () => {
    const board = [slot(1, 'a')];
    expect(bestAvailableAt(board, players, 1, 'a')).toBe(1);
  });

  it('promotes players as better ones come off the board', () => {
    // b is 2nd overall, but by pick 2 the only man above him is gone.
    const board = [slot(1, 'a'), slot(2, 'b')];
    expect(bestAvailableAt(board, players, 2, 'b')).toBe(1);
  });

  it('counts only the players still on the board at that pick', () => {
    // At pick 2, d (rank 4) trails b and c — a is already gone.
    const board = [slot(1, 'a'), slot(2, 'd')];
    expect(bestAvailableAt(board, players, 2, 'd')).toBe(3);
  });

  it('ignores picks that land AFTER the one being revealed', () => {
    // A queued reveal must not be re-ranked by picks made while it waited.
    const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4, 'd')];
    expect(bestAvailableAt(board, players, 1, 'a')).toBe(1);
  });

  it('never lets a kept player occupy a board position', () => {
    const board = [slot(1, 'a')];
    expect(bestAvailableAt(board, players, 1, 'kept')).toBeUndefined();
  });
});

describe('formatBestAvailable', () => {
  it('names the top of the board without an ordinal', () => {
    expect(formatBestAvailable(1)).toBe('BEST AVAILABLE');
  });

  it('uses real English ordinals', () => {
    expect(formatBestAvailable(2)).toBe('2nd BEST AVAILABLE');
    expect(formatBestAvailable(3)).toBe('3rd BEST AVAILABLE');
    expect(formatBestAvailable(4)).toBe('4th BEST AVAILABLE');
    // The teens are the trap: 11/12/13 are th, not st/nd/rd.
    expect(formatBestAvailable(11)).toBe('11th BEST AVAILABLE');
    expect(formatBestAvailable(12)).toBe('12th BEST AVAILABLE');
    expect(formatBestAvailable(13)).toBe('13th BEST AVAILABLE');
    expect(formatBestAvailable(21)).toBe('21st BEST AVAILABLE');
    expect(formatBestAvailable(112)).toBe('112th BEST AVAILABLE');
  });

  it('says nothing when there is no rank', () => {
    expect(formatBestAvailable(undefined)).toBeNull();
    expect(formatBestAvailable(0)).toBeNull();
  });
});

describe('assignBoardRanks', () => {
  it('ranks by ADP and skips keepers entirely', () => {
    const pool = [
      { ...player('elite', 'RB', 2), id: 'elite' },
      { ...player('kept', 'WR', 1), id: 'kept' },
      { ...player('good', 'TE', 30), id: 'good' },
    ] as BroadcastPlayer[];
    const ranked = assignBoardRanks(pool, new Set(['kept']));
    const byId = new Map(ranked.map((p) => [p.id, p]));

    // The kept man has the best ADP and still gets no rank — he was never on
    // this board, so counting him would push everyone else down one.
    expect(byId.get('kept')?.boardRank).toBeUndefined();
    expect(byId.get('elite')?.boardRank).toBe(1);
    expect(byId.get('good')?.boardRank).toBe(2);
  });

  it('ranks on MFL ADP alone \u2014 the league\u2019s own sources are not an input', () => {
    // Brandon, 2026-08-27: the ranking sources are not for this screen. A
    // player MFL lists no ADP for stays off the board rather than being slotted
    // in from another source, so the board can never quietly become a blend.
    const pool = [
      { ...player('noAdp', 'WR'), consensusRank: 5 } as unknown as BroadcastPlayer,
      player('lateAdp', 'RB', 200),
    ];
    const byId = new Map(assignBoardRanks(pool, new Set()).map((p) => [p.id, p]));
    expect(byId.get('lateAdp')?.boardRank).toBe(1);
    expect(byId.get('noAdp')?.boardRank).toBeUndefined();
  });

  it('leaves a player with no ADP out of the board', () => {
    const pool = [player('ghost', 'TE')] as BroadcastPlayer[];
    expect(assignBoardRanks(pool, new Set())[0].boardRank).toBeUndefined();
  });
});

describe('loadConferenceKeepers', () => {
  // Reads the real AFL feed on purpose: the invariant being protected is about
  // how THIS league's data is shaped, and a fixture would happily keep passing
  // after the shape changed underneath it.
  const AFL = 'data/afl-fantasy';
  const YEAR = 2026;
  const AL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0'))
  );
  const NL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 13).padStart(4, '0'))
  );

  it('returns only the requested conference\u2019s keepers', () => {
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const nl = loadConferenceKeepers(AFL, YEAR, NL, new Set());
    // 12 franchises x 7 keepers, per conference, drafting independently.
    expect(al.size).toBe(84);
    expect(nl.size).toBe(84);
  });

  it('does NOT let one conference\u2019s keeper leave the other\u2019s board', () => {
    // `duplicatePlayers` is on for the AFL: the same NFL player can be held in
    // both conferences at once. Pooling the two keeper sets would delete every
    // NL keeper from the AL's draftable pool — up to 84 players wrongly gone
    // from a board they belong on.
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const nl = loadConferenceKeepers(AFL, YEAR, NL, new Set());
    const shared = [...al].filter((id) => nl.has(id));
    // Whether any player is actually double-kept is a league fact that varies
    // by year; what must hold is that the two sets are resolved separately.
    expect(al).not.toEqual(nl);
    for (const id of shared) {
      expect(al.has(id) && nl.has(id)).toBe(true);
    }
  });

  it('excludes players already taken on the board', () => {
    const all = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const someKeeper = [...all][0];
    // MFL adds each pick to the drafting franchise's roster as it lands, so a
    // plain roster read mid-draft would count fresh picks as keepers and shrink
    // the pool under the board.
    const afterDraft = loadConferenceKeepers(AFL, YEAR, AL, new Set([someKeeper]));
    expect(afterDraft.has(someKeeper)).toBe(false);
    expect(afterDraft.size).toBe(all.size - 1);
  });

  it('returns an empty set for an unknown league path', () => {
    expect(loadConferenceKeepers('data/nope', YEAR, AL, new Set()).size).toBe(0);
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
