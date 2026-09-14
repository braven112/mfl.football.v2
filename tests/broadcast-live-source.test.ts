/**
 * The cross-league assembler: which leagues are on the board, which matchups
 * are the viewer's, and what the numbers mean when a feed is having a bad day.
 */

import { describe, it, expect } from 'vitest';
import type { PlayerMeta } from '../src/types/live-scoring';
import type { LiveSnapshot } from '../src/utils/live-scoring-snapshot';
import { emptyLiveSnapshot } from '../src/utils/live-scoring-snapshot';
import {
  buildBoardLeagues,
  findOwnerMatchups,
  scoreLeague,
  toLeagueViewer,
} from '../src/utils/broadcast-live-source';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues';

const theLeague = getLeagueBySlug('theleague')!;
const afl = getLeagueBySlug('afl-fantasy')!;

const myLeague = (over: Record<string, unknown> = {}) => ({
  id: theLeague.id,
  name: 'TheLeague',
  franchiseId: '0001',
  franchiseName: 'Pacific Pigskins',
  host: null,
  ...over,
}) as any;

describe('buildBoardLeagues', () => {
  it('keeps every league MFL names, registered or not', () => {
    const leagues = buildBoardLeagues(
      [myLeague(), myLeague({ id: '99999', name: "Someone Else's Dynasty", host: 'https://www49.myfantasyleague.com' })],
      null,
    );
    expect(leagues.map((l) => l.id)).toContain('99999');
    expect(leagues.find((l) => l.id === '99999')!.registered).toBeNull();
    expect(leagues.find((l) => l.id === theLeague.id)!.registered).not.toBeNull();
  });

  it('prefers the registry’s own name over MFL’s', () => {
    const [l] = buildBoardLeagues([myLeague({ name: 'whatever MFL calls it' })], null);
    expect(l.name).toBe(theLeague.name);
  });

  it('keeps the session’s league even when myleagues omits it', () => {
    // One thin upstream answer must never take the owner's own league off his
    // television.
    const leagues = buildBoardLeagues([], { leagueId: afl.id, franchiseId: '0003' });
    expect(leagues.map((l) => l.id)).toEqual([afl.id]);
    expect(leagues[0].franchiseId).toBe('0003');
    expect(leagues[0].isSession).toBe(true);
  });

  it('orders registry leagues first and stably', () => {
    const leagues = buildBoardLeagues(
      [myLeague({ id: '99999', name: 'Outside', host: 'https://www49.myfantasyleague.com' }), myLeague({ id: afl.id }), myLeague()],
      null,
    );
    const registryIds = ALL_LEAGUES.map((l) => l.id);
    const positions = leagues.map((l) => registryIds.indexOf(l.id));
    // Outside leagues (-1 → sorted last) never lead the header.
    expect(positions[positions.length - 1]).toBe(-1);
  });

  it('does not list the same league twice', () => {
    const leagues = buildBoardLeagues([myLeague(), myLeague()], { leagueId: theLeague.id, franchiseId: '0001' });
    expect(leagues).toHaveLength(1);
  });
});

describe('findOwnerMatchups — doubleheaders come from the FEED', () => {
  it('finds one matchup in a normal week, either side of the pairing', () => {
    expect(findOwnerMatchups([{ home: '0001', away: '0002' }], '0001')).toEqual([
      { opponentId: '0002', isHome: true },
    ]);
    expect(findOwnerMatchups([{ home: '0002', away: '0001' }], '0001')).toEqual([
      { opponentId: '0002', isHome: false },
    ]);
  });

  it('finds BOTH on a doubleheader week', () => {
    // Never derived from the calendar: the late doubleheader week is whichever
    // of Week 12/13 is bye-free that year, and copying last year's number has
    // shipped a doubleheader onto a bye twice.
    const pairs = findOwnerMatchups(
      [{ home: '0001', away: '0002' }, { home: '0003', away: '0001' }, { home: '0004', away: '0005' }],
      '0001',
    );
    expect(pairs).toEqual([
      { opponentId: '0002', isHome: true },
      { opponentId: '0003', isHome: false },
    ]);
  });

  it('returns nothing on a bye rather than inventing an opponent', () => {
    expect(findOwnerMatchups([{ home: '0004', away: '0005' }], '0001')).toEqual([]);
  });
});

