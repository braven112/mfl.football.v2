import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AFL_MOCK_ROUNDS,
  availablePlayers,
  describeMockGate,
  buildAflMockOrder,
  buildRepeatingOrder,
  isMockWindowOpen,
  keeperDeadlineFor,
  picksMadeIn,
  resolveMockWindow,
  rosterCutState,
  rosterFranchisesOf,
  rosteredPlayerIds,
} from '../src/utils/afl-mock-draft';
import { getConferenceTeams } from '../src/utils/afl-conference';
import { selectDraftUnit } from '../src/utils/draft-utils';
import { KEEPER_LIMIT } from '../src/utils/afl-keeper-constants';

/**
 * The AFL mock draft, pinned against the league's REAL feeds.
 *
 * Every rule here is one a plausible implementation gets wrong, and all three
 * of the big ones are invisible in the output: a pool scoped to the wrong
 * conference still looks like a list of available players, a snake order still
 * looks like a draft, and a mock run before the cuts still drafts somebody.
 */

const AFL_FEEDS = 'data/afl-fantasy/mfl-feeds';
const SEASON = 2026;

const readFeed = (file: string, year: number = SEASON) =>
  JSON.parse(readFileSync(join(process.cwd(), AFL_FEEDS, String(year), file), 'utf-8'));

const AL = getConferenceTeams('00').map((t) => t.franchiseId);
const NL = getConferenceTeams('01').map((t) => t.franchiseId);

const unitFor = (code: '00' | '01') =>
  selectDraftUnit<{ round?: string; pick?: string; franchise?: string; player?: string }>(
    readFeed('draftResults.json').draftResults.draftUnit,
    `CONFERENCE${code}`
  );

describe('the two conferences draft from separate pools', () => {
  it('MFL says a player may be rostered once PER CONFERENCE, not per league', () => {
    // This is the whole reason the pool is conference-scoped. If MFL ever
    // changes it, this mock's core assumption changes with it.
    const league = readFeed('league.json').league;
    expect(league.rostersPerPlayer).toBe('1');
    expect(league.playerLimitUnit).toBe('CONFERENCE');
  });

  it('and the 2026 draft proves it — one player went 1.01 in BOTH conferences', () => {
    const firstPickOf = (code: '00' | '01') => {
      const picks = unitFor(code)!.draftPick as Array<Record<string, string>>;
      return picks.find((p) => p.round === '01' && p.pick === '01')!.player;
    };
    expect(firstPickOf('00')).toBe(firstPickOf('01'));
  });

  it('a player kept in the OTHER conference is still available in this one', () => {
    const franchises = rosterFranchisesOf(readFeed('rosters.json'));
    const alRostered = rosteredPlayerIds(franchises, AL);
    const nlRostered = rosteredPlayerIds(franchises, NL);

    // The leagues genuinely overlap — if they didn't, this test would pass
    // vacuously and the scoping bug would sail through it.
    const shared = [...alRostered].filter((id) => nlRostered.has(id));
    expect(shared.length).toBeGreaterThan(0);

    const pool = availablePlayers(
      [...nlRostered].map((id) => ({ id, position: 'WR' })),
      alRostered,
      () => true
    );
    // Every one of the NL's own players is "available" to the AL board except
    // the ones the AL also holds — which is exactly the per-conference rule.
    expect(pool.length).toBe(nlRostered.size - shared.length);
  });

  it('scoping to a conference is not the same as scoping to the league', () => {
    const franchises = rosterFranchisesOf(readFeed('rosters.json'));
    const alOnly = rosteredPlayerIds(franchises, AL);
    const bothConferences = rosteredPlayerIds(franchises, [...AL, ...NL]);
    // Subtracting all 24 rosters would delete hundreds more players than the
    // rules require, and the resulting board would still look plausible.
    expect(bothConferences.size).toBeGreaterThan(alOnly.size);
  });

  it('only counts the franchises asked for', () => {
    const franchises = [
      { id: '0001', player: [{ id: 'a' }, { id: 'b' }] },
      { id: '0013', player: [{ id: 'c' }] },
    ];
    expect([...rosteredPlayerIds(franchises, ['0001'])]).toEqual(['a', 'b']);
  });

  it('handles MFL returning a lone player bare instead of in an array', () => {
    expect([...rosteredPlayerIds([{ id: '0001', player: { id: 'solo' } as never }], ['0001'])]).toEqual([
      'solo',
    ]);
  });
});

