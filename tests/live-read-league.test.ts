/**
 * `readLeagueLive` — one league's whole board, read anonymously.
 *
 * This is the half of the live-scoring read that `readCrossLeagueLive` cannot
 * do, and the differences are the point:
 *
 *  - **Every matchup, not the viewer's.** A league board shows all sixteen (or
 *    all twenty-four). `findOwnerMatchups` returns only the pairings one
 *    franchise is in, which is right for MFL Live and wrong here.
 *  - **No cookie.** A league's own board is public. The viewer, if there is
 *    one, only decides which card is highlighted.
 *
 * Everything below the league loop is shared with the cross-league read, so
 * the rules asserted here are the ones that bit the surfaces this replaces:
 * the four honest statuses, the starter/bench split, doubleheaders coming from
 * the FEED, and a viewer who must be league-scoped by the caller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadLiveScoringPayload = vi.fn();
vi.mock('../src/utils/live-scoring-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/live-scoring-source')>();
  return { ...actual, loadLiveScoringPayload: (...a: unknown[]) => loadLiveScoringPayload(...a) };
});

const loadLeagueWeekProjections = vi.fn();
vi.mock('../src/utils/live/projections', () => ({
  loadLeagueWeekProjections: (...a: unknown[]) => loadLeagueWeekProjections(...a),
  __clearProjectionCache: () => {},
}));

const playerMapEntries = new Map<string, { name: string; position: string; nflTeam: string; headshot: string; espnId: string | null }>();
vi.mock('../src/utils/player-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/player-map')>();
  return { ...actual, getPlayerMap: () => playerMapEntries };
});

import { buildBoardFromSnapshot, readLeagueLive } from '../src/utils/live/read';
import { getLeagueBySlug } from '../src/config/leagues';

const WEEK = 3;
const YEAR = 2026;

const row = (id: string, live = 0, secondsRemaining = 0) => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

/** A healthy `liveScoring` payload. */
const payload = (over: Partial<Record<string, unknown>> = {}) => ({
  ok: true,
  matchups: [{ home: '0001', away: '0002' }],
  scores: { '0001': 100, '0002': 90 },
  remaining: { '0001': 0, '0002': 0 },
  players: { '0001': [row('p1', 100)], '0002': [row('p2', 90)] },
  bench: {},
  playersYetToPlay: {},
  ...over,
});

beforeEach(() => {
  loadLiveScoringPayload.mockReset();
  loadLeagueWeekProjections.mockReset();
  loadLeagueWeekProjections.mockResolvedValue(new Map());
  playerMapEntries.clear();
  for (const id of ['p1', 'p2', 'p3', 'p4', 'b1']) {
    playerMapEntries.set(id, {
      name: `Name ${id}`,
      position: 'RB',
      nflTeam: 'KC',
      headshot: `${id}.png`,
      // A COLLEGE athlete id would be indistinguishable from an NFL one here.
      espnId: '999999',
    });
  }
});

const panelOf = async (input: Parameters<typeof readLeagueLive>[0]) =>
  (await readLeagueLive(input)).panels[0];

