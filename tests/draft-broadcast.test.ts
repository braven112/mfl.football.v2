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
  isRevealWorthy,
  lastPickAtMs,
  clockAnchorMs,
  formatElapsedClock,
  screensaverReel,
  screensaverAnchorMs,
  screensaverSceneMs,
  isScreensaverDue,
  resolveScreensaverIdleMs,
  buildScreensaverPlaylist,
  positionTallies,
  rosterRows,
  SCREENSAVER_IDLE_MS,
  SCREENSAVER_STEP_MS,
  SCREENSAVER_PANEL_MS,
  REVEAL_MAX_AGE_MS,
  darkenForWhiteText,
  contrastWithWhite,
  toBroadcastColor,
  toBroadcastPair,
  resolveOrigin,
} from '../src/utils/draft-broadcast';
import { faceLabel } from '../src/components/shared/draft-broadcast/BroadcastPanel';
import { parseTradeFromComment } from '../src/utils/draft-utils';
import { usesCollegeOrigin } from '../src/utils/pick-reveal';
import {
  assignBoardRanks,
  buildConferenceBoard,
  buildDefenseFacesByTeam,
  enrichBroadcastPlayers,
  findRehearsalYear,
  loadConferenceKeepers,
} from '../src/utils/draft-broadcast-server';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  // Reads the real AFL feed on purpose — the invariant is about how THIS
  // league's data is shaped, and a fixture keeps passing after the shape moves.
  //
  // But it asserts SHAPE, never a roster COUNT. `rosters.json` is cron-written:
  // the moment Saturday's picks land, every franchise goes from 7 keepers to
  // ~16, and a `toBe(84)` would fail on main on a data-only commit. That is the
  // exact trap `afl-draft-slot.ts` documents, and the first version of this
  // test walked straight into it.
  const AFL = 'data/afl-fantasy';
  const YEAR = 2026;
  const AL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0'))
  );
  const NL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 13).padStart(4, '0'))
  );

  it('resolves each conference independently', () => {
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const nl = loadConferenceKeepers(AFL, YEAR, NL, new Set());
    expect(al.size).toBeGreaterThan(0);
    expect(nl.size).toBeGreaterThan(0);
    // Two conferences, two answers. Identical sets would mean the franchise
    // filter is not being applied at all.
    expect([...al].sort()).not.toEqual([...nl].sort());
  });

  it('does NOT let one conference\u2019s keeper leave the other\u2019s board', () => {
    // `duplicatePlayers` is on for the AFL: the same NFL player can be held in
    // both conferences at once. Pooling the two keeper sets would delete every
    // NL keeper from the AL's draftable pool — players wrongly gone from a
    // board they belong on. Asserting the AL set contains no NL-only franchise
    // player is the shape-level version of that guarantee.
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const both = loadConferenceKeepers(AFL, YEAR, new Set([...AL, ...NL]), new Set());
    // Pooling strictly grows the set; if it didn't, scoping is a no-op.
    expect(both.size).toBeGreaterThan(al.size);
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

/** Epoch seconds inside a finished season — what a rehearsal board carries. */
const OLD_DRAFT_SEC = 1_700_000_000;

function stamped(overall: number, playerId: string, sec: number): DraftRoomPick {
  return { ...slot(overall, playerId), timestamp: String(sec) };
}

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

  it('leaves the starting board\'s stamps alone', () => {
    // The picks the operator asked to start from are history, exactly like the
    // SSR board on draft night. Restamping them would make a reload of
    // ?rehearse=40 storm forty reveals.
    const board = [stamped(1, 'a', OLD_DRAFT_SEC), stamped(2, 'b', OLD_DRAFT_SEC)];
    expect(applyRehearsal(board, 2).map((p) => p.timestamp)).toEqual([
      String(OLD_DRAFT_SEC),
      String(OLD_DRAFT_SEC),
    ]);
  });

  it('stamps the picks it rolls forward as happening NOW', () => {
    // THE REGRESSION THIS PINS: a rehearsal replays a COMPLETED season, so every
    // pick on it is stamped months ago. The live board only reveals a pick
    // inside REVEAL_MAX_AGE_MS, so once that gate landed the dry run absorbed
    // every single pick silently and the reveal never appeared again — with the
    // board still advancing, which is exactly what makes it look like the page
    // works. A replayed pick is happening now and must be stamped now.
    const now = 1_800_000_000_000;
    const board = [
      stamped(1, 'a', OLD_DRAFT_SEC),
      stamped(2, 'b', OLD_DRAFT_SEC),
      stamped(3, 'c', OLD_DRAFT_SEC),
    ];

    // The replay started at pick 1 and has just rolled forward to pick 3.
    const rehearsed = applyRehearsal(board, 3, 1, now);

    expect(rehearsed[0].timestamp).toBe(String(OLD_DRAFT_SEC));
    expect(rehearsed[1].timestamp).toBe(String(Math.floor(now / 1000)));
    expect(rehearsed[2].timestamp).toBe(String(Math.floor(now / 1000)));

    // The whole point: the live gate now lets them through.
    expect(isRevealWorthy(rehearsed[2], now)).toBe(true);
    expect(isRevealWorthy(board[2], now)).toBe(false);
  });

  it('keeps every step of a full replay reveal-worthy', () => {
    // Walks the replay the way the board does — one pick at a time, from the
    // starting point — and asserts the newest pick clears the gate at each
    // step. A per-step check is what would have caught the original bug; the
    // board advanced fine, it just never revealed.
    const now = 1_800_000_000_000;
    const board = [1, 2, 3, 4, 5].map((n) => stamped(n, `p${n}`, OLD_DRAFT_SEC));
    const startAt = 2;

    for (let step = startAt + 1; step <= board.length; step++) {
      const rehearsed = applyRehearsal(board, step, startAt, now);
      const newest = rehearsed[step - 1];
      expect(newest.playerId).toBe(`p${step}`);
      expect(isRevealWorthy(newest, now)).toBe(true);
    }
  });
});

describe('isRevealWorthy', () => {
  const now = 1_800_000_000_000;

  it('reveals a pick that just landed and absorbs a stale one', () => {
    expect(isRevealWorthy(stamped(1, 'a', Math.floor(now / 1000)), now)).toBe(true);
    expect(
      isRevealWorthy(stamped(1, 'a', Math.floor((now - REVEAL_MAX_AGE_MS + 1_000) / 1000)), now)
    ).toBe(true);
    expect(
      isRevealWorthy(stamped(1, 'a', Math.floor((now - REVEAL_MAX_AGE_MS - 1_000) / 1000)), now)
    ).toBe(false);
  });

  it('reveals a pick MFL gave no usable stamp', () => {
    // Swallowing a pick because a field was missing is the worse failure by far.
    expect(isRevealWorthy(slot(1, 'a'), now)).toBe(true);
    expect(isRevealWorthy({ ...slot(1, 'a'), timestamp: 'nonsense' }, now)).toBe(true);
    expect(isRevealWorthy({ ...slot(1, 'a'), timestamp: '0' }, now)).toBe(true);
  });
});


