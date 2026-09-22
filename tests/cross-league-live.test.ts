/**
 * Guard: the cross-league read that `/broadcast` and MFL Live share.
 *
 * Three properties, each of which is a bug this repo has already paid for:
 *
 *  - **Partial results.** One league's feed having a bad afternoon must cost
 *    that league and nothing else. `Promise.all` over the set rejects the
 *    batch on the first failure, which turns one hung read into a blank board.
 *  - **`hasSignal` is not `ok`.** An UNPLAYED week is a well-formed 200 full
 *    of zeros. Read literally it says "both teams finished on 0.0", and that
 *    is exactly what the Sunday Ticket board once printed over a game nobody
 *    had played.
 *  - **Projections stay per league.** The same back is worth different points
 *    under two rule sets, so a pooled player-keyed map rates one league's
 *    lineup with another's numbers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiveSnapshot } from '../src/utils/live-scoring-snapshot';
import { emptyLiveSnapshot } from '../src/utils/live-scoring-snapshot';

const loadLeagueSnapshot = vi.fn();
const loadLeagueProjections = vi.fn();
const readOutsideLiveSnapshot = vi.fn();
const buildBoardLeagues = vi.fn();
const fetchMyLeagues = vi.fn();
const readLeagueFranchiseMarks = vi.fn();

vi.mock('../src/utils/broadcast-live-source', () => ({
  loadLeagueSnapshot: (...a: unknown[]) => loadLeagueSnapshot(...a),
  loadLeagueProjections: (...a: unknown[]) => loadLeagueProjections(...a),
  readOutsideLiveSnapshot: (...a: unknown[]) => readOutsideLiveSnapshot(...a),
  readLeagueFranchiseMarks: (...a: unknown[]) => readLeagueFranchiseMarks(...a),
  buildBoardLeagues: (...a: unknown[]) => buildBoardLeagues(...a),
}));

vi.mock('../src/utils/my-leagues', () => ({
  fetchMyLeagues: (...a: unknown[]) => fetchMyLeagues(...a),
}));

/**
 * The schedule fallback fires for any league that is SCORING but came back
 * unpaired, which `livePayload()` below is — so without this the suite makes a
 * real request to MFL. Its own guard is `tests/live-schedule-pairings.test.ts`.
 */
vi.mock('../src/utils/mfl-schedule-pairings', () => ({
  readLeagueSchedulePairings: async () => [],
}));

const { discoverBoardLeagues, readCrossLeagueLive, CROSS_LEAGUE_FAN_OUT_LIMIT } = await import(
  '../src/utils/cross-league-live'
);

const user = {
  id: 'mfl-cookie',
  name: 'Brandon',
  franchiseId: '0001',
  leagueId: '13522',
  role: 'owner' as const,
};

const league = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, name: `League ${id}`, franchiseId: '0001', franchiseName: 'Mine', registered: null, host: null, isSession: false, ...over }) as any;

/** A snapshot with a real starter — what a live week looks like. */
function livePayload(): LiveSnapshot {
  return {
    ...emptyLiveSnapshot(),
    scores: { '0001': 87.4, '0002': 79.1 },
    players: { '0001': [{ id: 'p1', score: 12.3 } as any] },
  };
}

/**
 * What MFL answers for a week that has not happened: every franchise present,
 * every score 0, and NO starters anywhere.
 */