describe('the AFL draft is a straight repeat, never a snake', () => {
  it('every round of the real 2026 AL draft opens with the same franchise', () => {
    const picks = unitFor('00')!.draftPick as Array<Record<string, string>>;
    const openers = new Set(
      picks.filter((p) => p.pick === '01').map((p) => p.franchise)
    );
    expect(openers.size).toBe(1);
  });

  it('the fallback order repeats rather than reversing', () => {
    const order = buildRepeatingOrder(['a', 'b', 'c'], 3);
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
    // A snake would have put 'c' second. This is the assertion that would
    // have caught reusing TheLeague's buildSnakeOrder.
    expect(order[3]).toBe('a');
  });

  it('nine rounds — the 16-man roster less seven keepers', () => {
    expect(AFL_MOCK_ROUNDS).toBe(9);
    expect(Number(readFeed('league.json').league.rosterSize) - KEEPER_LIMIT).toBe(AFL_MOCK_ROUNDS);
  });
});

describe('draft order comes from MFL when MFL has it', () => {
  it('uses the feed, which carries traded picks a reconstruction cannot', () => {
    const order = buildAflMockOrder(unitFor('00'), AL, AFL_MOCK_ROUNDS);
    expect(order.length).toBe(AFL_MOCK_ROUNDS * AL.length);

    const round1 = order.slice(0, 12);
    const round2 = order.slice(12, 24);
    // 2026's AL swapped two picks between rounds 1 and 2. A repeat-round-one
    // reconstruction would produce identical rounds and lose the trade.
    expect(round2).not.toEqual(round1);
    expect([...round2].sort()).toEqual([...round1].sort());
  });

  it('falls back to a repeating order when the unit is empty', () => {
    const order = buildAflMockOrder(null, ['a', 'b'], 2);
    expect(order).toEqual(['a', 'b', 'a', 'b']);
  });

  it('falls back rather than ending a mock early on a partial unit', () => {
    // A unit that only covers two rounds must not truncate a nine-round mock.
    const partial = { draftPick: [{ round: '01', pick: '01', franchise: 'a' }] };
    expect(buildAflMockOrder(partial, ['a', 'b'], 3)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  });

  it('counts only picks that were actually made', () => {
    expect(
      picksMadeIn({
        draftPick: [
          { round: '01', pick: '01', franchise: 'a', player: '123' },
          { round: '01', pick: '02', franchise: 'b' },
        ],
      })
    ).toBe(1);
    // Pre-draft MFL pre-populates the slots with franchises and no players.
    expect(picksMadeIn({ draftPick: [{ round: '01', pick: '01', franchise: 'a' }] })).toBe(0);
  });
});

describe('the keeper deadline comes from the league calendar', () => {
  it('July 15, 8:45pm — read, not re-typed', () => {
    const deadline = keeperDeadlineFor(2026)!;
    expect(deadline.getMonth()).toBe(6); // July
    expect(deadline.getDate()).toBe(15);
    expect(deadline.getHours()).toBe(20);
    expect(deadline.getMinutes()).toBe(45);
  });

  it('tracks the season it is asked about', () => {
    expect(keeperDeadlineFor(2031)!.getFullYear()).toBe(2031);
  });
});

describe('roster cut state', () => {
  const franchises = [
    { id: '0001', player: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}` })) },
    { id: '0002', player: Array.from({ length: 19 }, (_, i) => ({ id: `b${i}` })) },
    { id: '0003', player: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` })) },
  ];

  it('a franchise at the limit is done', () => {
    expect(rosterCutState(franchises, ['0001']).pending).toEqual([]);
  });

  it('a franchise BELOW the limit is also done — dropping an 8th is allowed', () => {
    expect(rosterCutState(franchises, ['0003']).pending).toEqual([]);
  });

  it('names who is still over, worst first', () => {
    const state = rosterCutState(franchises, ['0001', '0002', '0003']);
    expect(state.total).toBe(3);
    expect(state.ready).toBe(2);
    expect(state.pending).toEqual([{ franchiseId: '0002', count: 19 }]);
  });

  it('a franchise missing from the feed is not evidence that it has cut', () => {
    const state = rosterCutState(franchises, ['0001', '0099']);
    expect(state.total).toBe(1);
  });
});

