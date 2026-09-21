/**
 * Guard: a league MFL scores WITHOUT grouping into matchups still gets its
 * pairings.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────
 * MFL serves `liveScoring` two ways. TheLeague and the AFL come back grouped
 * (`liveScoring.matchup[].franchise[]`), which is where `snapshot.matchups`
 * comes from. Archie's Fantasy Football League (id 10105, `www48`, 99
 * franchises, every team playing TWO games a week) comes back FLAT
 * (`liveScoring.franchise[]`) — real starters, real scores, no pairings.
 *
 * `statusFor` reads a scoring feed with no pairing for the viewer as
 * `no-matchup`, so on 2026-09-21 (week 2) the board told an owner sitting on
 * 114.95 with nine starters that he had no game — while MFL's own `schedule`
 * export listed him at home to the KitKats AND away at the Troopers. All 99
 * owners of that league saw the same.
 *
 * The fixtures below are the REAL shapes of both exports for that league-week,
 * trimmed to the franchises under test. The grouped shape is TheLeague's
 * (13522, `www49`, same week) — both were read live while diagnosing this, and
 * the contrast between them is the whole point of the test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLiveScoringPayload, emptyLiveSnapshot, type LiveSnapshot } from '../src/utils/live-scoring-snapshot';
import { parseSchedulePairings } from '../src/utils/mfl-schedule-pairings';
import { findOwnerMatchups } from '../src/utils/broadcast-live-source';

/** League 10105, week 2, `TYPE=liveScoring&DETAILS=1` — the FLAT shape. */
const FLAT_LIVE_SCORING = {
  encoding: 'utf-8',
  liveScoring: {
    week: '2',
    franchise: [
      {
        id: '0001',
        score: '114.95',
        gameSecondsRemaining: '3600',
        playersYetToPlay: '2',
        players: {
          player: [
            { id: '15237', score: '6.96', status: 'starter', gameSecondsRemaining: '0' },
            { id: '17472', score: '7.00', status: 'nonstarter', gameSecondsRemaining: '0' },
          ],
        },
      },
      { id: '0054', score: '98.10', gameSecondsRemaining: '3600', playersYetToPlay: '1', players: {} },
      { id: '0097', score: '76.40', gameSecondsRemaining: '0', playersYetToPlay: '0', players: {} },
    ],
  },
};

/** League 13522, same week, same export — the GROUPED shape, for contrast. */
const GROUPED_LIVE_SCORING = {
  liveScoring: {
    matchup: [
      {
        franchise: [
          { id: '0002', score: '0.00', isHome: '0', players: {} },
          { id: '0010', score: '0.00', isHome: '1', players: {} },
        ],
      },
    ],
  },
};

/** League 10105, `TYPE=schedule&W=2`. One `weeklySchedule` object, 99 matchups. */
const SCHEDULE_WEEK_2 = {
  encoding: 'utf-8',
  schedule: {
    weeklySchedule: {
      week: '2',
      matchup: [
        {
          franchise: [
            { id: '0097', isHome: '0', result: 'T', spread: '-3.1' },
            { id: '0001', isHome: '1', result: 'T', spread: '3.1' },
          ],
        },
        {
          franchise: [
            { id: '0001', isHome: '0', result: 'T', spread: '8.4' },
            { id: '0054', isHome: '1', result: 'T', spread: '-8.4' },
          ],
        },
      ],
    },
  },
};

describe('the two liveScoring shapes', () => {
  /**
   * Both shapes parse. This is not a parser bug — scores, starters and bench
   * are identical either way, which is exactly why the gap went unnoticed:
   * every check the board makes passes, and only the pairings are missing.
   */
  it('reads scores and starters from the FLAT shape, but no pairings', () => {
    const snapshot = parseLiveScoringPayload(FLAT_LIVE_SCORING);
    expect(snapshot.scores['0001']).toBe(114.95);
    expect(snapshot.players['0001']).toHaveLength(1);
    expect(snapshot.bench['0001']).toHaveLength(1);
    expect(snapshot.matchups).toEqual([]);
  });

  it('reads pairings from the GROUPED shape', () => {
    expect(parseLiveScoringPayload(GROUPED_LIVE_SCORING).matchups).toEqual([
      { home: '0002', away: '0010' },
    ]);
  });

  /** The lie the fallback removes: scoring, and reported as a bye. */
  it('leaves the viewer with no matchup in the flat shape, without a fallback', () => {
    const snapshot = parseLiveScoringPayload(FLAT_LIVE_SCORING);
    expect(findOwnerMatchups(snapshot.matchups, '0001')).toEqual([]);
  });
});