describe('every matchup in the league, not just the viewer’s', () => {
  it('returns a card per pairing, with nobody marked when there is no viewer', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        matchups: [
          { home: '0001', away: '0002' },
          { home: '0003', away: '0004' },
        ],
        scores: { '0001': 100, '0002': 90, '0003': 80, '0004': 70 },
        players: {
          '0001': [row('p1', 100)],
          '0002': [row('p2', 90)],
          '0003': [row('p3', 80)],
          '0004': [row('p4', 70)],
        },
      }),
    );

    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR });

    expect(panel.status).toBe('ok');
    expect(panel.matchups).toHaveLength(2);
    expect(panel.matchups.every((m) => m.viewerSide === null)).toBe(true);
    expect(panel.matchups[0].sides.map((s) => s.franchiseId)).toEqual(['0001', '0002']);
  });

  it('keeps MFL’s pairing order rather than re-sorting it', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        matchups: [
          { home: '0003', away: '0004' },
          { home: '0001', away: '0002' },
        ],
        scores: { '0001': 1, '0002': 2, '0003': 3, '0004': 4 },
        players: { '0003': [row('p3', 3)] },
      }),
    );

    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(panel.matchups.map((m) => m.sides[0].franchiseId)).toEqual(['0003', '0001']);
    expect(panel.matchups.map((m) => m.index)).toEqual([0, 1]);
  });

  it('renders a DOUBLEHEADER as two cards — the feed says so, never the calendar', async () => {
    // The AFL plays doubleheaders: 24 matchup elements for 24 franchises,
    // every team twice. A franchise legitimately appears in two pairings.
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        matchups: [
          { home: '0001', away: '0002' },
          { home: '0001', away: '0003' },
        ],
        scores: { '0001': 100, '0002': 90, '0003': 80 },
        players: { '0001': [row('p1', 100)] },
      }),
    );

    const panel = await panelOf({ slug: 'afl-fantasy', week: WEEK, year: YEAR, viewerFranchiseId: '0001' });

    expect(panel.matchups).toHaveLength(2);
    expect(panel.matchups.every((m) => m.viewerSide === 0)).toBe(true);
    expect(panel.matchups.map((m) => m.sides[1].franchiseId)).toEqual(['0002', '0003']);
  });

  it('skips a one-sided element — a bye is not a matchup', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        matchups: [{ home: '0001', away: '0002' }, { home: '0003', away: '' }],
        scores: { '0001': 100, '0002': 90, '0003': 0 },
      }),
    );

    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(panel.matchups).toHaveLength(1);
  });
});

describe('the viewer must be league-scoped by the caller', () => {
  it('marks the viewer’s side when they are in this league', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR, viewerFranchiseId: '0002' });
    expect(panel.matchups[0].viewerSide).toBe(1);
    expect(panel.viewerFranchiseId).toBe('0002');
  });

  it('marks nothing for a franchise id that is not in this week’s pairings', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR, viewerFranchiseId: '0009' });
    expect(panel.matchups[0].viewerSide).toBeNull();
  });

  it('marks nothing when the caller passes null — which is what a cross-league session must do', async () => {
    // Franchise ids COLLIDE across leagues: all three registry leagues have an
    // 0001. An AFL-only session handed straight through would light up "YOUR
    // MATCHUP" on an unrelated TheLeague franchise. Two of the three pages
    // already gated this; TheLeague's did not.
    loadLiveScoringPayload.mockResolvedValue(payload());
    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR, viewerFranchiseId: null });
    expect(panel.matchups[0].viewerSide).toBeNull();
    expect(panel.viewerFranchiseId).toBeNull();
  });
});

describe('the four honest statuses', () => {
  it('ok — the feed is scoring and there are pairings', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    expect((await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).status).toBe('ok');
  });

  it('not-played — an UNPLAYED week is a full payload of zeros, not an error', async () => {
    // Every franchise present, every score "0.00", no starters. `res.ok`,
    // `data.ok`, a shape check and a franchise COUNT all pass this. Only
    // `hasLiveSignal` tells it from a real 0-0, and printing it as
    // "0.0 – 0.0" is what this state exists to prevent.
    loadLiveScoringPayload.mockResolvedValue(
      payload({ scores: { '0001': 0, '0002': 0 }, players: {} }),
    );
    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(panel.status).toBe('not-played');
    expect(panel.matchups).toEqual([]);
  });

  it('not-played is checked BEFORE the pairing count', async () => {
    // A week nobody has played HAS pairings and zeros. Calling that
    // "no matchup" would be a second wrong answer on top of the first.
    loadLiveScoringPayload.mockResolvedValue(
      payload({ matchups: [{ home: '0001', away: '0002' }], scores: { '0001': 0, '0002': 0 }, players: {} }),
    );
    expect((await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).status).toBe('not-played');
  });

  it('no-matchup — the feed is scoring but nothing is paired', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({ matchups: [], scores: { '0001': 100 }, players: { '0001': [row('p1', 100)] } }),
    );
    expect((await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).status).toBe('no-matchup');
  });

  it('unavailable — `ok: false` is never conflated with “the feed says nothing”', async () => {
    // MFL answers a throttled request with an HTML page under a 200, which
    // parses to exactly the offseason shape. `loadLiveScoringPayload` owns
    // that distinction; this must respect it rather than re-deriving it.
    loadLiveScoringPayload.mockResolvedValue(payload({ ok: false, players: {}, scores: {} }));
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(board.ok).toBe(false);
    expect(board.panels[0].status).toBe('unavailable');
  });

  it('a THROWN read is unavailable too, never an unhandled rejection', async () => {
    // This runs inside the page render, so the difference between
    // `unavailable` and a rejection is a board that says so versus a 500.
    loadLiveScoringPayload.mockRejectedValue(new Error('MFL is down'));
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(board.ok).toBe(false);
    expect(board.panels[0].status).toBe('unavailable');
  });
});

