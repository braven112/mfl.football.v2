/**
 * Guard: the MFL Live assembler's four honest states.
 *
 * The rule this file exists for: "the feed says nothing" and "we could not
 * reach the feed" are different facts, and an UNPLAYED week is neither. MFL
 * answers a week that has not happened with a well-formed 200 — every
 * franchise present, every score "0.00", every player `nonstarter`. Read
 * literally that says "both teams finished on 0.0", and the Sunday Ticket
 * board printed exactly that over a game nobody had played.
 *
 * So a league resolves to one of four states, never two.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyLiveSnapshot, type LiveSnapshot } from '../src/utils/live-scoring-snapshot';

const discoverBoardLeagues = vi.fn();
const readCrossLeagueLive = vi.fn();

vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
  readCrossLeagueLive: (...a: unknown[]) => readCrossLeagueLive(...a),
  CROSS_LEAGUE_FAN_OUT_LIMIT: 8,
}));

// The board also reads the NFL slate and game detail from ESPN. Unmocked, those
// were live network calls inside a unit test, bounded only by the ESPN timeout:
// fast here, and past vitest's 5s on a slow CI runner, which timed out the first
// three tests below on PR #1195. Both are stubbed to the "unavailable" values
// `assembleMflLiveBoard` already falls back to on failure — no test here is
// about the slate, so they assert against exactly the board they always got.
vi.mock('../src/utils/nfl-scoreboard-source', () => ({
  fetchNflScoreboard: async ({ week }: { week: number }) => ({ ok: false, week, games: [] }),
}));
vi.mock('../src/utils/nfl-game-detail-source', () => ({
  loadNflGameDetail: async () => null,
}));

const { assembleMflLiveBoard } = await import('../src/utils/mfl-live-board');
const { fromMflLiveBoard } = await import('../src/utils/live/from-mfl-live');
const { resolveMatchupColorVars } = await import('../src/utils/live/model');

const user = {
  id: 'mfl-cookie',
  name: 'Brandon',
  franchiseId: '0001',
  leagueId: '13522',
  role: 'owner' as const,
};

const league = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: `League ${id}`,
    franchiseId: '0001',
    franchiseName: 'Mine',
    registered: null,
    host: null,
    isSession: false,
    ...over,
  }) as any;

/** A played week: a pairing, real scores, and starters. */
function played(): LiveSnapshot {
  return {
    ...emptyLiveSnapshot(),
    scores: { '0001': 87.4, '0002': 79.1 },
    remaining: { '0001': 1800, '0002': 1800 },
    matchups: [{ home: '0001', away: '0002' }],
    players: {
      '0001': [{ id: 'p1', live: 12.3, secondsRemaining: 900, status: 'starter' }],
      '0002': [{ id: 'p2', live: 9.9, secondsRemaining: 0, status: 'starter' }],
    },
    playersYetToPlay: { '0001': 2, '0002': 3 },
  };
}

/** What MFL returns for a week nobody has played: pairings, zeros, no starters. */
function unplayed(): LiveSnapshot {
  return {
    ...emptyLiveSnapshot(),
    scores: { '0001': 0, '0002': 0 },
    matchups: [{ home: '0001', away: '0002' }],
    players: { '0001': [], '0002': [] },
  };
}

const read = (over: Record<string, unknown>) => ({
  league: league('a'),
  ok: true,
  snapshot: played(),
  projections: new Map<string, number>(),
  franchiseNames: {} as Record<string, string>,
  hasSignal: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  discoverBoardLeagues.mockResolvedValue([league('a')]);
});