describe('scoreLeague', () => {
  const meta: Record<string, PlayerMeta> = {
    a: { id: 'a', name: 'A', position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 20 },
    b: { id: 'b', name: 'B', position: 'WR', nflTeam: 'ATL', headshot: '', espnId: null, projected: 10 },
    bench: { id: 'bench', name: 'Bench', position: 'WR', nflTeam: 'SF', headshot: '', espnId: null, projected: 99 },
  };

  const snapshot = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
    ...emptyLiveSnapshot(),
    matchups: [{ home: '0001', away: '0002' }],
    scores: { '0001': 50, '0002': 40 },
    players: {
      '0001': [{ id: 'a', live: 50, secondsRemaining: 1800, status: 'starter' }],
      '0002': [{ id: 'b', live: 40, secondsRemaining: 0, status: 'starter' }],
    },
    ...over,
  });

  it('scores the viewer and the opponent and states win probability from the VIEWER’s side', () => {
    const scored = scoreLeague(theLeague.id, snapshot(), true, '0001', meta);
    expect(scored.teams['0001'].live).toBe(50);
    expect(scored.teams['0002'].live).toBe(40);
    // A half-played 20-point projection adds 10.
    expect(scored.teams['0001'].projectedFinal).toBeCloseTo(60, 5);
    expect(scored.teams['0002'].projectedFinal).toBe(40);
    expect(scored.winProbability).toHaveLength(1);
    expect(scored.winProbability[0]).toBeGreaterThan(0.5);
  });

  it('never counts a bench row toward a score or a projection', () => {
    // Bench rows travel in their own map precisely so nothing downstream can
    // sum them by accident — one here inflates the projected final and the
    // win-probability bar with points that cannot be scored.
    const withBench = snapshot({
      bench: { '0001': [{ id: 'bench', live: 30, secondsRemaining: 3600, status: 'nonstarter' }] },
    });
    const scored = scoreLeague(theLeague.id, withBench, true, '0001', meta);
    expect(scored.teams['0001'].projectedFinal).toBeCloseTo(60, 5);
    expect(scored.teams['0001'].players.map((p) => p.id)).toEqual(['a']);
  });

  it('separates “the read failed” from “the week is not being played”', () => {
    // An unplayed week is a full, well-formed payload of zeros. Read literally
    // it says both teams finished on 0.0.
    const unplayed = scoreLeague(theLeague.id, {
      ...emptyLiveSnapshot(),
      matchups: [{ home: '0001', away: '0002' }],
      scores: { '0001': 0, '0002': 0 },
      players: { '0001': [], '0002': [] },
    }, true, '0001', meta);
    expect(unplayed.ok).toBe(true);
    expect(unplayed.live).toBe(false);

    const outage = scoreLeague(theLeague.id, emptyLiveSnapshot(), false, '0001', meta);
    expect(outage.ok).toBe(false);
    expect(outage.live).toBe(false);
  });

  it('is never live when the read failed, whatever the payload looked like', () => {
    expect(scoreLeague(theLeague.id, snapshot(), false, '0001', meta).live).toBe(false);
  });

  it('uses the league’s OWN projections, so the forward-looking numbers mean something', () => {
    // Without projections every player's remaining expectation is zero, so
    // `projectedFinal` collapses onto the live score and `winProbability`
    // takes its `remainingPoints <= 0` branch — a hard 100%/0% off the current
    // margin, at noon on a Sunday with the whole slate still to play. The
    // board shipped exactly that for one afternoon of development.
    const projections = new Map([['a', 24], ['b', 12]]);
    const scored = scoreLeague(theLeague.id, snapshot(), true, '0001', meta, projections);

    // 'a' is half-played on a 24-point projection: 12 still to come.
    expect(scored.teams['0001'].remainingPoints).toBeCloseTo(12, 5);
    expect(scored.teams['0001'].projectedFinal).toBeCloseTo(62, 5);
    // Real uncertainty, not a certainty.
    expect(scored.winProbability[0]).toBeGreaterThan(0.5);
    expect(scored.winProbability[0]).toBeLessThan(1);
  });

  it('goes flat rather than wrong when a projections feed is missing', () => {
    // The board's own `playerMeta` always carries `projected: 0` — a
    // projection belongs to a player IN A LEAGUE and that map is shared across
    // every league on the board, so there is no single right value to put
    // there. This mirrors that: with no per-league map, the forward-looking
    // half of the cell stops saying anything while the live scores stay real.
    const flatMeta = Object.fromEntries(
      Object.entries(meta).map(([id, m]) => [id, { ...m, projected: 0 }]),
    );
    const scored = scoreLeague(theLeague.id, snapshot(), true, '0001', flatMeta, new Map());
    expect(scored.teams['0001'].remainingPoints).toBe(0);
    expect(scored.teams['0001'].projectedFinal).toBe(scored.teams['0001'].live);
  });

  it('lets a per-league projection override whatever meta carries', () => {
    // The precedence that makes the above safe: the league's own map wins, so
    // a stale or zeroed `meta.projected` can never outrank a real projection.
    const scored = scoreLeague(theLeague.id, snapshot(), true, '0001', meta, new Map([['a', 60]]));
    expect(scored.teams['0001'].remainingPoints).toBeCloseTo(30, 5);
  });

  it('never lets one league’s projections score another league’s lineup', () => {
    // A projection belongs to a player IN A LEAGUE — the same back is worth
    // different points under two rule sets, so the maps must stay separate.
    const rich = scoreLeague(theLeague.id, snapshot(), true, '0001', meta, new Map([['a', 40]]));
    const lean = scoreLeague(afl.id, snapshot(), true, '0001', meta, new Map([['a', 4]]));
    expect(rich.teams['0001'].projectedFinal).not.toBeCloseTo(lean.teams['0001'].projectedFinal, 5);
  });

  it('scores both games of a doubleheader', () => {
    const dh = snapshot({
      matchups: [{ home: '0001', away: '0002' }, { home: '0001', away: '0003' }],
      scores: { '0001': 50, '0002': 40, '0003': 70 },
      players: {
        '0001': [{ id: 'a', live: 50, secondsRemaining: 0, status: 'starter' }],
        '0002': [{ id: 'b', live: 40, secondsRemaining: 0, status: 'starter' }],
        '0003': [{ id: 'b', live: 70, secondsRemaining: 0, status: 'starter' }],
      },
    });
    const scored = scoreLeague(theLeague.id, dh, true, '0001', meta);
    expect(scored.winProbability).toHaveLength(2);
    // Winning the first, losing the second — two independent answers.
    expect(scored.winProbability[0]).toBe(1);
    expect(scored.winProbability[1]).toBe(0);
  });
});