describe('the on-the-clock count-up', () => {
  // The idle screen said WHO was up and said it identically at ten seconds and
  // at ten minutes. These pin the two halves of the answer: which pick the
  // clock hangs off, and how the digits read on a TV.

  describe('lastPickAtMs', () => {
    it('takes the newest stamp on the board, in ms', () => {
      // Deliberately out of pick order: MFL lets a commissioner fill a slot out
      // of sequence, so "the last filled slot" is not "the most recent pick".
      const picks = [stamped(1, 'a', 1_700_000_100), stamped(2, 'b', 1_700_000_400), slot(3)];
      expect(lastPickAtMs(picks)).toBe(1_700_000_400_000);
      expect(lastPickAtMs([...picks].reverse())).toBe(1_700_000_400_000);
    });

    it('ignores empty slots, so an unpicked board has no clock', () => {
      expect(lastPickAtMs([slot(1), slot(2), slot(3)])).toBeNull();
      expect(lastPickAtMs([])).toBeNull();
    });

    it('returns null rather than counting up from 1970', () => {
      // A board whose picks carry no usable stamp must show NO timer. Zero, an
      // empty string and garbage are all "MFL did not tell us".
      expect(lastPickAtMs([slot(1, 'a')])).toBeNull();
      expect(lastPickAtMs([{ ...slot(1, 'a'), timestamp: 'nonsense' }])).toBeNull();
      expect(lastPickAtMs([stamped(1, 'a', 0)])).toBeNull();
    });

    it('is dated by its good rows when one stamp is bad', () => {
      const picks = [stamped(1, 'a', 1_700_000_100), { ...slot(2, 'b'), timestamp: '' }];
      expect(lastPickAtMs(picks)).toBe(1_700_000_100_000);
    });

    it('follows a revert forward, the way boardAge does', () => {
      // A re-picked 1.01 is stamped later than everything in the abandoned
      // draft, so the clock restarts from it rather than from the old board.
      const reverted = [stamped(1, 'z', 1_700_009_000), slot(2), slot(3)];
      expect(lastPickAtMs(reverted)).toBe(1_700_009_000_000);
    });
  });

  describe('formatElapsedClock', () => {
    it('reads as a stopwatch: unpadded minutes under an hour, padded above', () => {
      expect(formatElapsedClock(0)).toBe('0:00');
      expect(formatElapsedClock(7)).toBe('0:07');
      expect(formatElapsedClock(59)).toBe('0:59');
      expect(formatElapsedClock(60)).toBe('1:00');
      expect(formatElapsedClock(252)).toBe('4:12');
      expect(formatElapsedClock(3599)).toBe('59:59');
      expect(formatElapsedClock(3600)).toBe('1:00:00');
      expect(formatElapsedClock(3907)).toBe('1:05:07');
      expect(formatElapsedClock(86_400)).toBe('24:00:00');
    });

    it('clamps a negative to zero', () => {
      // The anchor is MFL's server clock and the count-up is the browser's, so
      // a laptop running slow puts the newest pick in its own future. "0:00"
      // is invisible; "-0:03" on a TV is a bug the whole room can see.
      expect(formatElapsedClock(-1)).toBe('0:00');
      expect(formatElapsedClock(-9_999)).toBe('0:00');
    });

    it('floors a partial second rather than rounding up', () => {
      // A clock that shows 0:01 before a second has passed is wrong twice: at
      // the start, and at every boundary after it.
      expect(formatElapsedClock(0.9)).toBe('0:00');
      expect(formatElapsedClock(59.99)).toBe('0:59');
    });
  });

  it('the chip survives the keyed row\'s remount without blinking', () => {
    // `.dbc-idle__clock` is keyed by franchise so the crest's 404 walk resets
    // when the clock moves. A key remounts the WHOLE subtree, and the chip is
    // inside it — so a `ClockElapsed` that decides "have I mounted yet" from its
    // OWN state goes back to null on every pick and paints a frame with no chip.
    // That shipped and was caught in review; the fix is a `hydrated` flag owned
    // by OnTheClock, which is never keyed.
    const tsx = readFileSync('src/components/shared/draft-broadcast/OnTheClock.tsx', 'utf-8');

    // The premise. If this ever stops matching, the crest walk changed too —
    // re-read both before deciding the flag is unnecessary.
    expect(tsx, 'the on-the-clock row is no longer keyed by franchise').toMatch(
      /className="dbc-idle__clock"\s+key=/
    );
    // The seed is conditional on the flag, not an unconditional null.
    expect(tsx, 'ClockElapsed must seed its clock from the hydrated flag').toMatch(
      /hydrated \? Math\.floor\(Date\.now\(\)/
    );
    // And the flag is owned OUTSIDE the keyed row, or it resets with everything
    // else and the guard above buys nothing.
    expect(tsx, 'the hydrated flag must be passed into ClockElapsed').toMatch(
      /<ClockElapsed[^>]*hydrated=\{hydrated\}/s
    );
    const flagDecl = tsx.indexOf('const [hydrated, setHydrated]');
    const keyedRow = tsx.indexOf('className="dbc-idle__clock"');
    expect(flagDecl, 'hydrated flag not declared').toBeGreaterThan(-1);
    expect(
      flagDecl < keyedRow,
      'the hydrated flag must be declared in OnTheClock, above the keyed row'
    ).toBe(true);
  });

  it('every class the timer renders is actually styled', () => {
    // The chip is three new class names on a surface whose stylesheet sets no
    // font-family at all, so an unstyled `__elapsed-value` does not vanish — it
    // renders in the body sans, at inherited size, with proportional digits
    // that make the pill jitter once a second. Silent, and only visible on a TV.
    const tsx = readFileSync('src/components/shared/draft-broadcast/OnTheClock.tsx', 'utf-8');
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    const used = [...tsx.matchAll(/dbc-idle__elapsed[\w-]*/g)].map((m) => m[0]);
    expect(new Set(used).size).toBeGreaterThanOrEqual(3);
    for (const cls of new Set(used)) {
      expect(css, `.${cls} is rendered but never styled`).toContain(`.${cls}`);
    }
  });

  it('the value wears fixed-width digits and the board display face', () => {
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    const block = /^\.dbc-idle__elapsed-value \{[\s\S]*?\n\}/m.exec(css)?.[0] ?? '';
    expect(block, '.dbc-idle__elapsed-value rule not found').not.toBe('');
    // Proportional digits change the pill's width on most of the ten
    // transitions a minute — the chip visibly twitches for as long as a team is
    // on the clock.
    expect(block).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // Same reason `.dbc-idle__clock-status` states it: nothing on this page
    // sets a font-family, and a <span> falls through to the body sans beside a
    // condensed team name.
    expect(block).toMatch(/font-family:\s*var\(--font-display\)/);
  });

  describe('clockAnchorMs', () => {
    const opened = 1_800_000_000_000;
    const live = [stamped(1, 'a', 1_799_999_400), slot(2)];

    it('is the last pick, untouched, on a live board', () => {
      // The SSR board is a deployed snapshot minutes old and counting from ITS
      // newest stamp is correct — the pick really did land then. Flooring here
      // would reset the room's clock on every reload of the laptop.
      expect(clockAnchorMs(live, false, opened)).toBe(1_799_999_400_000);
    });

    it('floors a rehearsal to when the replay opened', () => {
      // `?rehearse=8` seeds real picks from a FINISHED season, which
      // applyRehearsal deliberately does not restamp. Measured on the dry run,
      // that opened the board on `ELAPSED 2859:49:54`.
      const seeded = [stamped(1, 'a', 1_700_000_000), stamped(2, 'b', 1_700_000_100), slot(3)];
      expect(clockAnchorMs(seeded, true, opened)).toBe(opened);
    });

    it('lets a replayed pick overtake that floor', () => {
      // applyRehearsal stamps everything the replay rolls forward to now, so the
      // dry run's clock has to follow the replay rather than stay pinned to the
      // moment the page opened.
      const season = [
        stamped(1, 'a', 1_700_000_000),
        stamped(2, 'b', 1_700_000_100),
        stamped(3, 'c', 1_700_000_200),
      ];
      const replayed = applyRehearsal(season, 2, 1, opened + 30_000);
      expect(clockAnchorMs(replayed, true, opened)).toBe(opened + 30_000);
    });

    it('stays null when there is nothing to count from, rehearsing or not', () => {
      // The floor must not conjure a timer onto the pre-draft screen, which
      // says "First on the clock" and has no previous pick.
      expect(clockAnchorMs([slot(1), slot(2)], true, opened)).toBeNull();
      expect(clockAnchorMs([slot(1), slot(2)], false, opened)).toBeNull();
      expect(clockAnchorMs([slot(1, 'a')], true, opened)).toBeNull();
    });
  });
});

describe('findRehearsalYear', () => {
  // The rehearsal link is the one control on this page that can dead-end:
  // pointed at a season with no board it drops the operator onto a broadcast
  // that never reveals anything, which looks exactly like the page being
  // broken. So it resolves off the real feeds, and only ever returns a season
  // it has confirmed is complete.
  const AFL = 'data/afl-fantasy';

  it('skips the current (empty) season and lands on a completed one', () => {
    // 2026's board exists but is all-empty until draft night — the whole
    // reason a rehearsal mode exists at all.
    const year = findRehearsalYear(AFL, 2026, 'CONFERENCE00');
    expect(year).toBeDefined();
    expect(year).toBeLessThan(2026);
  });

  it('returns a board that is genuinely complete, not merely present', () => {
    const year = findRehearsalYear(AFL, 2026, 'CONFERENCE00')!;
    const { picks } = buildConferenceBoard(
      JSON.parse(
        readFileSync(`${AFL}/mfl-feeds/${year}/draftResults.json`, 'utf-8')
      ),
      'CONFERENCE00'
    );
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.playerId)).toBe(true);
  });

  it('resolves per conference — a finished AL board does not vouch for the NL', () => {
    // duplicatePlayers lets the two conferences draft independently, and in
    // 2025 they ran on different DAYS. Each board answers for itself.
    for (const unit of ['CONFERENCE00', 'CONFERENCE01']) {
      const year = findRehearsalYear(AFL, 2026, unit);
      expect(year, unit).toBeDefined();
    }
  });

  it('returns undefined for an unknown unit rather than a wrong board', () => {
    expect(findRehearsalYear(AFL, 2026, 'CONFERENCE99')).toBeUndefined();
  });

  it('returns undefined when the data path has no feeds at all', () => {
    expect(findRehearsalYear('data/nope', 2026, 'CONFERENCE00')).toBeUndefined();
  });
});