describe('week 0 is the pre-kickoff window, not week 1', () => {
  it.each([0, -1, NaN])('reads nothing for week %s', async (week) => {
    const board = await readLeagueLive({ slug: 'theleague', week, year: YEAR });
    expect(board.panels[0].status).toBe('not-played');
    expect(loadLiveScoringPayload).not.toHaveBeenCalled();
  });
});

describe('an unknown league is not the default league', () => {
  it('is unavailable rather than quietly serving TheLeague’s board', async () => {
    const board = await readLeagueLive({ slug: 'nope' as never, week: WEEK, year: YEAR });
    expect(board.ok).toBe(false);
    expect(board.panels[0].status).toBe('unavailable');
    expect(board.panels[0].registered).toBe(false);
    expect(loadLiveScoringPayload).not.toHaveBeenCalled();
  });
});

describe('scoring reads THIS league’s projections, and the bench reaches nothing', () => {
  it('projects unplayed game-time forward from the per-league map', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        scores: { '0001': 10, '0002': 0 },
        // Half a game left.
        players: { '0001': [row('p1', 10, 1800)], '0002': [row('p2', 0, 1800)] },
      }),
    );
    loadLeagueWeekProjections.mockResolvedValue(new Map([['p1', 20]]));

    const panel = await panelOf({ slug: 'theleague', week: WEEK, year: YEAR });
    const [side0, side1] = panel.matchups[0].sides;

    expect(loadLeagueWeekProjections).toHaveBeenCalledWith('theleague', WEEK, YEAR);
    expect(side0.projectedFinal).toBeGreaterThan(side0.live);
    expect(side0.remainingPoints).toBeGreaterThan(0);
    // No projection for p2, so nothing to project forward.
    expect(side1.projectedFinal).toBe(side1.live);
  });

  it('keeps bench rows out of the score, the projection and the yet-to-play count', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        scores: { '0001': 10, '0002': 0 },
        players: { '0001': [row('p1', 10)] },
        bench: { '0001': [row('b1', 99, 1800)] },
      }),
    );
    loadLeagueWeekProjections.mockResolvedValue(new Map([['b1', 50]]));

    const side0 = (await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).matchups[0].sides[0];

    expect(side0.bench.map((r) => r.id)).toEqual(['b1']);
    expect(side0.players.map((r) => r.id)).toEqual(['p1']);
    // A bench row folded into `players` would inflate BOTH of these with
    // points that cannot be scored.
    expect(side0.projectedFinal).toBe(10);
    expect(side0.yetToPlay).toBe(0);
  });

  it('counts yet-to-play from the starters’ own clocks', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({
        scores: { '0001': 0, '0002': 0 },
        players: { '0001': [row('p1', 0, 3600), row('p3', 0, 0)] },
      }),
    );
    const side0 = (await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).matchups[0].sides[0];
    expect(side0.yetToPlay).toBe(1);
  });
});