describe('the mock window', () => {
  const clean = { total: 12, ready: 12, pending: [] };
  const dirty = { total: 12, ready: 9, pending: [{ franchiseId: '0002', count: 19 }] };
  const deadline = keeperDeadlineFor(2026);
  const beforeDeadline = new Date(2026, 6, 10);
  const afterDeadline = new Date(2026, 6, 20);

  it('opens once every franchise is down to keepers', () => {
    const w = resolveMockWindow({ cuts: clean, picksMade: 0, poolSize: 900, deadline, now: afterDeadline });
    expect(w.state).toBe('open');
    expect(isMockWindowOpen(w)).toBe(true);
  });

  it('stays shut while anyone still has cuts to make', () => {
    const w = resolveMockWindow({ cuts: dirty, picksMade: 0, poolSize: 900, deadline, now: beforeDeadline });
    expect(w.state).toBe('waiting');
    if (w.state !== 'waiting') throw new Error('unreachable');
    expect(w.pending).toHaveLength(1);
    expect(w.deadlinePassed).toBe(false);
  });

  it('says the cuts are LATE once the deadline has passed', () => {
    const w = resolveMockWindow({ cuts: dirty, picksMade: 0, poolSize: 900, deadline, now: afterDeadline });
    if (w.state !== 'waiting') throw new Error('unreachable');
    expect(w.deadlinePassed).toBe(true);
  });

  it('the real draft is checked FIRST, so a finished draft never reads as "waiting on cuts"', () => {
    // Post-draft, rosters climb back to 16 — over the keeper limit. Asking the
    // roster question first would tell an owner in October to go make cuts.
    const postDraft = { total: 12, ready: 0, pending: AL.map((id) => ({ franchiseId: id, count: 16 })) };
    const w = resolveMockWindow({ cuts: postDraft, picksMade: 108, poolSize: 20, deadline, now: new Date(2026, 9, 1) });
    expect(w.state).toBe('drafting');
  });

  it('a single made pick closes the window — the pool is being consumed for real', () => {
    expect(
      resolveMockWindow({ cuts: clean, picksMade: 1, poolSize: 900, deadline, now: afterDeadline }).state
    ).toBe('drafting');
  });

  it('an empty roster feed does NOT open the board against the entire NFL', () => {
    const w = resolveMockWindow({
      cuts: { total: 0, ready: 0, pending: [] },
      picksMade: 0,
      poolSize: 3000,
      deadline,
      now: afterDeadline,
    });
    expect(w.state).toBe('waiting');
  });
});