describe('parseSchedulePairings', () => {
  it('pairs the week, home side first', () => {
    expect(parseSchedulePairings(SCHEDULE_WEEK_2, 2)).toEqual([
      { home: '0001', away: '0097' },
      { home: '0054', away: '0001' },
    ]);
  });

  /** Both of the viewer's games — this league plays two a week. */
  it('carries a doubleheader through to the viewer', () => {
    const pairings = parseSchedulePairings(SCHEDULE_WEEK_2, 2);
    expect(findOwnerMatchups(pairings, '0001')).toEqual([
      { opponentId: '0097', isHome: true },
      { opponentId: '0054', isHome: false },
    ]);
  });

  /**
   * THE WEEK IS CHECKED, NEVER ASSUMED. `TYPE=schedule` answers with every
   * week when `W` is omitted, and pasting another week's pairings over a live
   * board is the confident wrong answer this fallback exists to remove.
   */
  it('picks the asked-for week out of a whole-season answer', () => {
    const season = {
      schedule: {
        weeklySchedule: [
          { week: '1', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0002', isHome: '0' }] }] },
          { week: '2', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0097', isHome: '0' }] }] },
        ],
      },
    };
    expect(parseSchedulePairings(season, 2)).toEqual([{ home: '0001', away: '0097' }]);
  });

  it('returns nothing when the answer is for a different week', () => {
    expect(parseSchedulePairings(SCHEDULE_WEEK_2, 3)).toEqual([]);
  });

  /** MFL collapses a one-element list to a bare object, everywhere. */
  it('accepts a single matchup as an object', () => {
    const one = {
      schedule: {
        weeklySchedule: { week: '7', matchup: { franchise: [{ id: '3', isHome: '0' }, { id: '12', isHome: '1' }] } },
      },
    };
    // And pads the ids, which MFL writes 4-digit everywhere else.
    expect(parseSchedulePairings(one, 7)).toEqual([{ home: '0012', away: '0003' }]);
  });

  /** A one-sided entry is MFL's way of writing a BYE. It is not a pairing. */
  it('drops a bye rather than inventing an opponent', () => {
    const bye = {
      schedule: { weeklySchedule: { week: '2', matchup: [{ franchise: [{ id: '0001', isHome: '1' }] }] } },
    };
    expect(parseSchedulePairings(bye, 2)).toEqual([]);
  });

  it('falls back to position when MFL states no isHome', () => {
    const noFlag = {
      schedule: { weeklySchedule: { week: '2', matchup: [{ franchise: [{ id: '0004' }, { id: '0001' }] }] } },
    };
    expect(parseSchedulePairings(noFlag, 2)).toEqual([{ home: '0004', away: '0001' }]);
  });

  it('never throws on a body it cannot read', () => {
    for (const junk of [null, undefined, '', 42, {}, { schedule: {} }, { schedule: { weeklySchedule: null } }]) {
      expect(parseSchedulePairings(junk, 2)).toEqual([]);
    }
  });
});

/**
 * The wiring: ONE read, shared by `/broadcast` and MFL Live, so the fallback
 * cannot land on one board and miss the other.
 */
const loadLeagueSnapshot = vi.fn();
const loadLeagueProjections = vi.fn();
const readOutsideLiveSnapshot = vi.fn();
const readLeagueFranchiseNames = vi.fn();
const buildBoardLeagues = vi.fn();
const readLeagueSchedulePairings = vi.fn();

vi.mock('../src/utils/broadcast-live-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/broadcast-live-source')>();
  return {
    ...actual,
    loadLeagueSnapshot: (...a: unknown[]) => loadLeagueSnapshot(...a),
    loadLeagueProjections: (...a: unknown[]) => loadLeagueProjections(...a),
    readOutsideLiveSnapshot: (...a: unknown[]) => readOutsideLiveSnapshot(...a),
    readLeagueFranchiseNames: (...a: unknown[]) => readLeagueFranchiseNames(...a),
    buildBoardLeagues: (...a: unknown[]) => buildBoardLeagues(...a),
  };
});

vi.mock('../src/utils/mfl-schedule-pairings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/mfl-schedule-pairings')>();
  return { ...actual, readLeagueSchedulePairings: (...a: unknown[]) => readLeagueSchedulePairings(...a) };
});

const { readCrossLeagueLive } = await import('../src/utils/cross-league-live');

const user = {
  id: 'mfl-cookie',
  name: 'Brandon',
  franchiseId: '0001',
  leagueId: '13522',
  role: 'owner' as const,
};