describe('toLeagueViewer', () => {
  it('hands the moment stream only the franchises the viewer has a stake in', () => {
    // The AFL is 24 franchises. Passing all of them would make every touchdown
    // in the league a candidate for this owner's television.
    const snap: LiveSnapshot = {
      ...emptyLiveSnapshot(),
      matchups: [{ home: '0001', away: '0002' }],
      players: {
        '0001': [{ id: 'a', live: 0, secondsRemaining: 3600, status: 'starter' }],
        '0002': [{ id: 'b', live: 0, secondsRemaining: 3600, status: 'starter' }],
        '0009': [{ id: 'z', live: 0, secondsRemaining: 3600, status: 'starter' }],
      },
    };
    const viewer = toLeagueViewer(
      { id: afl.id, name: 'AFL', franchiseId: '0001', franchiseName: 'Mine' },
      snap,
      { '0002': 'Theirs' },
    );
    expect(Object.keys(viewer.players).sort()).toEqual(['0001', '0002']);
    expect(viewer.opponentIds).toEqual(['0002']);
  });

  it('survives a bye with no opponent', () => {
    const viewer = toLeagueViewer(
      { id: afl.id, name: 'AFL', franchiseId: '0001', franchiseName: 'Mine' },
      emptyLiveSnapshot(),
      {},
    );
    expect(viewer.opponentIds).toEqual([]);
    expect(viewer.players['0001']).toEqual([]);
  });
});