describe('the four states', () => {
  it('ok — a played week with a pairing', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(board.leagues[0].status).toBe('ok');
    expect(board.leagues[0].matchups).toHaveLength(1);
  });

  it('not-played — the feed is FINE and nothing has kicked off', async () => {
    readCrossLeagueLive.mockResolvedValue([read({ snapshot: unplayed(), hasSignal: false })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    // The whole point: this is NOT 'unavailable' (nothing is broken) and NOT
    // 'ok' with a 0.0-0.0 scoreline (nobody has played).
    expect(board.leagues[0].status).toBe('not-played');
    expect(board.leagues[0].matchups).toEqual([]);
  });

  it('not-played BEATS no-matchup — an unplayed week still has pairings', async () => {
    // Checked in this order deliberately: a week nobody has played is full of
    // pairings AND zeros, so testing the pairing count first would answer
    // "no matchup", which is a second wrong answer.
    const snapshot = unplayed();
    expect(snapshot.matchups.length).toBeGreaterThan(0);
    readCrossLeagueLive.mockResolvedValue([read({ snapshot, hasSignal: false })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(board.leagues[0].status).toBe('not-played');
  });

  it('no-matchup — scoring, but this owner has a bye', async () => {
    const snapshot = { ...played(), matchups: [] };
    readCrossLeagueLive.mockResolvedValue([read({ snapshot })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(board.leagues[0].status).toBe('no-matchup');
  });

  it('unavailable — we could not read it', async () => {
    readCrossLeagueLive.mockResolvedValue([read({ ok: false, snapshot: null, hasSignal: false })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(board.leagues[0].status).toBe('unavailable');
  });

  it('a league with nothing to show KEEPS its panel and its place', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b'), league('c')]);
    readCrossLeagueLive.mockResolvedValue([
      read({ league: league('a') }),
      read({ league: league('b'), ok: false, snapshot: null, hasSignal: false }),
      read({ league: league('c') }),
    ]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    // Dropping it would re-order the board mid-afternoon and make an owner
    // wonder where a team went.
    expect(board.leagues.map((l) => l.leagueId)).toEqual(['a', 'b', 'c']);
    expect(board.leagues[1].status).toBe('unavailable');
  });

  it('the BOARD stays ok when a league fails', async () => {
    readCrossLeagueLive.mockResolvedValue([read({ ok: false, snapshot: null, hasSignal: false })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    // One dead feed is not an outage. The island keeps its last good payload
    // on `ok: false`, so claiming it here would wipe a live screen.
    expect(board.ok).toBe(true);
  });
});

describe('the matchup row', () => {
  it('states win probability from the VIEWER’s side', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const m = board.leagues[0].matchups[0];
    expect(m.mine.franchiseId).toBe('0001');
    expect(m.opponent.franchiseId).toBe('0002');
    expect(m.winProbability).toBeGreaterThanOrEqual(0);
    expect(m.winProbability).toBeLessThanOrEqual(1);
  });

  /**
   * SHIPS EVERY KEY THE KIT'S RESOLVER DEFINES — derived, never listed.
   *
   * This board used to resolve its own pair, under its own names. When
   * `resolveMatchupColorVars` grew the four INK variants (a franchise colour
   * used as text must clear WCAG, not ΔE) the second copy did not, and MFL
   * Live shipped coloured win-probability bars beside GREY scores: the sheet's
   * `--t0-ink` fallback is a neutral, so the miss had no error, no warning and
   * a fully green suite. The case that used to stand here passed throughout,
   * because it NAMED the four keys it expected.
   *
   * So the expected set comes FROM the canonical resolver. Add a key there and
   * this fails here until the board carries it, which is the only thing that
   * would have caught the regression.
   */
  it('carries every key the canonical resolver emits', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const vars = board.leagues[0].matchups[0].colorVars;

    const grey = { color: '#8a8a8a', colorPrimary: '#8a8a8a' };
    const expected = Object.keys(resolveMatchupColorVars(grey, grey, 'mfl')).sort();

    expect(Object.keys(vars).sort()).toEqual(expected);
    for (const key of expected) expect(vars[key], key).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ships BOTH themes’ colours, because the board renders in both', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const vars = board.leagues[0].matchups[0].colorVars;
    // Side-INDEXED, and the viewer is side 0 — matching `winProbability`,
    // which is stated from the viewer. Home/away would swap meaning depending
    // on where MFL put the owner in the pairing.
    expect(vars['--t0-light']).not.toBe(vars['--t1-light']);
    // NOT asserted: that light and dark differ. A colour legible on both
    // cards comes back byte-identical, by design — `ensureContrastOn` returns
    // anything that already passes untouched — so demanding a difference
    // would fail on exactly the franchises that need no help.
  });

  /**
   * And the names survive the bridge untouched.
   *
   * There was a rename here for as long as the old island's sheet read the
   * viewer-relative ones. It is gone, so this asserts the pass-through: the
   * set the kit sees is the set the assembler built, key for key.
   */
  it('reaches the kit under the same names', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const kit = fromMflLiveBoard(board);

    expect(kit.panels[0].matchups[0].colorVars).toEqual(
      board.leagues[0].matchups[0].colorVars,
    );
  });

  it('carries starter rows for the expansion and no bench', async () => {
    const snapshot = played();
    snapshot.bench = { '0001': [{ id: 'benched', live: 30, secondsRemaining: 900, status: 'nonstarter' }] };
    readCrossLeagueLive.mockResolvedValue([read({ snapshot })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const ids = board.leagues[0].matchups[0].mine.players.map((p) => p.id);
    expect(ids).toContain('p1');
    // A bench row here inflates the projected final with points that cannot
    // be scored — which is why bench travels in its own map upstream.
    expect(ids).not.toContain('benched');
  });
});

describe('player metadata', () => {
  it('never ships an ESPN athlete id', async () => {
    readCrossLeagueLive.mockResolvedValue([read({})]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    for (const meta of Object.values(board.playerMeta)) {
      // A college athlete id and an NFL one are both plain digits, so a bad
      // join resolves a DIFFERENT person rather than failing.
      expect(meta.espnId).toBeNull();
      // A projection belongs to a player IN A LEAGUE; this map is shared.
      expect(meta.projected).toBe(0);
    }
  });
});

describe('selection', () => {
  it('defaults to every league the owner is in', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b'), league('c')]);
    readCrossLeagueLive.mockResolvedValue([]);
    const { enabled, allLeagues } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(enabled).toEqual(['a', 'b', 'c']);
    expect(allLeagues.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads only the leagues that are switched on', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b')]);
    readCrossLeagueLive.mockResolvedValue([]);
    await assembleMflLiveBoard({ user, week: 2, year: 2026, leaguesCookie: 'a' });
    expect(readCrossLeagueLive).toHaveBeenCalledWith(
      expect.objectContaining({ leagues: [expect.objectContaining({ id: 'a' })] }),
    );
  });

  it('a param can never widen what the session may see', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a')]);
    readCrossLeagueLive.mockResolvedValue([]);
    const { enabled } = await assembleMflLiveBoard({
      user,
      week: 2,
      year: 2026,
      leaguesParam: 'a,someone-elses-league',
    });
    expect(enabled).toEqual(['a']);
  });
});


/**
 * A league this site does not host gets its names from its own TYPE=league
 * export, and those names are what let the NFL crest resolve.
 *
 * The bug: `myleagues` carries at most the viewer's own `franchise_name` and
 * often not even that, so entire leagues rendered as "Franchise 0015" against
 * "Franchise 0032" with F0 initials on grey — and no crest could ever appear,
 * because `matchNflTeamName` cannot match a name nobody fetched. The two
 * symptoms had one cause.
 */
describe('franchise names in a league this site does not host', () => {
  it('names both sides from the fetched map, not the franchise id', async () => {
    readCrossLeagueLive.mockResolvedValue([
      read({ franchiseNames: { '0001': 'Green Bay Packers', '0002': 'Chicago Bears' } }),
    ]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const m = board.leagues[0].matchups[0]!;
    expect(m.mine.name).toBe('Green Bay Packers');
    expect(m.opponent.name).toBe('Chicago Bears');
  });

  it('an NFL team name resolves to that club\u2019s crest, not initials', async () => {
    readCrossLeagueLive.mockResolvedValue([
      read({ franchiseNames: { '0001': 'Green Bay Packers', '0002': 'Chicago Bears' } }),
    ]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const m = board.leagues[0].matchups[0]!;
    // Rung 2 of the identity ladder: a real club mark, served locally so the
    // dark-mode swap applies.
    expect(m.mine.icon).toBe('/assets/nfl-logos/GB.svg');
    expect(m.opponent.icon).toBe('/assets/nfl-logos/CHI.svg');
    expect(m.mine.rung).not.toBe('text');
  });

  it('a name that is NOT an NFL team still gets its name, and falls to initials', async () => {
    readCrossLeagueLive.mockResolvedValue([
      read({ franchiseNames: { '0001': 'Make Football Great Again', '0002': 'Sunday Funday' } }),
    ]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const m = board.leagues[0].matchups[0]!;
    expect(m.mine.name).toBe('Make Football Great Again');
    expect(m.mine.icon).toBe('');
    // The point of the fix: even with no crest, the row says a NAME rather
    // than "Franchise 0001".
    expect(m.mine.name).not.toMatch(/^Franchise /);
  });

  it('falls back to the franchise id label when MFL gave no names at all', async () => {
    readCrossLeagueLive.mockResolvedValue([read({ franchiseNames: {} })]);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    const m = board.leagues[0].matchups[0]!;
    // Not a crash, and not an empty string — the old behaviour, kept as the floor.
    expect(m.opponent.name).toMatch(/0002/);
  });
});