const league = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, name: `League ${id}`, franchiseId: '0001', franchiseName: 'Rhinos', registered: null, host: 'https://www48.myfantasyleague.com', isSession: false, ...over }) as any;

/** Flat and scoring — what league 10105 hands the board every Sunday. */
const flatAndScoring = (): LiveSnapshot => parseLiveScoringPayload(FLAT_LIVE_SCORING);

/** Every franchise present, every score 0, no starters: a week nobody played. */
const unplayed = (): LiveSnapshot =>
  ({ ...emptyLiveSnapshot(), scores: { '0001': 0, '0054': 0 }, players: { '0001': [], '0054': [] } });

beforeEach(() => {
  vi.clearAllMocks();
  loadLeagueProjections.mockResolvedValue(new Map());
  readLeagueFranchiseNames.mockResolvedValue({});
  readLeagueSchedulePairings.mockResolvedValue([
    { home: '0001', away: '0097' },
    { home: '0054', away: '0001' },
  ]);
});

describe('readCrossLeagueLive — the schedule fallback', () => {
  it('pairs a league that is scoring but came back unpaired', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: '10105', ok: true, snapshot: flatAndScoring() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('10105')], week: 2, year: 2026 });

    expect(readLeagueSchedulePairings).toHaveBeenCalledWith(
      expect.objectContaining({ id: '10105' }), 2026, 2, 'mfl-cookie',
    );
    expect(findOwnerMatchups(read.snapshot!.matchups, '0001')).toEqual([
      { opponentId: '0097', isHome: true },
      { opponentId: '0054', isHome: false },
    ]);
    // The scores the flat payload DID carry are untouched.
    expect(read.snapshot!.scores['0001']).toBe(114.95);
    expect(read.hasSignal).toBe(true);
  });

  /** The grouped shape already answered. A second read would be waste. */
  it('does not read the schedule when liveScoring already paired the week', async () => {
    const paired = { ...flatAndScoring(), matchups: [{ home: '0001', away: '0054' }] };
    loadLeagueSnapshot.mockResolvedValue({ leagueId: '10105', ok: true, snapshot: paired });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('10105')], week: 2, year: 2026 });

    expect(readLeagueSchedulePairings).not.toHaveBeenCalled();
    expect(read.snapshot!.matchups).toEqual([{ home: '0001', away: '0054' }]);
  });

  /**
   * An unplayed week is `not-played` whatever its pairings say, so there is
   * nothing to fix — and a board that read the schedule for every league all
   * preseason would pay for it on every poll of every device.
   */
  it('does not read the schedule for a week nobody has played', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: '10105', ok: true, snapshot: unplayed() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('10105')], week: 2, year: 2026 });

    expect(readLeagueSchedulePairings).not.toHaveBeenCalled();
    expect(read.hasSignal).toBe(false);
  });

  /** A read we could not make is never "no games" — and never a schedule read. */
  it('does not read the schedule for a league we could not read at all', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: '10105', ok: false, snapshot: null });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('10105')], week: 2, year: 2026 });

    expect(readLeagueSchedulePairings).not.toHaveBeenCalled();
    expect(read.ok).toBe(false);
  });

  /** A fallback that fails costs the pairings and NOTHING else. */
  it('keeps the league and its scores when the schedule read fails', async () => {
    readLeagueSchedulePairings.mockRejectedValue(new Error('MFL timed out'));
    loadLeagueSnapshot.mockResolvedValue({ leagueId: '10105', ok: true, snapshot: flatAndScoring() });
    const [read] = await readCrossLeagueLive({ user, leagues: [league('10105')], week: 2, year: 2026 });

    expect(read.ok).toBe(true);
    expect(read.snapshot!.scores['0001']).toBe(114.95);
    expect(read.snapshot!.matchups).toEqual([]);
  });

  it('keeps one league\u2019s pairings out of another\u2019s', async () => {
    loadLeagueSnapshot.mockResolvedValue({ leagueId: 'x', ok: true, snapshot: flatAndScoring() });
    readLeagueSchedulePairings.mockImplementation(async (l: any) =>
      l.id === 'a' ? [{ home: '0001', away: '0097' }] : [{ home: '0001', away: '0054' }]);

    const reads = await readCrossLeagueLive({ user, leagues: [league('a'), league('b')], week: 2, year: 2026 });
    expect(reads[0].snapshot!.matchups).toEqual([{ home: '0001', away: '0097' }]);
    expect(reads[1].snapshot!.matchups).toEqual([{ home: '0001', away: '0054' }]);
  });
});
