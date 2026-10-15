/**
 * The handheld board's pure helpers: the matchup sheet's lineups and player
 * numbers (Phase 2), and the landscape pages and "on the field now" row
 * (Phase 3). docs/plans/broadcast-handheld.md.
 */

import { describe, it, expect } from 'vitest';
import { handheldLineup, matchupKey, onFieldNow, paginateByLeague } from '../src/utils/broadcast-handheld';
import type { BroadcastLeaguePanel, BroadcastLeagueScore } from '../src/types/live-broadcast';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../src/types/live-scoring';

const meta: Record<string, PlayerMeta> = {
  qb: { id: 'qb', name: 'Q Back', position: 'QB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
  rb: { id: 'rb', name: 'R Back', position: 'RB', nflTeam: 'BUF', headshot: '', espnId: null, projected: 0 },
  wr: { id: 'wr', name: 'W Rec', position: 'WR', nflTeam: 'SF', headshot: '', espnId: null, projected: 0 },
};

const game = (home: string, away: string, state: NflGame['state'], shortDetail: string) =>
  ({ home: { code: home }, away: { code: away }, state, shortDetail }) as unknown as NflGame;

describe('matchupKey', () => {
  it('keys by league and the matchup index, so a doubleheader is two sheets', () => {
    expect(matchupKey('13522', 0)).not.toBe(matchupKey('13522', 1));
    expect(matchupKey('13522', 0)).not.toBe(matchupKey('19621', 0));
  });
});

describe('handheldLineup', () => {
  const rows: LivePlayerRow[] = [
    { id: 'wr', live: 4, secondsRemaining: 3600, status: 'starter', projected: 12 },
    { id: 'qb', live: 18, secondsRemaining: 1800, status: 'starter', projected: 22 },
    { id: 'rb', live: 9.5, secondsRemaining: 0, status: 'starter' },
  ];
  const games = [game('KC', 'LV', 'in', 'Q3 4:08'), game('SF', 'SEA', 'pre', '1:25 PM')];

  it('lists starters in lineup order, by position', () => {
    expect(handheldLineup(rows, meta, games).map((p) => p.id)).toEqual(['qb', 'rb', 'wr']);
  });

  it('reads the projection from the ROW and works out what is still to come', () => {
    const qb = handheldLineup(rows, meta, games).find((p) => p.id === 'qb')!;
    expect(qb.projected).toBe(22);
    // Half a game left on a 22-point projection.
    expect(qb.projectedLeft).toBeCloseTo(11, 5);
  });

  it('says "no projection" rather than inventing a 0', () => {
    // `meta.projected` is a deliberate shared 0 and must never stand in.
    const rb = handheldLineup(rows, meta, games).find((p) => p.id === 'rb')!;
    expect(rb.projected).toBeNull();
    expect(rb.projectedLeft).toBeNull();
  });

  it('prints the game the way the TV strip does', () => {
    const byId = Object.fromEntries(handheldLineup(rows, meta, games).map((p) => [p.id, p]));
    expect(byId.qb.clock).toBe('Q3 4:08');
    expect(byId.wr.clock).toBe('Yet to play');
    // No ESPN game for BUF: MFL's own state word, never a derived number.
    expect(byId.rb.clock).toBe('Final');
  });

  it('names a player the board has no identity for instead of dropping the row', () => {
    const [p] = handheldLineup([{ id: 'x', live: 1, secondsRemaining: 0, status: 'starter' }], {}, []);
    expect(p.name).toBe('Player x');
  });
});

describe('paginateByLeague', () => {
  const card = (league: string, n: number) => ({ league, id: `${league}${n}` });
  const ids = (pages: { id: string }[][]) => pages.map((p) => p.map((c) => c.id));
  const leagueOf = (c: { league: string }) => c.league;

  it('is one page when everything fits, or in portrait (no capacity)', () => {
    const cards = [card('a', 1), card('b', 1), card('b', 2)];
    expect(ids(paginateByLeague(cards, leagueOf, 6))).toEqual([['a1', 'b1', 'b2']]);
    expect(ids(paginateByLeague(cards, leagueOf, null))).toEqual([['a1', 'b1', 'b2']]);
    expect(paginateByLeague([], leagueOf, 6)).toEqual([]);
  });

  it('keeps a league on one page rather than splitting it across a swipe', () => {
    const cards = [card('a', 1), card('a', 2), card('b', 1), card('b', 2), card('c', 1)];
    expect(ids(paginateByLeague(cards, leagueOf, 3))).toEqual([['a1', 'a2'], ['b1', 'b2', 'c1']]);
  });

  it('splits a league only when it alone overflows a page', () => {
    const cards = [card('a', 1), card('b', 1), card('b', 2), card('b', 3), card('b', 4)];
    expect(ids(paginateByLeague(cards, leagueOf, 3))).toEqual([['a1'], ['b1', 'b2', 'b3'], ['b4']]);
  });
});

describe('onFieldNow', () => {
  const team = (franchiseId: string) => ({ franchiseId }) as BroadcastLeaguePanel['matchups'][number]['mine'];
  const panel = (leagueId: string, leagueName: string, mine: string, opp: string): BroadcastLeaguePanel =>
    ({
      leagueId,
      leagueName,
      status: 'ok',
      matchups: [{ index: 0, mine: team(mine), opponent: team(opp) }],
    }) as unknown as BroadcastLeaguePanel;
  const rowsOf = (...ids: string[]) => ids.map((id) => ({ id, live: 0, secondsRemaining: 1800, status: 'starter' }));
  const leagueScore = (leagueId: string, teams: Record<string, string[]>): BroadcastLeagueScore =>
    ({
      leagueId,
      ok: true,
      live: true,
      winProbability: [0.5],
      teams: Object.fromEntries(Object.entries(teams).map(([fid, ids]) => [fid, { players: rowsOf(...ids) }])),
    }) as unknown as BroadcastLeagueScore;
  const liveGame = (home: string, away: string, possession: string, isRedZone: boolean) =>
    ({
      home: { code: home },
      away: { code: away },
      state: 'in',
      possession,
      situation: { possession, isRedZone, downDistanceText: '', shortDownDistanceText: '', lastPlay: '' },
    }) as unknown as NflGame;
  const field = { ...meta, te: { ...meta.qb, id: 'te', name: 'T End', position: 'TE', nflTeam: 'LV' } };

  it("lists only the owner's starters whose team has the ball", () => {
    const panels = [panel('L1', 'TheLeague', 'me', 'them')];
    // KC has the ball against LV: the KC QB is on the field, the LV TE is not,
    // and the opponent's KC player never appears — this row is the owner's.
    const scores = { L1: leagueScore('L1', { me: ['qb', 'te', 'wr'], them: ['rb'] }) };
    const out = onFieldNow(panels, scores, [liveGame('KC', 'LV', 'KC', false)], field);
    expect(out.map((p) => p.id)).toEqual(['qb']);
    expect(out[0].redZone).toBe(false);
  });

  it('never flags the red zone for the team on defense', () => {
    const panels = [panel('L1', 'TheLeague', 'me', 'them')];
    const scores = { L1: leagueScore('L1', { me: ['qb', 'te'] }) };
    const out = onFieldNow(panels, scores, [liveGame('KC', 'LV', 'LV', true)], field);
    expect(out.map((p) => [p.id, p.redZone])).toEqual([['te', true]]);
  });

  it('ignores games that are not being played', () => {
    const panels = [panel('L1', 'TheLeague', 'me', 'them')];
    const scores = { L1: leagueScore('L1', { me: ['qb'] }) };
    const ended = { ...liveGame('KC', 'LV', 'KC', true), state: 'post' } as NflGame;
    expect(onFieldNow(panels, scores, [ended], field)).toEqual([]);
  });

  it('shows a player started in two leagues once, naming both, red zone first', () => {
    const panels = [panel('L1', 'TheLeague', 'me', 'x'), panel('L2', 'AFL', 'me2', 'y')];
    const scores = {
      L1: leagueScore('L1', { me: ['wr', 'qb'] }),
      L2: leagueScore('L2', { me2: ['qb'] }),
    };
    const games = [liveGame('SF', 'SEA', 'SF', false), liveGame('KC', 'LV', 'KC', true)];
    const out = onFieldNow(panels, scores, games, field);
    expect(out.map((p) => p.id)).toEqual(['qb', 'wr']);
    expect(out[0].leagues).toEqual(['TheLeague', 'AFL']);
  });
});