function unplayedPayload(): LiveSnapshot {
  return { ...emptyLiveSnapshot(), scores: { '0001': 0, '0002': 0 }, players: { '0001': [], '0002': [] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadLeagueProjections.mockResolvedValue(new Map());
  readLeagueFranchiseMarks.mockResolvedValue({});
});

/**
 * The bug this fixes: a league this site does not host had NO name for
 * anybody. `myleagues` carries at most the viewer's own `franchise_name` and
 * often not even that, so the board rendered "Franchise 0015" against
 * "Franchise 0032" — and their NFL crests never resolved either, because
 * `matchNflTeamName` cannot match a name nobody fetched.
 */
describe('readCrossLeagueLive — franchise names', () => {
  beforeEach(() => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'x', ok: true, snapshot: livePayload() });
  });

  it('fetches names for a league this site does not host, when ASKED', async () => {
    readLeagueFranchiseMarks.mockResolvedValue({
      '0015': { name: 'Cowboys', icon: 'https://mfl.example/15.png' },
      '0032': { name: 'Chiefs', icon: '' },
    });
    const [read] = await readCrossLeagueLive({
      user, leagues: [league('999')], week: 2, year: 2026, withFranchiseNames: true,
    });
    expect(read.franchiseNames).toEqual({ '0015': 'Cowboys', '0032': 'Chiefs' });
    // The MARK rides the same read — the identity ladder's uploaded-art rung
    // costs no request of its own. '' for a franchise that uploaded nothing,
    // never a placeholder: the ladder falls through on empty and would render
    // a broken image on anything invented.
    expect(read.franchiseIcons).toEqual({ '0015': 'https://mfl.example/15.png', '0032': '' });
    expect(readLeagueFranchiseMarks).toHaveBeenCalledTimes(1);
  });

  /**
   * OPT-IN, because this read is SHARED. `/broadcast` calls it and never looks
   * at the names, so a default-on flag would charge a live television surface
   * one `TYPE=league` request per outside league for data it discards.
   */
  it('fetches nothing when the caller did not ask', async () => {
    const [read] = await readCrossLeagueLive({ user, leagues: [league('999')], week: 2, year: 2026 });
    expect(readLeagueFranchiseMarks).not.toHaveBeenCalled();
    expect(read.franchiseNames).toEqual({});
  });

  /** A registered league has committed brands with colours and crests. */
  it('does not fetch them for a registered league, even when asked', async () => {
    const registered = league('13522', { registered: { slug: 'theleague' } });
    const [read] = await readCrossLeagueLive({
      user, leagues: [registered], week: 2, year: 2026, withFranchiseNames: true,
    });
    expect(readLeagueFranchiseMarks).not.toHaveBeenCalled();
    expect(read.franchiseNames).toEqual({});
  });

  it('degrades to no names rather than failing the league', async () => {
    readLeagueFranchiseMarks.mockRejectedValue(new Error('MFL timed out'));
    const [read] = await readCrossLeagueLive({
      user, leagues: [league('999')], week: 2, year: 2026, withFranchiseNames: true,
    });
    expect(read.franchiseNames).toEqual({});
    // The league itself still reads — names are decoration, scores are not.
    expect(read.ok).toBe(true);
  });

  it('keeps them per league, never pooled', async () => {
    readLeagueFranchiseMarks.mockImplementation(async (l: any) =>
      l.id === 'a'
        ? { '0001': { name: 'Bears', icon: '' } }
        : { '0001': { name: 'Packers', icon: '' } });
    const reads = await readCrossLeagueLive({
      user, leagues: [league('a'), league('b')], week: 2, year: 2026, withFranchiseNames: true,
    });
    expect(reads[0].franchiseNames['0001']).toBe('Bears');
    expect(reads[1].franchiseNames['0001']).toBe('Packers');
  });
});

describe('readCrossLeagueLive — partial results', () => {
  it('one league failing costs only that league', async () => {
    loadLeagueSnapshot.mockImplementation(async ({ league: l }: any) =>
      l.id === 'bad'
        ? Promise.reject(new Error('MFL timed out'))
        : { leagueId: l.id, ok: true, snapshot: livePayload() },
    );

    const reads = await readCrossLeagueLive({
      user,
      leagues: [league('a'), league('bad'), league('c')],
      week: 2,
      year: 2026,
    });

    expect(reads.map((r) => r.league.id)).toEqual(['a', 'bad', 'c']);
    expect(reads.map((r) => r.ok)).toEqual([true, false, true]);
    expect(reads[1].snapshot).toBeNull();
    // The survivors still carry their scores — the whole point.
    expect(reads[0].snapshot?.scores['0001']).toBe(87.4);
    expect(reads[2].snapshot?.scores['0001']).toBe(87.4);
  });

  it('a projections failure does not take the snapshot with it', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'a', ok: true, snapshot: livePayload() });
    loadLeagueProjections.mockRejectedValue(new Error('throttled'));

    const [read] = await readCrossLeagueLive({ user, leagues: [league('a')], week: 2, year: 2026 });
    expect(read.ok).toBe(true);
    expect(read.snapshot).not.toBeNull();
    expect(read.projections.size).toBe(0);
  });

  it('returns reads in the order the leagues were given', async () => {
    // Deliberately resolve out of order — a caller pairs by position.
    loadLeagueSnapshot.mockImplementation(async ({ league: l }: any) => {
      await new Promise((r) => setTimeout(r, l.id === 'a' ? 20 : 0));
      return { leagueId: l.id, ok: true, snapshot: livePayload() };
    });
    const reads = await readCrossLeagueLive({
      user,
      leagues: [league('a'), league('b'), league('c')],
      week: 2,
      year: 2026,
    });
    expect(reads.map((r) => r.league.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('readCrossLeagueLive — hasSignal is not ok', () => {
  it('an unplayed week reads fine and carries NO signal', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'a', ok: true, snapshot: unplayedPayload() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('a')], week: 2, year: 2026 });
    // Both halves matter: the board must be able to say "no games yet"
    // WITHOUT saying "we could not reach MFL".
    expect(read.ok).toBe(true);
    expect(read.hasSignal).toBe(false);
  });

  it('a live week carries signal', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'a', ok: true, snapshot: livePayload() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('a')], week: 2, year: 2026 });
    expect(read.hasSignal).toBe(true);
  });

  it('a FAILED read never claims signal', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'a', ok: false, snapshot: livePayload() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('a')], week: 2, year: 2026 });
    expect(read.ok).toBe(false);
    expect(read.hasSignal).toBe(false);
  });
});

