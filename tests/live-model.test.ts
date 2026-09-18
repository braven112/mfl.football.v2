/**
 * The canonical live-scoring model's builders and accessors.
 *
 * The rules here are the ones that let ONE payload serve a league board (every
 * matchup, most of them nobody's) and MFL Live (only the viewer's, across
 * several leagues). Each one replaces a place where the two boards this model
 * unifies stated the same quantity from a different reference point.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLiveMatchup,
  buildLiveTeam,
  isViewerMatchup,
  opponentTeam,
  renderOrder,
  resolveMatchupColorVars,
  viewerTeam,
  viewerWinProbability,
  winProbabilityFor,
} from '../src/utils/live/model';
import { SURFACE_GROUNDS } from '../src/utils/live/surface';
import { contrastRatio } from '../src/utils/team-color-contrast';
import type { FranchiseIdentity } from '../src/utils/mfl-live-identity';
import type { LivePlayerRow, PlayerMeta } from '../src/types/live-scoring';

const identity = (franchiseId: string, name: string, color = '#1c497c'): FranchiseIdentity => ({
  franchiseId,
  name,
  nameShort: name,
  initials: name.slice(0, 2).toUpperCase(),
  icon: '',
  rung: 'league',
  nflCode: null,
  colors: { color, colorPrimary: color },
});

const totals = (live: number, remaining = 0) => ({
  live,
  projectedFinal: live + remaining,
  remainingPoints: remaining,
  yetToPlay: remaining > 0 ? 1 : 0,
});

const row = (id: string, live = 0, secondsRemaining = 0): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

const meta = (entries: Record<string, string>): Record<string, PlayerMeta> =>
  Object.fromEntries(
    Object.entries(entries).map(([id, position]) => [
      id,
      { id, name: id, position, nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
    ]),
  );

const team = (fid: string, live: number, remaining = 0, rows: LivePlayerRow[] = [], bench: LivePlayerRow[] = []) =>
  buildLiveTeam({
    identity: identity(fid, `Team ${fid}`),
    totals: totals(live, remaining),
    players: rows,
    bench,
    meta: meta(Object.fromEntries([...rows, ...bench].map((r) => [r.id, 'RB']))),
  });

const matchup = (viewerFranchiseId: string | null, a = 100, b = 90) =>
  buildLiveMatchup({
    index: 0,
    side0: team('0001', a),
    side1: team('0002', b),
    side0Colors: { color: '#1c497c' },
    side1Colors: { color: '#c41e3a' },
    surface: 'theleague',
    viewerFranchiseId,
  });

describe('win probability is stated for an INDEX, never for a side’s name', () => {
  it('side 1’s probability is side 0’s complement', () => {
    const m = matchup(null);
    expect(winProbabilityFor(m, 0) + winProbabilityFor(m, 1)).toBeCloseTo(1, 10);
  });

  it('swapping the two sides gives the complementary p0 — the number follows the pairing, not the team', () => {
    const forward = matchup(null, 100, 90);
    const reversed = buildLiveMatchup({
      index: 0,
      side0: team('0002', 90),
      side1: team('0001', 100),
      side0Colors: { color: '#c41e3a' },
      side1Colors: { color: '#1c497c' },
      surface: 'theleague',
      viewerFranchiseId: null,
    });
    expect(forward.p0 + reversed.p0).toBeCloseTo(1, 10);
  });

  it('a lead with no game-time left is a certainty, either way round', () => {
    expect(matchup(null, 120, 90).p0).toBeCloseTo(1, 6);
    expect(matchup(null, 90, 120).p0).toBeCloseTo(0, 6);
  });
});

describe('the viewer is a nullable INDEX, resolved per matchup', () => {
  it('finds the viewer on either side', () => {
    expect(matchup('0001').viewerSide).toBe(0);
    expect(matchup('0002').viewerSide).toBe(1);
  });

  it('is null when the pairing is nobody’s — a league board renders many of these', () => {
    const m = matchup('0009');
    expect(m.viewerSide).toBeNull();
    expect(isViewerMatchup(m)).toBe(false);
    // The accessors REFUSE rather than guessing. "Prefer your team, else the
    // league" is the exact shape that put a rival's player on somebody's own
    // homepage.
    expect(viewerTeam(m)).toBeNull();
    expect(opponentTeam(m)).toBeNull();
    expect(viewerWinProbability(m)).toBeNull();
  });

  it('is null for no viewer at all — the board is public', () => {
    expect(matchup(null).viewerSide).toBeNull();
  });

  it('reports the viewer’s OWN probability whichever side they are on', () => {
    const asSide0 = matchup('0001', 100, 90);
    const asSide1 = buildLiveMatchup({
      index: 0,
      side0: team('0002', 90),
      side1: team('0001', 100),
      side0Colors: { color: '#c41e3a' },
      side1Colors: { color: '#1c497c' },
      surface: 'theleague',
      viewerFranchiseId: '0001',
    });
    // Same owner, same lead, same answer — the thing a home-relative number
    // gets wrong depending on where MFL put him in the pairing.
    expect(viewerWinProbability(asSide0)).toBeCloseTo(viewerWinProbability(asSide1)!, 10);
  });

  it('names the viewer’s opponent, not side 1', () => {
    expect(opponentTeam(matchup('0002'))!.franchiseId).toBe('0001');
  });
});

describe('render order is presentation, and stays out of the data', () => {
  it('keeps MFL’s pairing order when the board does not put the viewer first', () => {
    expect(renderOrder(matchup('0002'), false)).toEqual([0, 1]);
  });

  it('puts the viewer first only when they are on side 1', () => {
    expect(renderOrder(matchup('0002'), true)).toEqual([1, 0]);
    expect(renderOrder(matchup('0001'), true)).toEqual([0, 1]);
  });

  it('never reorders a pairing that is nobody’s', () => {
    expect(renderOrder(matchup(null), true)).toEqual([0, 1]);
  });
});

describe('a team’s two lists are ordered together and never merged', () => {
  const rows = [row('wr1'), row('qb1'), row('def1')];
  const positions = meta({ qb1: 'QB', wr1: 'WR', def1: 'DEF', rb9: 'RB', te9: 'TE' });

  it('orders starters by position, QB first', () => {
    const t = buildLiveTeam({
      identity: identity('0001', 'A'),
      totals: totals(0),
      players: rows,
      meta: positions,
    });
    expect(t.players.map((r) => r.id)).toEqual(['qb1', 'wr1', 'def1']);
  });

  it('orders the bench by the SAME rule, so no caller can order one and forget the other', () => {
    const t = buildLiveTeam({
      identity: identity('0001', 'A'),
      totals: totals(0),
      players: [],
      bench: [row('te9'), row('rb9')],
      meta: positions,
    });
    expect(t.bench.map((r) => r.id)).toEqual(['rb9', 'te9']);
  });

  it('keeps the bench OUT of players — two lists, not a flag', () => {
    const t = buildLiveTeam({
      identity: identity('0001', 'A'),
      totals: totals(0),
      players: [row('qb1')],
      bench: [row('rb9')],
      meta: positions,
    });
    expect(t.players.map((r) => r.id)).toEqual(['qb1']);
    expect(t.bench.map((r) => r.id)).toEqual(['rb9']);
  });

  it('a franchise with no bench gets an empty list, not undefined', () => {
    const t = buildLiveTeam({
      identity: identity('0001', 'A'),
      totals: totals(0),
      players: [],
      meta: positions,
    });
    expect(t.bench).toEqual([]);
  });

  it('is STABLE over a shuffled feed — the last tiebreak is the player id', () => {
    // MFL returns arrays in nondeterministic order, and an all-zero lineup is
    // every Sunday morning before kickoff. Without the id tiebreak the board
    // reshuffles itself between polls having changed nothing.
    const allZero = [row('rb_c'), row('rb_a'), row('rb_b')];
    const m = meta({ rb_a: 'RB', rb_b: 'RB', rb_c: 'RB' });
    const order = (rs: LivePlayerRow[]) =>
      buildLiveTeam({
        identity: identity('0001', 'A'),
        totals: totals(0),
        players: rs,
        meta: m,
      }).players.map((r) => r.id);

    const expected = ['rb_a', 'rb_b', 'rb_c'];
    expect(order(allZero)).toEqual(expected);
    expect(order([...allZero].reverse())).toEqual(expected);
    expect(order([allZero[1], allZero[2], allZero[0]])).toEqual(expected);
  });

  it('does not mutate the rows it was handed', () => {
    const input = [row('wr1'), row('qb1')];
    const snapshot = input.map((r) => r.id);
    buildLiveTeam({ identity: identity('0001', 'A'), totals: totals(0), players: input, meta: positions });
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('colours are resolved per theme, against THIS surface’s card', () => {
  it('emits a light and a dark value for both sides', () => {
    const vars = resolveMatchupColorVars({ color: '#1c497c' }, { color: '#c41e3a' }, 'theleague');
    expect(Object.keys(vars).sort()).toEqual([
      '--t0-dark',
      '--t0-light',
      '--t1-dark',
      '--t1-light',
    ]);
  });

  it('keyed by SIDE INDEX, so it means the same on a board with no viewer', () => {
    const vars = resolveMatchupColorVars({ color: '#1c497c' }, { color: '#c41e3a' }, 'theleague');
    expect(Object.keys(vars).join()).not.toMatch(/tm|to|home|away|mine/);
  });

  it('lifts a near-black franchise off a dark card — the light answer would be invisible', () => {
    // Seven TheLeague franchises really are #181818. `toBroadcastPair` cannot
    // help: it only ever DARKENS, so it cannot make a colour visible.
    const vars = resolveMatchupColorVars({ color: '#181818' }, { color: '#c41e3a' }, 'theleague');
    const darkGround = SURFACE_GROUNDS.theleague.dark;

    expect(contrastRatio('#181818', darkGround)).toBeLessThan(1.5); // the raw claim is invisible
    expect(contrastRatio(vars['--t0-dark'], darkGround)).toBeGreaterThan(
      contrastRatio('#181818', darkGround),
    );
  });

  it('answers DIFFERENTLY per surface, because the dark card differs per league', () => {
    // A mid navy. TheLeague's dark card is grey (#262626), so it is already
    // legible there and passes through UNTOUCHED. The AFL's dark card is navy
    // (#16283c), so the same colour is too close to its own ground and has to
    // be lifted. One claim, two correct answers — which is exactly why the
    // ground is a parameter and not a constant. A single shared ground gives a
    // confident, wrong answer for whichever league it is not.
    const claim = { color: '#123456' };
    const onTheLeague = resolveMatchupColorVars(claim, { color: '#c41e3a' }, 'theleague');
    const onAfl = resolveMatchupColorVars(claim, { color: '#c41e3a' }, 'afl');

    expect(onTheLeague['--t0-dark'].toLowerCase()).toBe('#123456');
    expect(onAfl['--t0-dark'].toLowerCase()).not.toBe('#123456');
    expect(contrastRatio(onAfl['--t0-dark'], SURFACE_GROUNDS.afl.dark)).toBeGreaterThan(
      contrastRatio('#123456', SURFACE_GROUNDS.afl.dark),
    );
  });

  it('separates two franchises whose brand colours are neighbours', () => {
    const vars = resolveMatchupColorVars({ color: '#1c497c' }, { color: '#1c4a7d' }, 'theleague');
    expect(vars['--t0-light']).not.toBe(vars['--t1-light']);
    expect(vars['--t0-dark']).not.toBe(vars['--t1-dark']);
  });
});