describe('player identity', () => {
  it('resolves starters AND bench in one pass', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({ players: { '0001': [row('p1', 1)] }, bench: { '0001': [row('b1')] } }),
    );
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    // A bench id missing from here prints "Unknown Player" with no headshot
    // and no team code — the whole row, not a degraded one.
    expect(board.playerMeta.p1?.name).toBe('Name p1');
    expect(board.playerMeta.b1?.name).toBe('Name b1');
  });

  it('never ships an ESPN athlete id, and never a shared projection', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    for (const m of Object.values(board.playerMeta)) {
      // A college athlete id and an NFL one are both plain digits, so a bad
      // join downstream resolves a DIFFERENT person rather than failing.
      expect(m.espnId).toBeNull();
      // A projection belongs to a player IN A LEAGUE; scoring uses the
      // per-league map, not this.
      expect(m.projected).toBe(0);
    }
  });

  it('names an id the player map has never seen, rather than blanking the row', async () => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({ players: { '0001': [row('ghost', 5)] } }),
    );
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(board.playerMeta.ghost?.name).toBe('Player ghost');
  });
});

describe('the board’s own frame', () => {
  it('is league-scoped and results-shaped', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    const board = await readLeagueLive({ slug: 'afl-fantasy', week: WEEK, year: YEAR });

    expect(board.scope).toBe('league');
    expect(board.week).toBe(WEEK);
    expect(board.year).toBe(YEAR);
    expect(board.panels).toHaveLength(1);
    expect(board.panels[0].leagueId).toBe(getLeagueBySlug('afl-fantasy')!.id);
    expect(board.panels[0].slug).toBe('afl-fantasy');
    expect(board.panels[0].registered).toBe(true);
  });

  it('reads MFL by league ID, never by a caller-supplied host', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    await readLeagueLive({ slug: 'afl-fantasy', week: WEEK, year: YEAR });
    // `host` is a hint and `L` is the answer: a rejected host used to fall
    // back to the DEFAULT league's host, and MFL answers a league id it does
    // not host with THAT host's own league rather than an error.
    const [args] = loadLiveScoringPayload.mock.calls[0];
    expect(args).toEqual({ leagueId: getLeagueBySlug('afl-fantasy')!.id, year: YEAR, week: WEEK });
    expect(args).not.toHaveProperty('host');
  });

  it('carries no ESPN layer — it composes on top', async () => {
    loadLiveScoringPayload.mockResolvedValue(payload());
    const board = await readLeagueLive({ slug: 'theleague', week: WEEK, year: YEAR });
    expect(board.games).toEqual([]);
    expect(board.moments).toEqual([]);
    expect(board.redZone).toEqual([]);
  });
});

describe('Throwback Week dresses the board, and only in art', () => {
  const dressed = async (over: Record<string, { name?: string; nameShort?: string; icon?: string }>) =>
    panelOf({
      slug: 'theleague',
      week: WEEK,
      year: YEAR,
      identityOverrides: over,
    });

  beforeEach(() => {
    loadLiveScoringPayload.mockResolvedValue(
      payload({ matchups: [{ home: '0001', away: '0002' }] }),
    );
  });

  it('renames and re-crests the franchise the caller dressed', async () => {
    // Throwback mutates the page's configTeams; without this the board keeps
    // showing the club's present-day mark and the whole feature is invisible.
    const panel = await dressed({
      '0001': { name: 'Steel City Maulers', icon: '/assets/era/maulers.png' },
    });
    expect(panel.matchups[0].sides[0].name).toBe('Steel City Maulers');
    expect(panel.matchups[0].sides[0].icon).toBe('/assets/era/maulers.png');
  });

  it('RE-DERIVES the initials from the era name', async () => {
    // The initials are the text rung's fallback mark. A 1997 name showing
    // today's initials is the same half-dressed board this exists to prevent.
    const panel = await dressed({ '0001': { name: 'Steel City Maulers' } });
    expect(panel.matchups[0].sides[0].initials).not.toBe('');
    expect(panel.matchups[0].sides[0].initials).toBe('SC');
  });

  it('leaves a franchise the caller did not dress alone', async () => {
    const plain = (await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).matchups[0];
    const panel = await dressed({ '0001': { name: 'Steel City Maulers' } });
    expect(panel.matchups[0].sides[1].name).toBe(plain.sides[1].name);
    expect(panel.matchups[0].sides[1].icon).toBe(plain.sides[1].icon);
  });

  it('does NOT let an era change the colour pair', async () => {
    // The pair is resolved against this surface's card ground and an era's
    // palette has not been through that check. Throwback swaps art, not colour.
    const plain = (await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).matchups[0];
    const panel = await dressed({
      '0001': { name: 'Steel City Maulers', icon: '/assets/era/maulers.png' },
    });
    expect(panel.matchups[0].colorVars).toEqual(plain.colorVars);
  });

  it('is a no-op when the caller supplies nothing', async () => {
    const plain = (await panelOf({ slug: 'theleague', week: WEEK, year: YEAR })).matchups[0];
    const panel = await dressed({});
    expect(panel.matchups[0].sides[0].name).toBe(plain.sides[0].name);
  });
});