describe('readCrossLeagueLive — projections stay per league', () => {
  it('each league keeps its own map', async () => {
    loadLeagueSnapshot.mockImplementation(async ({ league: l }: any) => ({
      leagueId: l.id,
      ok: true,
      snapshot: livePayload(),
    }));
    loadLeagueProjections.mockImplementation(async (l: any) =>
      new Map([['p1', l.id === 'a' ? 20 : 9]]),
    );

    const reads = await readCrossLeagueLive({
      user,
      leagues: [league('a'), league('b')],
      week: 2,
      year: 2026,
    });
    // Same player, two leagues, two numbers — which is the fact a pooled map
    // cannot represent.
    expect(reads[0].projections.get('p1')).toBe(20);
    expect(reads[1].projections.get('p1')).toBe(9);
  });
});

describe('readCrossLeagueLive — the fan-out is bounded', () => {
  it('never exceeds the limit, counting LEAGUES not requests', async () => {
    let inFlight = 0;
    let peak = 0;
    loadLeagueSnapshot.mockImplementation(async ({ league: l }: any) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { leagueId: l.id, ok: true, snapshot: livePayload() };
    });

    const many = Array.from({ length: 20 }, (_, i) => league(`l${i}`));
    await readCrossLeagueLive({ user, leagues: many, week: 2, year: 2026, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('has a default bound rather than opening every socket at once', async () => {
    expect(CROSS_LEAGUE_FAN_OUT_LIMIT).toBeGreaterThan(1);
    expect(CROSS_LEAGUE_FAN_OUT_LIMIT).toBeLessThanOrEqual(12);
  });
});

describe('discoverBoardLeagues', () => {
  it('reads myleagues with the session cookie, not the session league', async () => {
    fetchMyLeagues.mockResolvedValue({ ok: true, leagues: [] });
    buildBoardLeagues.mockReturnValue([]);
    await discoverBoardLeagues(user);
    // user.id IS the MFL cookie — that is what makes one sign-in enough to
    // see a league this site has never heard of.
    expect(fetchMyLeagues).toHaveBeenCalledWith('mfl-cookie', expect.any(Number));
  });

  it('passes the session league through as a union, never a filter', async () => {
    fetchMyLeagues.mockResolvedValue({ ok: true, leagues: [{ id: '99999' }] });
    buildBoardLeagues.mockReturnValue([league('99999')]);
    const leagues = await discoverBoardLeagues(user);
    // The session's own league is a HINT so it is not missed; it must not
    // narrow the list to itself.
    expect(buildBoardLeagues).toHaveBeenCalledWith([{ id: '99999' }], {
      leagueId: '13522',
      franchiseId: '0001',
    });
    expect(leagues.map((l) => l.id)).toEqual(['99999']);
  });

  it('a dead myleagues call yields no leagues rather than throwing', async () => {
    fetchMyLeagues.mockRejectedValue(new Error('cookie expired'));
    buildBoardLeagues.mockReturnValue([]);
    await expect(discoverBoardLeagues(user)).resolves.toEqual([]);
  });
});