describe('buildDefenseFacesByTeam', () => {
  // A DEF "player" is a crest, not a person, so the reveal card would show an
  // empty figure column for every team defense taken. These are the faces that
  // stand in for it — the same ranked pool the Free Agents hero draws from.
  function def(nflTeam: string, id = '0501'): BroadcastPlayer {
    return { id, name: 'Kansas City Chiefs', position: 'DEF', nflTeam, headshot: '' } as BroadcastPlayer;
  }

  it('gives a team defense its marquee defenders, best first', () => {
    const faces = buildDefenseFacesByTeam([def('KCC')]).KCC;
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[0].espnId).toMatch(/^\d+$/);
    // The pool's own order is the ranking, and it survives the trim — the card
    // draws from the TOP five, so a reshuffle here would put a rotational
    // safety in the same hat as the unit's best player.
    const pool = JSON.parse(readFileSync('src/data/theleague/def-spotlight-players.json', 'utf-8'));
    expect(faces.map((f) => f.name)).toEqual(
      pool.teams.KC.slice(0, faces.length).map((d: { name: string }) => d.name)
    );
  });

  it('ships a hat deep enough to draw from, but only of names worth showing', () => {
    // The card shows TWO of these, at random, so this is the size of the draw
    // rather than a display budget. Capped at five: the pool's sixth man is a
    // rotational safety the room does not recognise.
    const faces = buildDefenseFacesByTeam([def('KCC')]).KCC;
    expect(faces.length).toBeLessThanOrEqual(5);
    expect(faces.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves MFL team codes, not just ESPN ones', () => {
    // The killer: a DEF arrives carrying MFL's dialect (NEP/GBP/KCC/LVR) while
    // the pool is keyed ESPN-style (NE/GB/KC/LV), and Washington disagrees with
    // BOTH normalizations. Indexing raw silently drops nine of 32 defenses.
    const codes = ['NEP', 'GBP', 'KCC', 'LVR', 'NOS', 'SFO', 'TBB', 'JAC', 'WAS'];
    const byTeam = buildDefenseFacesByTeam(codes.map((c, i) => def(c, `05${i}`)));
    for (const code of codes) expect(byTeam[code], code).toBeTruthy();
  });

  it('keys the result by the RAW code the player carries, not the normalized one', () => {
    // The island indexes this map with `player.nflTeam` verbatim so it does not
    // have to ship a team-code normalizer. Re-keying to ESPN codes here would
    // miss the same nine teams, one layer further down.
    expect(Object.keys(buildDefenseFacesByTeam([def('GBP')]))).toEqual(['GBP']);
  });

  it('covers every NFL team a defense can belong to', () => {
    const players = JSON.parse(
      readFileSync('data/theleague/mfl-feeds/2026/players.json', 'utf-8')
    ).players.player as any[];
    const defenses = players.filter((p) => (p.position || '').toUpperCase() === 'DEF');
    expect(defenses.length).toBe(32);
    const byTeam = buildDefenseFacesByTeam(defenses.map((d) => def(d.team, d.id)));
    for (const d of defenses) {
      // At least ONE face, which is the real runtime invariant — the card
      // renders a single defender when that is all a pool holds. Asserting a
      // full pair here would be stricter than the code: the generator
      // (`fetch-def-spotlight-players.mjs`) only WARNS below MIN_PER_TEAM and
      // its hard gate is a league-wide total, so one thin roster on a Wednesday
      // sync would turn main red for a case the card handles fine.
      expect(byTeam[d.team]?.length ?? 0, `${d.name} (${d.team})`).toBeGreaterThanOrEqual(1);
    }
    // The pool is nonetheless deep across the league — a collapse to mostly
    // single-face teams is a real regression even though one is not.
    const pairable = defenses.filter((d) => (byTeam[d.team]?.length ?? 0) >= 2).length;
    expect(pairable).toBe(32);
  });

  it('keys off POSITION alone — a non-DEF contributes nothing', () => {
    // Deliberately NOT gated on `headshot`: an offensive player with no ESPN
    // image still must not borrow his team's defenders, and a DEF whose feed
    // somehow carries a headshot is still a crest. Both fixtures below are
    // RBs; the headshot value is irrelevant to the gate, and pinning the test
    // to it would imply a coupling the function does not have.
    const rbNoImage = { id: '1', name: 'A Back', position: 'RB', nflTeam: 'KCC', headshot: '' } as BroadcastPlayer;
    const rbWithImage = {
      id: '2',
      name: 'B Back',
      position: 'RB',
      nflTeam: 'KCC',
      headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/1234.png',
    } as BroadcastPlayer;
    expect(buildDefenseFacesByTeam([rbNoImage, rbWithImage])).toEqual({});
  });

  it('falls back to the crest-only reveal for an unmapped defense', () => {
    expect(buildDefenseFacesByTeam([def('XXX'), def('', '0502')])).toEqual({});
  });

  it('ships ONE list per team, not one per player', () => {
    // `normPos` folds every MFL team-unit pseudo-player (TMQB, TMDL, TMPN, …)
    // into DEF, and each shares its real defense's name and team code — 320
    // players for 32 defenses in the 2026 pool. Hanging the pool off each one
    // added 101 KB (+28%) to the serialized payload to ship 32 lists.
    const crowd = Array.from({ length: 10 }, (_, i) => def('KCC', `06${i}`));
    const byTeam = buildDefenseFacesByTeam(crowd);
    expect(Object.keys(byTeam)).toEqual(['KCC']);
  });

  it('leaves the per-player payload alone', () => {
    // The faces used to ride on every DEF-positioned player. They must not
    // come back — enrichBroadcastPlayers is what the page ships.
    const [enriched] = enrichBroadcastPlayers([def('KCC')], {
      dataPath: 'data/afl-fantasy',
      year: 2026,
    });
    expect(enriched).not.toHaveProperty('defenseFaces');
  });
});