describe('the window matches what the rosters actually did in 2026', () => {
  /**
   * The claim behind this whole feature — "only useful after the keeper
   * deadline" — is checkable, because the roster history recorded it. These
   * are the real snapshots.
   */
  const cutsOn = (date: string, conference: string[]) => {
    const feed = JSON.parse(
      readFileSync(join(process.cwd(), AFL_FEEDS, String(SEASON), 'roster-history', `rosters-${date}.json`), 'utf-8')
    );
    return rosterCutState(rosterFranchisesOf(feed), conference);
  };

  it('five days before the deadline, most of the league still owes cuts', () => {
    const state = cutsOn('2026-07-10', AL);
    expect(state.pending.length).toBeGreaterThan(0);
  });

  it('the DAY BEFORE the deadline it is still not ready — the date alone is not the gate', () => {
    // This is why the gate reads rosters rather than the calendar: some
    // franchises had already cut, and others were still carrying twenty.
    expect(cutsOn('2026-07-14', AL).pending.length).toBeGreaterThan(0);
  });

  it('and days AFTER the deadline it is ready — in both conferences', () => {
    expect(cutsOn('2026-07-20', AL).pending).toEqual([]);
    expect(cutsOn('2026-07-20', NL).pending).toEqual([]);
    expect(cutsOn('2026-07-20', AL).total).toBe(12);
  });

  it('by draft time rosters are back over the limit, which is why picksMade wins', () => {
    expect(cutsOn('2026-08-31', AL).pending.length).toBeGreaterThan(0);
  });
});

describe('the pool, end to end, on a real cut-week snapshot', () => {
  /**
   * July 20 2026 is the shape this feature exists for: every franchise down to
   * seven, no picks made. Asserts the pool the lobby would open with.
   */
  const feed = JSON.parse(
    readFileSync(
      join(process.cwd(), AFL_FEEDS, String(SEASON), 'roster-history', 'rosters-2026-07-20.json'),
      'utf-8'
    )
  );
  const franchises = rosterFranchisesOf(feed);

  // A stand-in catalogue: every player either conference holds, plus some
  // free agents. Enough to measure the scoping without loading 2,000 rows.
  const everyone = [...rosteredPlayerIds(franchises, [...AL, ...NL])].map((id) => ({
    id,
    position: 'WR',
  }));

  it('opens: 12 teams at the keeper limit and nothing drafted', () => {
    const cuts = rosterCutState(franchises, AL);
    const w = resolveMockWindow({
      cuts,
      picksMade: 0,
      poolSize: 1,
      deadline: keeperDeadlineFor(SEASON),
      now: new Date(2026, 6, 21),
    });
    expect(cuts.total).toBe(12);
    expect(w.state).toBe('open');
  });

  it('keeps the OTHER conference’s keepers in the pool', () => {
    const alRostered = rosteredPlayerIds(franchises, AL);
    const nlRostered = rosteredPlayerIds(franchises, NL);
    const pool = availablePlayers(everyone, alRostered, () => true);
    const poolIds = new Set(pool.map((p) => p.id));

    // Nobody the AL kept is draftable on the AL board…
    for (const id of alRostered) expect(poolIds.has(id)).toBe(false);

    // …but an NL keeper the AL does NOT hold still is. That is the rule the
    // whole feature turns on, and the one a league-wide subtraction breaks.
    const nlOnly = [...nlRostered].filter((id) => !alRostered.has(id));
    expect(nlOnly.length).toBeGreaterThan(0);
    for (const id of nlOnly) expect(poolIds.has(id)).toBe(true);
  });

  it('a league-wide subtraction deletes 24 players the AL could really draft', () => {
    // The concrete cost, in this season's real numbers: each conference kept
    // 84 players and SIXTY of them are the same men — the AFL's best are kept
    // twice over. Subtracting all 24 rosters therefore removes 108 distinct
    // players from a board that should only lose 84, and the 24 it wrongly
    // takes are exactly the NL-only keepers the AL is free to draft.
    const alRostered = rosteredPlayerIds(franchises, AL);
    const nlRostered = rosteredPlayerIds(franchises, NL);
    expect(alRostered.size).toBe(84);
    expect(nlRostered.size).toBe(84);
    expect([...alRostered].filter((id) => nlRostered.has(id))).toHaveLength(60);

    const right = availablePlayers(everyone, alRostered, () => true);
    const wrong = availablePlayers(everyone, rosteredPlayerIds(franchises, [...AL, ...NL]), () => true);
    expect(right).toHaveLength(24);
    expect(wrong).toHaveLength(0);
  });
});