describe('buildBoardFromSnapshot — the half the offseason sample reuses', () => {
  /**
   * MFL turns the liveScoring feed off out of season, and the bundled replay is
   * recorded in exactly the `LiveSnapshot` shape the live read produces. Both
   * callers going through one builder is what stops the sample board and the
   * live one disagreeing about totals, the identity ladder, the bench split or
   * the four statuses.
   */
  const snapshot = (over: Partial<Record<string, unknown>> = {}) => {
    const { ok: _ok, ...rest } = payload(over);
    return rest as Parameters<typeof buildBoardFromSnapshot>[0]['snapshot'];
  };

  const build = (over: Partial<Parameters<typeof buildBoardFromSnapshot>[0]> = {}) =>
    buildBoardFromSnapshot({
      league: {
        id: getLeagueBySlug('theleague')!.id,
        name: getLeagueBySlug('theleague')!.name,
        slug: 'theleague',
      },
      week: WEEK,
      year: YEAR,
      ok: true,
      snapshot: snapshot(),
      projections: new Map(),
      ...over,
    });

  it('builds the same board the live read does, with no network at all', () => {
    const board = build();
    expect(board.panels[0].status).toBe('ok');
    expect(board.panels[0].matchups).toHaveLength(1);
    expect(board.panels[0].matchups[0].sides[0].live).toBe(100);
  });

  it('carries the statuses that are a property of the DATA', () => {
    expect(build({ ok: false }).panels[0].status).toBe('unavailable');
    expect(
      build({ snapshot: snapshot({ matchups: [], players: {}, scores: {} }) }).panels[0].status,
    ).toBe('not-played');
  });

  it('leaves the PRE-KICKOFF clamp to the read, deliberately', () => {
    // Week 0 means "MFL has not opened the season yet", which is a fact about
    // the request rather than about a snapshot already in hand — the sample
    // replay is a real past week and must not be blanked for having week 0
    // asked of it.
    expect(build({ week: 0 }).panels[0].status).toBe('ok');
  });

  it('prefers the CALLER\u2019s player identity when it has one', () => {
    // The sample is a replay of a past week, and the current player map has
    // since lost players who were on those rosters — without this the bundled
    // board prints "Player 12345" for half its rows.
    const board = build({
      playerMeta: {
        p1: {
          id: 'p1',
          name: 'Retired Back',
          position: 'RB',
          nflTeam: 'KC',
          headshot: 'r.png',
          espnId: null,
          projected: 0,
        },
      },
    });
    expect(board.playerMeta.p1.name).toBe('Retired Back');
    // A row the caller's map does not cover still gets an honest placeholder
    // rather than nothing.
    expect(board.playerMeta.p2.name).toBe('Player p2');
  });

  it('does not mutate the caller\u2019s map', () => {
    // The sample's map is a module-level constant; writing into it would leak
    // one render's rows into the next.
    const mine: Record<string, never> = {};
    build({ playerMeta: mine as never });
    expect(Object.keys(mine)).toHaveLength(0);
  });

  it('never ships an ESPN athlete id, on this path either', () => {
    // A college athlete id and an NFL one are both plain digits, so a bad join
    // resolves the wrong person rather than failing.
    const board = build();
    expect(Object.values(board.playerMeta).every((m) => m.espnId === null)).toBe(true);
  });
});