describe('the origin line and its logo', () => {
  // The reveal card names where a player comes from — his school if he is a
  // rookie, his pro team otherwise — and paints that side's mark to the left of
  // the words. The mark and the words come out of ONE function precisely so a
  // card can never show a helmet beside a school's name.

  it('gives a rookie his school, and the school logo the server resolved', () => {
    const origin = resolveOrigin({
      isRookie: true,
      college: 'Georgia',
      collegeLogo: '/assets/college-logos/dark/61.png',
      nflTeam: 'KCC',
    });
    expect(origin.label).toBe('Georgia');
    expect(origin.logo).toBe('/assets/college-logos/dark/61.png');
  });

  it('gives a veteran his NFL team, even when MFL still reports his college', () => {
    // MFL never stops reporting a school. A ten-year vet labelled "Alabama"
    // with an Alabama logo beside it is the failure this pairing prevents.
    const origin = resolveOrigin({ isRookie: false, college: 'Alabama', nflTeam: 'KCC' });
    expect(origin.label).toBe('KCC');
    expect(origin.logo).toMatch(/KC\.(png|svg)$/);
  });

  it('paints the DARK cut — the card is a dark gradient in both themes', () => {
    // Every other surface ships the light logo and lets an `html.dark` rule
    // swap it. This card cannot: it is franchise colour whatever theme the
    // viewer resolved, so a light Raiders/Steelers/Jets mark would vanish for
    // half the room. Shipping the dark URL as the src also means no swap rule
    // is keyed on it, so nothing swaps it back.
    const logo = resolveOrigin({ nflTeam: 'LVR' }).logo ?? '';
    expect(logo).toMatch(/(\/dark\/|500-dark)/);
  });

  it('shows no mark for a free agent, a retiree, or a code it does not know', () => {
    // `normalizeTeamCode` folds FA/UFA to the NFL shield. A generic shield
    // beside a name says nothing, and an unrecognised code would 404.
    for (const nflTeam of ['FA', 'UFA', 'XYZ', '']) {
      expect(resolveOrigin({ nflTeam }).logo, nflTeam).toBeNull();
    }
  });

  it('shows no mark for a rookie whose school is not in the logo table', () => {
    const origin = resolveOrigin({ isRookie: true, college: 'Nowhere State' });
    expect(origin.label).toBe('Nowhere State');
    expect(origin.logo).toBeNull();
  });

  it('says nothing at all when there is no origin', () => {
    expect(resolveOrigin(undefined)).toEqual({ label: '', logo: null });
    expect(resolveOrigin({}).label).toBe('');
  });

  it('resolves a college logo ONLY for players the card labels with a college', () => {
    // The lookup needs an 80 KB table, so it happens server-side — but a pool
    // of several hundred players must not carry a URL each for a line that will
    // read as an NFL team. Gated on the card's own rule, not on `p.college`.
    const rookie = {
      ...player('r1', 'WR'),
      isRookie: true,
      college: 'Georgia',
    } as BroadcastPlayer;
    const vet = { ...player('v1', 'WR'), isRookie: false, college: 'Georgia' } as BroadcastPlayer;

    const [enrichedRookie, enrichedVet] = enrichBroadcastPlayers([rookie, vet], {
      dataPath: 'data/afl-fantasy',
      year: 2026,
    });
    expect(enrichedRookie.collegeLogo, 'a rookie carries his school mark').toBeTruthy();
    expect(enrichedVet.collegeLogo, 'a veteran carries none').toBeUndefined();
  });

  it('matches a school whatever case MFL spells it in', () => {
    const [enriched] = enrichBroadcastPlayers(
      [{ ...player('r2', 'RB'), isRookie: true, college: 'gEoRgIa' } as BroadcastPlayer],
      { dataPath: 'data/afl-fantasy', year: 2026 }
    );
    expect(enriched.collegeLogo).toBeTruthy();
  });

  it('keeps ONE rule for which side of the origin a player falls on', () => {
    expect(usesCollegeOrigin({ isRookie: true, college: 'Georgia' })).toBe(true);
    expect(usesCollegeOrigin({ isRookie: true })).toBe(false);
    expect(usesCollegeOrigin({ isRookie: false, college: 'Georgia' })).toBe(false);
    expect(usesCollegeOrigin(undefined)).toBe(false);
  });

  it('has BOTH reveal surfaces ask that rule, rather than re-deriving it', () => {
    // The draft room's splash and the broadcast card show the same pick, and
    // for a while each carried its own copy of `isRookie && college`. They
    // agreed — until one of them changed. `usesCollegeOrigin` lives in
    // pick-reveal.ts precisely because both import it, and the broadcast's
    // SERVER gates its school-logo lookup on it too: a drifted copy would keep
    // resolving marks for players the card had started labelling with a team.
    const surfaces = [
      'src/components/theleague/draft-room/PickRevealSplash.tsx',
      'src/utils/draft-broadcast.ts',
      'src/utils/draft-broadcast-server.ts',
    ];
    for (const file of surfaces) {
      const src = readFileSync(file, 'utf-8');
      expect(src, `${file} must ask the shared rule`).toMatch(/usesCollegeOrigin\(/);
      expect(src, `${file} re-derives the origin rule inline`).not.toMatch(
        /isRookie\s*&&\s*[\w.?!]*college/
      );
    }
  });

  it('travels as one flex item, so a wrap cannot orphan the mark', () => {
    // `.dbc-reveal__meta` is a flex row. A bare <img> + text would let the row
    // break between the logo and the name it belongs to.
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    // `\s*` not a literal space: a formatter closing that gap would otherwise
    // fail this guard without changing a line of behaviour.
    const rule = css.match(/\.dbc-reveal__origin\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/display:\s*inline-flex/);
  });
});

describe('darkenForWhiteText', () => {
  // The reveal card paints white copy straight onto franchise brand colours,
  // and nine of the AFL's 24 franchises have a gradient stop white cannot be
  // read against — six of them the near-white #e9e9e9. On a laptop that is a
  // squint; on the TV it is an unreadable card in front of the whole league.
  const AFL = 'data/afl-fantasy/afl.config.json';

  it('leaves a colour that already passes completely alone', () => {
    for (const dark of ['#181818', '#002244', '#1c497c']) {
      expect(darkenForWhiteText(dark)).toBe(dark);
    }
  });

  it('darkens every failing colour to at least the 4.5 floor', () => {
    for (const light of ['#e9e9e9', '#ffcd00', '#e8aea6', '#ffffff']) {
      expect(contrastWithWhite(darkenForWhiteText(light))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('holds the floor for EVERY stop of EVERY AFL franchise', () => {
    // The real registry, not a fixture: the invariant is about this league's
    // actual brand colours, and a new franchise must not be able to ship a
    // stop the board cannot render text on.
    const cfg = JSON.parse(readFileSync(AFL, 'utf-8'));
    for (const t of cfg.teams) {
      for (const key of ['colorPrimary', 'colorSecondary']) {
        if (!t[key]) continue;
        const ratio = contrastWithWhite(darkenForWhiteText(t[key]));
        expect(ratio, `${t.nameMedium || t.name} ${key} ${t[key]}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the hue rather than washing to grey', () => {
    // Scaling toward black preserves the channel ratios, so a light pink stays
    // pink. Mixing in grey instead would hand the league a set of muddy cards.
    const out = darkenForWhiteText('#e8aea6');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThanOrEqual(b);
  });

  it('scores an unparseable colour as FAILING, so the guards can catch it', () => {
    // Returning the floor value here read as "passes" to every caller, so a
    // typo'd or non-hex brand colour sailed through all three league-wide
    // guards and reached the card untouched.
    for (const junk of ['#e9e9e9ff', 'rgb(233,233,233)', 'rebeccapurple', '']) {
      expect(contrastWithWhite(junk)).toBe(0);
    }
  });

  it('returns a malformed colour untouched instead of throwing', () => {
    // Draft night is the wrong time to discover a typo'd brand colour crashes
    // the reveal — degrade to today's behaviour.
    for (const junk of ['', 'rebeccapurple', '#12', 'not-a-color']) {
      expect(darkenForWhiteText(junk)).toBe(junk);
    }
  });
});


describe('toBroadcastColor', () => {
  // A TV across a lit room eats subtlety: accurate-but-flat brand colours read
  // washed out, and light ones make the copy unreadable. Saturate, then floor.
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
    return { s, l };
  };

  it('holds the contrast floor for every AFL brand stop', () => {
    const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));
    for (const t of cfg.teams) {
      for (const key of ['colorPrimary', 'colorSecondary']) {
        if (!t[key]) continue;
        expect(
          contrastWithWhite(toBroadcastColor(t[key])),
          `${t.nameMedium || t.name} ${key}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('comes out MORE saturated, not just darker', () => {
    // The whole point of the boost. Darkening alone costs saturation, which is
    // why the boost is applied first.
    for (const brand of ['#429b3f', '#42a349', '#529fcc']) {
      expect(hsl(toBroadcastColor(brand)).s).toBeGreaterThan(hsl(brand).s);
    }
  });

  it('leaves a greyscale brand grey instead of inventing a hue', () => {
    const out = toBroadcastColor('#e9e9e9');
    expect(hsl(out).s).toBe(0);
    expect(contrastWithWhite(out)).toBeGreaterThanOrEqual(4.5);
  });

  it('passes a malformed colour through untouched', () => {
    expect(toBroadcastColor('not-a-color')).toBe('not-a-color');
  });
});


describe('AFL franchise crest art', () => {
  // The broadcast crest renders at ~52vh — roughly 560px on a 1080p TV — so
  // the 100x100 `icon` files upscale more than 5x and visibly pixelate across
  // a room. draft-broadcast.astro prefers groupMeDark -> groupMe -> icon; this
  // pins that the preferred art actually EXISTS, because a 404 here degrades
  // silently to no crest at all rather than to the small one.
  const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));

  it('points every declared crest path at a real file', () => {
    for (const t of cfg.teams) {
      for (const key of ['icon', 'iconDark', 'groupMe', 'groupMeDark']) {
        if (!t[key]) continue;
        expect(
          existsSync(`public${t[key]}`),
          `${t.nameMedium || t.name} ${key} -> ${t[key]}`
        ).toBe(true);
      }
    }
  });

  it('gives every franchise crest art bigger than the 100px icon', () => {
    // Not a nice-to-have: this is the difference between a crisp crest and a
    // pixelated one on the only screen this page is built for.
    for (const t of cfg.teams) {
      expect(t.groupMe || t.groupMeDark, `${t.nameMedium || t.name} has no group-me art`)
        .toBeTruthy();
    }
  });

  it('never declares a dark cut that does not exist on disk', () => {
    // The resolution order falls back groupMeDark -> groupMe, so a declared but
    // missing dark path is strictly worse than not declaring one.
    for (const t of cfg.teams) {
      if (!t.groupMeDark) continue;
      expect(existsSync(`public${t.groupMeDark}`), `${t.name} groupMeDark`).toBe(true);
    }
  });
});


describe('toBroadcastPair', () => {
  // Six AFL franchises pair a real brand colour with the near-white #e9e9e9.
  // Resolved stop-by-stop that grey has no hue to keep, so it can only darken
  // to grey — Suh Girls' warm brown faded into a dead slate halfway across the
  // card. The pair lets a grey borrow the hue of the stop that has one.
  const sat = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    return mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  };
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h / 6;
  };

  it('tints a greyscale stop with the partner stop hue', () => {
    // Suh Girls: brown -> near-white must come out brown -> brown.
    const out = toBroadcastPair('#b97c46', '#e9e9e9');
    expect(sat(out.secondary)).toBeGreaterThan(0.3);
    expect(Math.abs(hue(out.secondary) - hue(out.primary))).toBeLessThan(0.06);
  });

  it('borrows from the SECOND stop when the first is the grey one', () => {
    // Avenging Amish lead with #e9e9e9 and carry their blue second.
    const out = toBroadcastPair('#e9e9e9', '#529fcc');
    expect(sat(out.primary)).toBeGreaterThan(0.3);
    expect(Math.abs(hue(out.primary) - hue(out.secondary))).toBeLessThan(0.06);
  });

  it('preserves a near-BLACK stop instead of repainting it in the partner hue', () => {
    // Ten franchises pair a colour with #181818. Black is greyscale, so a
    // saturation-only grey test tinted it: Vitside Mafia's black half came out
    // red and the card flattened to colour-on-colour. Black already passes the
    // floor, so it needs no rescuing.
    for (const [p, sec] of [['#181818', '#aa322b'], ['#2b972b', '#181818'], ['#ffcd00', '#181818']]) {
      const out = toBroadcastPair(p, sec);
      expect(p === '#181818' ? out.primary : out.secondary).toBe('#181818');
    }
  });

  it('leaves a genuinely greyscale franchise grey', () => {
    // Titsburgh are grey on both stops — that IS the brand, so there is no hue
    // to borrow and inventing one would be worse than leaving it.
    const out = toBroadcastPair('#8b8f93', '#181818');
    expect(sat(out.primary)).toBeLessThan(0.12);
    expect(sat(out.secondary)).toBeLessThan(0.12);
  });

  it('still holds the contrast floor on both stops, league-wide', () => {
    const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));
    for (const t of cfg.teams) {
      const out = toBroadcastPair(t.colorPrimary, t.colorSecondary || t.colorPrimary);
      for (const k of ['primary', 'secondary'] as const) {
        expect(
          contrastWithWhite(out[k]),
          `${t.nameMedium || t.name} ${k}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});


describe('idle screen and reveal card share one colour treatment', () => {
  // The idle board is on screen between every pick and hands straight off to a
  // reveal. It used to paint RAW brand colours while the reveal painted treated
  // ones, so a light franchise flashed washed-out, then deep and saturated a
  // second later. Both call toBroadcastPair now; this pins that neither can
  // quietly go back to reading colorPrimary/colorSecondary directly.
  const read = (f: string) => readFileSync(`src/components/shared/draft-broadcast/${f}`, 'utf-8');

  /** Source with comments removed — the first version of this guard matched
   *  `toBroadcastPair` in the explanatory comment sitting directly above the
   *  call, so deleting the call itself kept the suite green. */
  const code = (f: string) =>
    read(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');

  it('both components CALL toBroadcastPair, not merely mention it', () => {
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must call toBroadcastPair(...)`).toMatch(
        /toBroadcastPair\s*\(/
      );
    }
  });

  it('neither component reads a raw brand colour for its background', () => {
    // The original bug was a local `const primary = team?.colorPrimary || …`
    // feeding the CSS variable, which a rule keyed on the variable name alone
    // would not have caught. Ban the raw property read outright instead.
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(
        /team[?.]*\.color(Primary|Secondary)/.test(code(f)),
        `${f} reads team.color* directly — go through resolveSplashColors + toBroadcastPair`
      ).toBe(false);
    }
  });

  // Matching the COLOURS was not enough. Both screens ran the same pair through
  // the same treatment and still disagreed, because each COMPOSED that pair its
  // own way — the reveal at 115/315deg, the idle board at 150deg with reversed
  // stops and a stop running off the canvas at 130%. Midwestside is what proved
  // it: a gold-dominant idle screen handing off to a near-black reveal, twice a
  // minute, for the same franchise. Both surfaces now paint the franchise's one
  // `broadcastGradient` string (Brandon, 2026-08-28).
  it('both components resolve the franchise gradient', () => {
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must call resolveBroadcastGradient(...)`).toMatch(
        /resolveBroadcastGradient\s*\(/
      );
    }
  });

  it('both components hand it to the SAME custom property', () => {
    // Two different variable names would type-check, pass every unit test, and
    // silently give the two screens separate paint paths again.
    //
    // Quote-agnostic on purpose (Copilot, #641): pinning the single quotes would
    // fail on a formatter run that flipped them, which is a non-behavioural
    // change. The property NAME is the thing being guarded.
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must set --dbc-gradient`).toMatch(/['"`]--dbc-gradient['"`]/);
    }
  });

  it('both surfaces READ that property, with the derived pair as fallback', () => {
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    for (const sel of ['.dbc-idle', '.dbc-reveal']) {
      // Anchored to column 0 with `m`: the TOP-LEVEL rule, not one of the
      // indented `.dbc-idle { height: 100vh }` overrides inside a media query,
      // which is what an unanchored match found first.
      const block =
        new RegExp(`^\\${sel} \\{[\\s\\S]*?\\n\\}`, 'm').exec(css)?.[0] ?? '';
      expect(block, `${sel} rule not found`).not.toBe('');
      expect(block, `${sel} must paint var(--dbc-gradient, …)`).toMatch(
        /background:\s*var\(\s*--dbc-gradient,/
      );
      // The fallback has to stay a real gradient, or a franchise without one
      // (or a board with no team at all) renders with no background.
      expect(block, `${sel} must keep a gradient fallback`).toMatch(/linear-gradient\(/);
    }
  });
});

describe('exit-full-screen chip hides on hover-capable devices only', () => {
  // On a laptop driving the TV the chip should vanish once the board is
  // fullscreen and come back on hover. On a touchscreen there IS no hover to
  // bring it back and no Esc key either, so hiding it there seals the viewer
  // into fullscreen with only the OS gesture as a way out. The whole rule
  // therefore has to sit inside a `hover: hover` query, and the component has
  // to emit the attribute it keys on — either half missing ships one of those
  // two failures.
  const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
  const tsx = readFileSync(
    'src/components/shared/draft-broadcast/DraftBroadcast.tsx',
    'utf-8'
  );

  /** Rules that hide the chip, in any of the ways CSS can hide something.
   *  An earlier version of this guard only knew `opacity: 0`, so a top-level
   *  `visibility: hidden` — which is WORSE, because it also stops the chip
   *  being hoverable — walked straight past it. */
  const HIDES =
    /\[data-in-fullscreen=['"]true['"]\][^{]*\{[^}]*(opacity:\s*0(\.0+)?(%|\b)|display:\s*none|visibility:\s*hidden)/;

  /** True only for a query that means "the pointer driving this device hovers
   *  and is precise" — i.e. the whole shipped gate, both halves. `.includes()`
   *  is not enough: `not all and (hover: hover)` is the exact INVERSION of the
   *  gate — hide on touch only — and contains the string, and `any-hover`
   *  reports on a device's non-primary inputs rather than the one in use.
   *  `pointer: fine` is required too, so that widening the gate has to come
   *  with a deliberate edit here rather than sliding past a green suite. */
  const isHoverCapableQuery = (condition: string) =>
    /(^|[^-\w])hover:\s*hover/.test(condition) &&
    /(^|[^-\w])pointer:\s*fine/.test(condition) &&
    !/\bnot\b/.test(condition);

  /** Split the stylesheet into its @media blocks plus the top level outside
   *  them, so a hiding rule added where a touchscreen would read it is what
   *  fails this. */
  const { hoverBlocks, outside } = (() => {
    const blocks: string[] = [];
    let rest = '';
    let i = 0;
    while (i < css.length) {
      const at = css.indexOf('@media', i);
      if (at === -1) {
        rest += css.slice(i);
        break;
      }
      rest += css.slice(i, at);
      const open = css.indexOf('{', at);
      let depth = 0;
      let j = open;
      for (; j < css.length; j += 1) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const block = css.slice(at, j + 1);
      if (isHoverCapableQuery(css.slice(at + '@media'.length, open))) {
        blocks.push(block);
      } else {
        rest += block;
      }
      i = j + 1;
    }
    return { hoverBlocks: blocks, outside: rest };
  })();

  it('classifies media queries by what they actually mean', () => {
    // Guards the classifier itself — it is the only thing standing between
    // the two assertions below and a stylesheet that passes them backwards.
    expect(isHoverCapableQuery(' (hover: hover) and (pointer: fine) ')).toBe(true);
    expect(isHoverCapableQuery(' not all and (hover: hover) ')).toBe(false);
    expect(isHoverCapableQuery(' (any-hover: hover) and (any-pointer: fine) ')).toBe(false);
    expect(isHoverCapableQuery(' (hover: hover) ')).toBe(false);
    expect(isHoverCapableQuery(' (max-width: 640px) ')).toBe(false);
    expect(hoverBlocks.length).toBeGreaterThan(0);
  });

  it('the component marks the button with data-in-fullscreen, not inverted', () => {
    // Presence alone is not enough: flipping the ternary satisfies a `has the
    // attribute` check while hiding the chip BEFORE fullscreen and leaving it
    // on the TV during.
    expect(tsx.replace(/\s+/g, ' ')).toContain(
      "data-in-fullscreen={isFullscreen ? 'true' : 'false'}"
    );
  });

  it('every rule that hides the chip sits inside a hover-capable query', () => {
    expect(
      HIDES.test(outside),
      'a touchscreen would read this rule and lose its only way out of fullscreen'
    ).toBe(false);
    expect(
      hoverBlocks.some((b) => HIDES.test(b)),
      'nothing hides the chip on a hover-capable device — the ask was hover-only there'
    ).toBe(true);
  });

  it('hover and keyboard focus both bring it back', () => {
    const block = hoverBlocks.find((b) => HIDES.test(b))!;
    expect(
      /:hover[^{]*\[data-in-fullscreen=['"]true['"]\][^{]*\{[^}]*opacity:\s*1/.test(block),
      'hover must reveal the chip it just hid'
    ).toBe(true);
    expect(
      /\[data-in-fullscreen=['"]true['"]\]:focus-visible[^{]*\{[^}]*opacity:\s*1/.test(block),
      'keyboard focus must reveal it too — hover is not the only way in'
    ).toBe(true);
  });

  it('never groups :hover and :focus-visible in one chip selector list', () => {
    // One unsupported pseudo-class invalidates the ENTIRE selector list per
    // spec. Grouped, a UA without :focus-visible drops the reveal and keeps
    // the hide — a chip nothing on the machine can bring back. Scoped to the
    // chip on purpose: elsewhere in this file the same grouping only costs a
    // hover highlight on an element that was visible anyway.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const grouped = bare.match(
      /[^{}]*dbc__fullscreen[^{}]*(:hover[^{;]*,[^{]*:focus-visible|:focus-visible[^{;]*,[^{]*:hover)[^{]*\{/
    );
    expect(grouped, `grouped chip selector: ${grouped?.[0]?.trim()}`).toBe(null);
  });

  it('the hover reach is not itself a click target', () => {
    // The reach around the chip is a wrapper with no handler, not an ::before
    // apron on the button — an apron would make that whole invisible
    // rectangle an exit-fullscreen button you can hit without seeing it.
    expect(css).toContain('.dbc__fullscreen-zone');
    expect(
      /\.dbc__fullscreen(\[[^\]]*\])?::before/.test(css),
      'an ::before on the chip is part of ITS hit area — use the zone wrapper'
    ).toBe(false);
    expect(tsx).not.toMatch(/dbc__fullscreen-zone[^>]*onClick/);
  });
});

describe('the board serves single-unit leagues too', () => {
  /**
   * The broadcast started as an AFL page, where the league drafts by CONFERENCE
   * — two independent boards, hence `?conference=`. TheLeague drafts as ONE
   * `LEAGUE` unit, so everything built around switching between boards has to
   * collapse rather than render a lone dead control pointing at the board the
   * viewer is already on.
   */
  const onTheClock = readFileSync(
    'src/components/shared/draft-broadcast/OnTheClock.tsx',
    'utf-8'
  );

  it('the conference switcher is gated on there being more than one', () => {
    expect(onTheClock).toMatch(/conferences\.length > 1 &&\s*\n?\s*conferences\.map/);
  });

  it('both league pages exist and share the one island', () => {
    for (const page of [
      'src/pages/afl-fantasy/draft-broadcast.astro',
      'src/pages/theleague/draft-broadcast.astro',
    ]) {
      const src = readFileSync(page, 'utf-8');
      expect(src, `${page} must import the shared island`).toMatch(
        /components\/shared\/draft-broadcast\/DraftBroadcast/
      );
    }
  });

  it('TheLeague page ranks its board against ROOKIES, not every free agent', () => {
    // A rookies-only draft ranked against the whole unrostered dynasty pool
    // makes every pick in the class read as a massive reach — 1.01 came back
    // as board rank #300-something. Non-rookies have to join the off-board set.
    const src = readFileSync('src/pages/theleague/draft-broadcast.astro', 'utf-8');
    expect(src).toMatch(/if \(!p\.isRookie\) offBoardIds\.add/);
    expect(src).toMatch(/assignBoardRanks\(enriched,\s*offBoardIds\)/);
  });

  it('builds the player pool exactly ONCE per request', () => {
    // `loadRawPlayers` is uncached, so every buildDraftPlayers call re-reads and
    // re-parses the 1.38 MB players.json. A second call to recompute rookie
    // status paid that on every SSR request for a flag the first call already
    // stamped on each player (`isRookie`, same predicate).
    const src = readFileSync('src/pages/theleague/draft-broadcast.astro', 'utf-8');
    const calls = src.match(/buildDraftPlayers\(/g) ?? [];
    expect(calls.length, 'one buildDraftPlayers call per request, not two').toBe(1);
  });
});

describe('a traded pick names the team it came from, and nothing else', () => {
  /**
   * `[Pick traded from Bring the Pain.]` reached a 65-inch screen as
   * "Pick 1.11 · via from Bring the Pain".
   *
   * The parser's `(?:traded|traded from)` alternation could not reach its
   * second branch — alternation is ordered, `traded` matched first every time,
   * and `(.+?)` swallowed the ` from `. Every consumer supplies its own
   * preposition ("via", "from", "Originally owned by"), so the prefix reads
   * twice wherever it renders, and every `config.name === originalTeamName`
   * crest lookup misses in silence.
   */
  it('strips the "from", which the old alternation could never consume', () => {
    expect(parseTradeFromComment('[Pick traded from Bring the Pain.] ')).toBe(
      'Bring the Pain'
    );
  });

  it('reads a statement MFL did not wrap in brackets', () => {
    // 77 comments in the committed feeds carry no brackets at all. The old
    // pattern opened with `\[`, so every one of them read as UNTRADED.
    expect(parseTradeFromComment('Pick traded from Da Dangsters.')).toBe(
      'Da Dangsters'
    );
  });

  it('reads the hop out of a multi-statement block', () => {
    // MFL puts several statements in ONE bracket block, newline-separated, so
    // `.]` never follows the team name and `.` does not cross the newline.
    // 93 of 250 bracketed trade comments were missed on this alone.
    expect(
      parseTradeFromComment(
        '[Pick traded from Bring the Pain.\nPick made from Pre-Draft List] '
      )
    ).toBe('Bring the Pain');
  });

  it('reads a statement that sits AFTER a closed block', () => {
    // Line-anchoring with `^` would fail this one.
    expect(
      parseTradeFromComment(
        '[Pick made based on Pre-Draft List] Pick traded from Maverick.'
      )
    ).toBe('Maverick');
  });

  it('takes the FIRST hop — the original owner, not an intermediate', () => {
    // MFL appends a line per hop, oldest first. Verified against TheLeague's
    // 2023 `draftType: SAME` feed: position 07 belongs to The Music City
    // Mafia, and 3.07's first line names it.
    expect(
      parseTradeFromComment(
        '[Pick traded from The Music City Mafia.\nPick traded from Vitside Mafia.\nPick traded from Bring the Pain.]'
      )
    ).toBe('The Music City Mafia');
  });

  it('cannot let a capture run across a closing bracket', () => {
    // The name is bounded to one line AND cannot cross `]`, so a malformed
    // comment yields nothing rather than a garbage team name that silently
    // resolves to no crest.
    expect(parseTradeFromComment('Pick traded from A] trailing.')).toBeUndefined();
  });

  it('never reports the RECIPIENT of a "traded to" line as the origin', () => {
    // `Pick traded to <TEAM>` names the team that received the pick. An
    // optional `from` matches this and reports the origin exactly backwards.
    expect(parseTradeFromComment('Pick traded to Dream')).toBeUndefined();
    expect(parseTradeFromComment('[Pick traded to Dream.]')).toBeUndefined();
  });

  it('ignores owner chatter that merely contains the word "traded"', () => {
    for (const comment of [
      'Vit, you traded away your whole draft.',
      'Almost traded this one.',
      'The rights to Duke Johnson has been traded to Wabbits.',
      'Player to be traded to Heavy Chevy.',
    ]) {
      expect(parseTradeFromComment(comment), comment).toBeUndefined();
    }
  });

  it('trims the double space MFL writes after "from"', () => {
    // Real string from data/theleague/mfl-feeds — a leading space fails an
    // exact name match exactly as invisibly as the "from " prefix did.
    expect(
      parseTradeFromComment('[Pick traded from  Running Down The Dream.]')
    ).toBe('Running Down The Dream');
  });

  it('keeps a team name that legitimately contains a period', () => {
    expect(
      parseTradeFromComment("[Pick traded from Be Gentle. It's my first time..]")
    ).toBe("Be Gentle. It's my first time.");
  });

  it('returns undefined for the non-trade comments MFL also writes', () => {
    for (const comment of [
      '',
      '[Pick made from Pre-Draft List] ',
      '[Pick added by commissioner.] ',
      'Pick going to Wabbits ',
    ]) {
      expect(parseTradeFromComment(comment), comment).toBeUndefined();
    }
  });

  it('resolves against the real feed, so no committed comment yields a prefix', () => {
    // The bug was invisible to a unit test built only from hand-written
    // fixtures — it took the shape MFL actually emits to expose it.
    const feed = 'data/theleague/mfl-feeds/2023/draftResults.json';
    if (!existsSync(feed)) return;
    const raw = JSON.parse(readFileSync(feed, 'utf-8'));
    const picks = raw?.draftResults?.draftUnit?.draftPick ?? [];
    const names = picks
      .map((p: { comments?: string }) => parseTradeFromComment(p.comments || ''))
      .filter(Boolean) as string[];

    expect(names.length, 'the 2023 feed has traded picks to parse').toBeGreaterThan(0);

    // Every comment that says so is parsed — the bracket anchor used to drop
    // the multi-statement ones, which read as untraded rather than as broken.
    const claimTrade = picks.filter((p: { comments?: string }) =>
      /Pick traded from /.test(p.comments || '')
    ).length;
    expect(names.length, 'no trade statement goes unparsed').toBe(claimTrade);

    for (const name of names) {
      expect(name, 'a parsed name is bare — the caller adds the preposition')
        .not.toMatch(/^from\b/i);
      expect(name).toBe(name.trim());
    }
  });

  it('no consumer re-strips the prefix downstream, anywhere in src/', () => {
    // BoardCell carried a local `replace(/^from\s+/i, '')`, which fixed the one
    // cell it ran in while the title beside it still read "via from X". The fix
    // belongs in the parser; a second copy anywhere means it regressed.
    //
    // Scans all of src/ rather than naming BoardCell: pinning the one file that
    // happened to have the workaround would not notice the same line reappearing
    // in a sibling draft widget, which is how it got there in the first place.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|astro|mjs)$/.test(entry.name)) {
          // Tolerate the spacing variants: `replace(/^from`, `replace(/^\s*from`,
          // `replace(/ ^\s+from`. Matching only the exact original spelling would let
          // the same workaround back in under a one-character edit.
          if (/replace\(\s*\/\^[^/]{0,12}from/i.test(readFileSync(full, 'utf-8'))) offenders.push(full);
        }
      }
    };
    walk('src');
    expect(offenders, 'strip the "from " prefix in parseTradeFromComment, not at a render site').toEqual([]);
  });

  it('the broadcast board carries the bare name onto the stage', () => {
    const board = buildConferenceBoard(
      {
        draftResults: {
          draftUnit: {
            unit: 'CONFERENCE00',
            draftPick: [
              { round: '01', pick: '11', franchise: '0003', player: '', comments: '[Pick traded from Bring the Pain.]' },
              { round: '01', pick: '12', franchise: '0004', player: '', comments: '' },
            ],
          },
        },
      },
      'CONFERENCE00'
    );

    const traded = board.picks[0];
    expect(traded.isTraded).toBe(true);
    expect(traded.originalTeamName).toBe('Bring the Pain');
    // The literal string OnTheClock builds around it.
    expect(` · via ${traded.originalTeamName}`).toBe(' · via Bring the Pain');
    expect(board.picks[1].isTraded).toBe(false);
  });
});

// ── The screensaver ──────────────────────────────────────────────────────────
//
// An email draft can leave the idle board on one frame for six hours. After ten
// idle minutes the board replays itself from 1.01, reveal to reveal, and any
// real pick ends the reel instantly. The timing lives in the component; what is
// pinned here is every decision the component asks these helpers to make.

describe('screensaverReel', () => {
  it('replays the draft from the beginning, not from the newest pick', () => {
    // The opposite of `recentPicks`, deliberately: this is the night told
    // forwards, so 1.01 opens it.
    const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4)];
    expect(screensaverReel(board).map((p) => p.overallPickNumber)).toEqual([1, 2, 3]);
  });

  it('sorts by pick number rather than trusting the board order', () => {
    // MFL lets a commissioner fill a slot out of order, and the array comes back
    // in whatever order it comes back in. The pick numbers are the truth.
    const board = [slot(3, 'c'), slot(1, 'a'), slot(2, 'b')];
    expect(screensaverReel(board).map((p) => p.overallPickNumber)).toEqual([1, 2, 3]);
  });

  it('is empty before the draft starts, so there is nothing to arm', () => {
    expect(screensaverReel([slot(1), slot(2)])).toEqual([]);
  });

  it('does not reorder the caller\'s board', () => {
    const board = [slot(3, 'c'), slot(1, 'a')];
    screensaverReel(board);
    expect(board.map((p) => p.overallPickNumber)).toEqual([3, 1]);
  });
});

describe('screensaverAnchorMs', () => {
  const opened = 1_000_000;
  const stamped = (overall: number, id: string, sec: number) => ({
    ...slot(overall, id),
    timestamp: String(sec),
  });

  it('counts from the newest pick — the same instant the on-screen clock does', () => {
    const board = [stamped(1, 'a', 2_000), stamped(2, 'b', 5_000)];
    expect(screensaverAnchorMs(board, opened)).toBe(5_000_000);
  });

  it('floors to when the board was opened, so a reload gets the live screen', () => {
    // The whole point of reloading mid-draft is to see the live state. Without
    // this floor a stalled draft answers the reload by replaying immediately and
    // the on-the-clock screen never appears at all.
    const board = [stamped(1, 'a', 2_000)];
    expect(screensaverAnchorMs(board, 9_000_000)).toBe(9_000_000);
  });

  it('floors to the end of the last reel, so passes do not run back to back', () => {
    // Without this the anchor is still the same hours-old pick the moment the
    // reel ends, and the idle board — the half that says whose turn it is —
    // never gets the screen again.
    const board = [stamped(1, 'a', 2_000)];
    expect(screensaverAnchorMs(board, opened, 8_000_000)).toBe(8_000_000);
  });

  it('survives a board whose picks carry no usable stamp', () => {
    expect(screensaverAnchorMs([slot(1, 'a')], opened)).toBe(opened);
  });
});

describe('isScreensaverDue', () => {
  it('waits out the full idle window', () => {
    expect(isScreensaverDue(0, SCREENSAVER_IDLE_MS - 1)).toBe(false);
    expect(isScreensaverDue(0, SCREENSAVER_IDLE_MS)).toBe(true);
  });

  it('is ten minutes by default', () => {
    expect(SCREENSAVER_IDLE_MS).toBe(600_000);
  });

  it('is never due when switched off', () => {
    // `?screensaver=off` resolves to 0, and "off" has to mean off however long
    // the board has been sitting there.
    expect(isScreensaverDue(0, Number.MAX_SAFE_INTEGER, 0)).toBe(false);
    expect(isScreensaverDue(0, Number.MAX_SAFE_INTEGER, Number.NaN)).toBe(false);
  });
});

describe('resolveScreensaverIdleMs', () => {
  it('defaults to the ten-minute window', () => {
    for (const raw of [null, undefined, '']) {
      expect(resolveScreensaverIdleMs(raw)).toBe(SCREENSAVER_IDLE_MS);
    }
  });

  it('takes SECONDS, so the feature can be watched without a ten-minute wait', () => {
    expect(resolveScreensaverIdleMs('20')).toBe(20_000);
  });

  it('switches off on every spelling of off', () => {
    for (const raw of ['off', 'OFF', 'no', 'false', '0']) {
      expect(resolveScreensaverIdleMs(raw)).toBe(0);
    }
  });

  it('falls back to the default on a typo rather than to off', () => {
    // A mistyped debug parameter must not silently remove a feature from draft
    // night — same reasoning as resolveWarmDepth.
    for (const raw of ['soon', '-5', 'off?']) {
      expect(resolveScreensaverIdleMs(raw)).toBe(SCREENSAVER_IDLE_MS);
    }
  });
});

describe('the screensaver never impersonates a live pick', () => {
  const read = (f: string) =>
    readFileSync(`src/components/shared/draft-broadcast/${f}`, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');

  it('a fresh pick clears the cycle inside ingest', () => {
    // The interrupt has to live where "new" is known. Arming is timing and can
    // live in an effect; cancelling cannot, because only `ingest` can tell a
    // pick that just landed from one that was already on the board.
    const code = read('DraftBroadcast.tsx');
    const ingest = code.slice(code.indexOf('const ingest ='), code.indexOf('Rehearsal replay'));
    expect(ingest).toMatch(/fresh\.length > 0[\s\S]*setPlaylist\(null\)/);
  });

  it('a live reveal outranks every screensaver scene', () => {
    // `current ? … : scene…`, never the other way round: a pick that just
    // landed is always the better screen, whatever the cycle was showing.
    const code = read('DraftBroadcast.tsx');
    const stage = code.slice(code.indexOf('const activeStage'), code.indexOf('const showingReveal'));
    expect(stage).toMatch(/^\s*const activeStage[^=]*=\s*current\s*\?/);
    expect(stage).toMatch(/scene\?\.kind === 'pick'/);
  });

  it('the replayed card is flagged as a rewind', () => {
    // The card is otherwise identical to a live reveal, so without the flag the
    // room has no way to tell a replay of 1.04 from a pick that just landed.
    expect(read('DraftBroadcast.tsx')).toMatch(/rewind:\s*\{/);
    expect(read('BroadcastRevealCard.tsx')).toMatch(/dbc-reveal__rewind-flag/);
  });

  it('the rewind counter is the REEL\'s, not the cycle\'s', () => {
    // The panels sit in front of the picks in the playlist, so a raw scene
    // index would open the reel at "pick 4 of 51" on a 48-pick board.
    const code = read('DraftBroadcast.tsx');
    expect(code).toMatch(/position: sceneIndex - reelSpan\.first \+ 1/);
  });

  it('the rewind flag says who is actually on the clock', () => {
    // The reel takes the one fact the room needs off the screen, so the flag
    // carries it — otherwise a ten-minute reel is ten minutes of not knowing
    // whose turn it is.
    expect(read('BroadcastRevealCard.tsx')).toMatch(/on the clock/);
  });

  it('the flag is painted, not left to inherit the rehearsal chip', () => {
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    expect(css).toMatch(/\.dbc-reveal__rewind-flag\s*\{/);
    // It shares the rehearsal flag's absolute box — one slot, one chip.
    expect(css).toMatch(/\.dbc-reveal__rehearsal-flag,\s*\n\.dbc-reveal__rewind-flag \{/);
  });

  it('both league pages hand the island the idle threshold', () => {
    for (const page of ['afl-fantasy', 'theleague']) {
      const src = readFileSync(`src/pages/${page}/draft-broadcast.astro`, 'utf-8');
      expect(src, `${page} must resolve ?screensaver=`).toMatch(
        /screensaverIdleMs:\s*resolveScreensaverIdleMs\(/
      );
    }
  });
});

// ── The screensaver's other three screens ────────────────────────────────────
//
// The reel answers "what happened tonight". These answer the two questions a
// slow draft actually leaves the room asking: what does the man on the clock
// already have, and how much of each position is gone. Both are LIVE screens —
// built from the board as it stands — which is why neither is flagged as a
// rewind and why the cycle puts them in FRONT of the reel.

describe('buildScreensaverPlaylist', () => {
  const board = (madeThrough: number, slots = 6) =>
    Array.from({ length: slots }, (_, i) =>
      i < madeThrough ? slot(i + 1, `p${i + 1}`, `000${(i % 3) + 1}`) : slot(i + 1, '', `000${(i % 3) + 1}`)
    );

  it('leads with the present tense and ends with the reel', () => {
    // Panels first is the whole editorial decision: in a draft this slow every
    // question the room has is present-tense, and the reel is the nostalgia
    // after it.
    const scenes = buildScreensaverPlaylist(board(3));
    expect(scenes.slice(0, 3).map((s) => s.kind)).toEqual(['roster', 'roster', 'positions']);
    expect(scenes.slice(3).every((s) => s.kind === 'pick')).toBe(true);
    expect(scenes.filter((s) => s.kind === 'pick')).toHaveLength(3);
  });

  it('shows the team on the clock, then the team on deck', () => {
    const scenes = buildScreensaverPlaylist(board(3));
    const rosters = scenes.filter((s) => s.kind === 'roster') as Extract<
      ReturnType<typeof buildScreensaverPlaylist>[number],
      { kind: 'roster' }
    >[];
    expect(rosters.map((r) => r.role)).toEqual(['clock', 'deck']);
    // Slots 4 and 5 on this board — franchises 0001 and 0002.
    expect(rosters.map((r) => r.franchiseId)).toEqual(['0001', '0002']);
  });

  it('never shows the same franchise twice in a row', () => {
    // Back-to-back picks are ordinary once a pick has been traded, and the same
    // roster twice running is a cycle that looks stuck.
    const picks = [slot(1, 'a', '0001'), slot(2, '', '0007'), slot(3, '', '0007')];
    const scenes = buildScreensaverPlaylist(picks);
    expect(scenes.filter((s) => s.kind === 'roster')).toHaveLength(1);
  });

  it('is empty before the draft starts, which is what stops it arming', () => {
    expect(buildScreensaverPlaylist([slot(1), slot(2)])).toEqual([]);
  });

  it('still plays the reel and the tally on a COMPLETE board', () => {
    // Nobody is on the clock and nobody is on deck, so the roster panels drop
    // out — the rest of the cycle has to survive that.
    const scenes = buildScreensaverPlaylist(board(6));
    expect(scenes.filter((s) => s.kind === 'roster')).toHaveLength(0);
    expect(scenes[0].kind).toBe('positions');
    expect(scenes.filter((s) => s.kind === 'pick')).toHaveLength(6);
  });

  it('gives a panel longer than a pick, because a panel has to be READ', () => {
    expect(screensaverSceneMs({ kind: 'positions' })).toBe(SCREENSAVER_PANEL_MS);
    expect(screensaverSceneMs({ kind: 'pick', pick: slot(1, 'a') })).toBe(SCREENSAVER_STEP_MS);
    expect(SCREENSAVER_PANEL_MS).toBeGreaterThan(SCREENSAVER_STEP_MS);
  });
});

describe('positionTallies', () => {
  const pool = new Map<string, BroadcastPlayer>([
    ['q1', player('q1', 'QB')],
    ['r1', player('r1', 'RB')],
    ['r2', player('r2', 'RB')],
    ['w1', player('w1', 'WR')],
    ['k1', player('k1', 'K')],
    ['d1', { ...player('d1', 'DEF'), name: 'Kansas City Chiefs' } as BroadcastPlayer],
  ]);

  it('counts what is off the board, newest face first', () => {
    const picks = [slot(1, 'r1'), slot(2, 'w1'), slot(3, 'r2')];
    const rows = positionTallies(picks, pool);
    const rb = rows.find((r) => r.position === 'RB')!;
    expect(rb.count).toBe(2);
    // 3.x landed after 1.x, so r2 leads the row.
    expect(rb.players.map((p) => p.id)).toEqual(['r2', 'r1']);
  });

  it('keeps the rows in a FIXED order, not sorted by count', () => {
    // A board that re-sorts itself makes the room re-read it every cycle.
    const picks = [slot(1, 'w1'), slot(2, 'r1'), slot(3, 'q1'), slot(4, 'd1')];
    expect(positionTallies(picks, pool).map((r) => r.position)).toEqual([
      'QB',
      'RB',
      'WR',
      'DEF',
    ]);
  });

  it('omits a position nobody has taken rather than drawing a zero', () => {
    // An empty row on a TV reads as a loading state.
    const rows = positionTallies([slot(1, 'q1')], pool);
    expect(rows.map((r) => r.position)).toEqual(['QB']);
  });

  it('files a kicker under PK however the pool spells him', () => {
    // The pool has spelled kickers both ways, and a K row that silently became
    // OTHER is a row the room reads as a bug.
    expect(positionTallies([slot(1, 'k1')], pool)[0].position).toBe('PK');
  });

  it('still COUNTS a pick the pool cannot name', () => {
    // The position is unknowable without him, but dropping the pick would make
    // the panel's total disagree with the board's.
    const rows = positionTallies([slot(1, 'ghost')], pool);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    // ...and he contributes no face, rather than an undefined one.
    expect(rows[0].players).toEqual([]);
  });
});

describe('rosterRows', () => {
  const pool = new Map<string, BroadcastPlayer>([
    ['r1', player('r1', 'RB')],
    ['w1', player('w1', 'WR')],
  ]);
  const held = [
    { id: 'h1', name: 'Held Back', position: 'RB', nflTeam: 'KCC' },
    { id: 'h2', name: 'Kept Wide', position: 'WR', nflTeam: 'GBP' },
  ];

  it('merges what he holds with what he has taken tonight', () => {
    const picks = [slot(1, 'r1', '0001'), slot(2, 'w1', '0002')];
    const rows = rosterRows(held, picks, pool, '0001');
    expect(rows.map((r) => `${r.position}:${r.count}`)).toEqual(['RB:2', 'WR:1']);
  });

  it("counts only THIS franchise's picks", () => {
    const picks = [slot(1, 'r1', '0001'), slot(2, 'w1', '0002')];
    const rb = rosterRows(held, picks, pool, '0001').find((r) => r.position === 'RB')!;
    expect(rb.players.map((p) => p.id)).toEqual(['r1', 'h1']);
  });

  it('puts tonight first and labels it with the pick', () => {
    // The contrast between what he walked in with and what he has done about it
    // is the entire point of showing this mid-draft.
    const rows = rosterRows(held, [slot(14, 'r1', '0001')], pool, '0001');
    const rb = rows.find((r) => r.position === 'RB')!;
    expect(rb.players[0].pickLabel).toBe('2.02');
    expect(rb.players[1].pickLabel).toBeUndefined();
  });

  it('counts a man once when the roster feed has already caught up', () => {
    // rosters.json is a cron snapshot that starts gaining tonight's picks
    // partway through the draft, so the same man legitimately arrives from both
    // sides. The board wins — it is the side that knows which pick he was.
    const alsoHeld = [...held, { id: 'r1', name: 'Player r1', position: 'RB', nflTeam: 'KCC' }];
    const rb = rosterRows(alsoHeld, [slot(1, 'r1', '0001')], pool, '0001').find(
      (r) => r.position === 'RB'
    )!;
    expect(rb.count).toBe(2);
    expect(rb.players.filter((p) => p.id === 'r1')).toHaveLength(1);
    expect(rb.players[0].pickLabel).toBe('1.01');
  });

  it('survives a franchise with no holdings at all', () => {
    expect(rosterRows(undefined, [], pool, '0001')).toEqual([]);
  });
});

describe('faceLabel', () => {
  it('drops the first name, which the chip has no room for', () => {
    expect(faceLabel('Omarion Hampton', 'RB')).toBe('Hampton');
    expect(faceLabel('Amon-Ra St. Brown', 'WR')).toBe('St. Brown');
  });

  it('gives a team defense its CODE, not a half-name', () => {
    // Dropping the first token of "Kansas City Chiefs" leaves "City Chiefs",
    // which is the kind of small wrongness a room spots instantly.
    expect(faceLabel('Kansas City Chiefs', 'DEF', 'KCC')).toBe('KCC');
  });

  it('never returns an empty caption', () => {
    expect(faceLabel('Ogunbowale', 'RB')).toBe('Ogunbowale');
    expect(faceLabel('', 'DEF', 'GBP')).toBe('GBP');
  });
});

describe('the panels are wired to real data, not decoration', () => {
  const read = (f: string) => readFileSync(`src/${f}`, 'utf-8');

  it('both league pages ship what each franchise holds', () => {
    // Without holdings the roster panel is just tonight's picks, which for a
    // rookie draft is three players and answers nothing.
    for (const page of ['afl-fantasy', 'theleague']) {
      const src = read(`pages/${page}/draft-broadcast.astro`);
      expect(src, `${page} must load holdings`).toMatch(/loadFranchiseHoldings\(/);
      expect(src, `${page} must ship holdings on the page data`).toMatch(/^\s*holdings,$/m);
    }
  });

  it('holdings resolve against the UNTRIMMED pool', () => {
    // trimToDraftable drops everyone nobody will draft — which is exactly what
    // a keeper IS. Passing the trimmed pool leaves every panel empty.
    for (const page of ['afl-fantasy', 'theleague']) {
      const src = read(`pages/${page}/draft-broadcast.astro`);
      const call = /loadFranchiseHoldings\(([\s\S]*?)\);/.exec(src)?.[1] ?? '';
      expect(call, `${page} passes the trimmed pool to loadFranchiseHoldings`).toMatch(
        /\branked\b/
      );
      expect(call).not.toMatch(/\bplayers\b/);
    }
  });

  it('the face chip has ONE implementation, shared by all three surfaces', () => {
    // The 404 walk it does is subtle enough (a pre-hydration failure the event
    // never replays; a defense whose single entry must hide rather than fall
    // back) that a hand-copied second version would be a second source of the
    // same bugs.
    for (const f of ['OnTheClock.tsx', 'BroadcastPanel.tsx']) {
      expect(
        read(`components/shared/draft-broadcast/${f}`),
        `${f} must render BroadcastFace rather than its own chip`
      ).toMatch(/<BroadcastFace\b/);
    }
    // ...and only the shared module builds the cascade.
    const owners = ['BroadcastFace.tsx', 'OnTheClock.tsx', 'BroadcastPanel.tsx'].filter((f) =>
      /getCollegeHeadshot\s*\(/.test(read(`components/shared/draft-broadcast/${f}`))
    );
    expect(owners).toEqual(['BroadcastFace.tsx']);
  });

  it('every panel class the components render is actually styled', () => {
    // The panels are ~20 new class names on a stylesheet that sets no
    // font-family at all — an unstyled row does not vanish, it renders as body
    // text in a stack, which looks like a half-loaded page on a TV.
    const tsx = read('components/shared/draft-broadcast/BroadcastPanel.tsx');
    const css = read('styles/draft-broadcast.css');
    const used = new Set([...tsx.matchAll(/dbc-panel[\w-]*/g)].map((m) => m[0]));
    expect(used.size).toBeGreaterThanOrEqual(12);
    for (const cls of used) {
      expect(css, `.${cls} is rendered but never styled`).toContain(`.${cls}`);
    }
  });

  it('the panels paint through the same gradient property as the reveal', () => {
    // Four screens, one painting path — the reason the idle board and the
    // reveal card stopped disagreeing about a franchise's colours.
    const tsx = read('components/shared/draft-broadcast/BroadcastPanel.tsx');
    expect(tsx).toMatch(/toBroadcastPair\s*\(/);
    expect(tsx).toMatch(/resolveBroadcastGradient\s*\(/);
    expect(tsx).toMatch(/['"`]--dbc-gradient['"`]/);
    expect(tsx).not.toMatch(/team[?.]*\.color(Primary|Secondary)/);
  });
});