describe('the gate explains itself', () => {
  const opts = {
    short: 'AL',
    label: 'American League',
    nameOf: (id: string) => `Team ${id}`,
    boardHref: '/afl-fantasy/draft/broadcast?conference=00',
    resultsHref: '/afl-fantasy/draft/results?conference=00',
  };

  it('says nothing at all when the window is open', () => {
    expect(describeMockGate({ state: 'open', poolSize: 900 }, opts)).toBeNull();
  });

  it('names who is still cutting, and how many they owe', () => {
    const gate = describeMockGate(
      {
        state: 'waiting',
        pending: [{ franchiseId: '0002', count: 19 }],
        ready: 11,
        total: 12,
        deadline: keeperDeadlineFor(2026),
        deadlinePassed: false,
      },
      opts
    )!;
    expect(gate.bullets).toEqual(['Team 0002 — 19 rostered, 12 still to release']);
    expect(gate.body).toContain('11 of 12');
    expect(gate.note).toContain('July 15');
  });

  it('changes its tone once the deadline is past', () => {
    const gate = describeMockGate(
      {
        state: 'waiting',
        pending: [{ franchiseId: '0002', count: 8 }],
        ready: 11,
        total: 12,
        deadline: keeperDeadlineFor(2026),
        deadlinePassed: true,
      },
      opts
    )!;
    expect(gate.note).toContain('overdue');
  });

  it('points at the live board mid-draft and the results once it is over', () => {
    expect(describeMockGate({ state: 'drafting', picksMade: 4 }, opts)!.link!.href).toBe(opts.boardHref);
    expect(describeMockGate({ state: 'drafting', picksMade: 108 }, opts)!.link!.href).toBe(
      opts.resultsHref
    );
  });

  it('refuses rather than mocking the whole NFL when rosters will not load', () => {
    const gate = describeMockGate(
      { state: 'waiting', pending: [], ready: 0, total: 0, deadline: null, deadlinePassed: false },
      opts
    )!;
    expect(gate.heading).toBe('Rosters are unavailable');
  });
});

describe('a mock’s chat channel', () => {
  /**
   * Two rules, and breaking either is silent.
   *
   * A mock used to chat in the LIVE draft room's channel — so two owners
   * running separate mocks talked over each other, and mock chatter landed in
   * the real room. On the AFL that is worse than untidy: a mock now carries a
   * `pollUnit`, so it would have collided with its own conference's live room
   * on the one day that channel matters.
   *
   * And the replacement id must NOT start with `mock-`: the party routes any
   * such room to its draft-session handler, so `mock-<id>-chat` would not be a
   * chat room at all. Asserted against the party's own predicate.
   */
  const roomSrc = readFileSync(join(process.cwd(), 'party/draft-room.ts'), 'utf-8');
  const drSrc = readFileSync(
    join(process.cwd(), 'src/components/theleague/draft-room/DraftRoom.tsx'),
    'utf-8'
  );

  /** The party's own rule, read from the party rather than restated. */
  const isMockRoom = (id: string) => id.startsWith('mock-') || id.endsWith('-registry');

  it('the party still routes rooms the way this test assumes', () => {
    expect(roomSrc).toContain("roomId.startsWith('mock-') || roomId.endsWith('-registry')");
  });

  it('is per SESSION, not the league-wide live-draft channel', () => {
    expect(drSrc).toMatch(/isMock\s*\n?\s*\?\s*`league-\$\{state\.leagueId\}-mockchat-\$\{mockSessionId\}`/);
  });

  it('does not land in the party’s draft-session handler', () => {
    expect(isMockRoom('league-19621-mockchat-abc123')).toBe(false);
    // The shape that would have: kept as a live example of the trap.
    expect(isMockRoom('mock-abc123-chat')).toBe(true);
  });

  it('separates two concurrent mocks, and a mock from the live room', () => {
    const chat = (session: string) => `league-19621-mockchat-${session}`;
    expect(chat('a')).not.toBe(chat('b'));
    expect(chat('a')).not.toBe('league-19621-draft-2026-conference00');
  });
});
