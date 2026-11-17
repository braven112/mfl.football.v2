/**
 * The biggest games of a rivalry (ask-rivalry-games.mjs): stakes first,
 * closest margin breaking ties, consolation games never; the exact
 * "decided a playoff spot" rule; and the players who decided it only where
 * the player scores add up to the official score.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import { indexDataset } from '../src/utils/league-history/records.mjs';
import { rivalryHistory } from '../src/utils/league-history/rivalry.mjs';
import { runQuery } from '../src/utils/league-history/ask-query.mjs';
import {
  STAKES,
  compareBigGames,
  gameStakes,
  playoffSpotDetail,
  rankRivalryMeetings,
  seedingPoolsFromFeeds,
} from '../src/utils/league-history/ask-rivalry-games.mjs';
import { getLeagueBySlug } from '../src/config/leagues';

/*
 * One finished season, six teams, one pool. A and B won their divisions; C and
 * D are the wild cards (8 wins: the IN line); E missed with 7 (the OUT line),
 * F with 3. Playoffs: week 14 semifinals, week 15 the title game and the
 * third-place game; week 16 a consolation game.
 */
const team = (n: string, own: string, w: number, l: number, r: string, wd = 0, d = 'East') => ({
  n,
  i: null,
  h: own,
  w,
  l,
  t: 0,
  pf: 1000,
  rk: 1,
  d,
  wd,
  r,
});
const A = '0001', B = '0002', C = '0003', D = '0004', E = '0005', F = '0006';
function synthetic() {
  return {
    league: 'test',
    firstSeason: 2020,
    lastSeason: 2020,
    owners: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`own-000${i}`, { name: `Owner ${i}`, slug: `owner-${i}` }])),
    seasons: [
      {
        y: 2020,
        done: 1,
        pw: 14,
        teams: {
          [A]: team('Aces', 'own-0001', 10, 3, 'C', 1),
          [B]: team('Bees', 'own-0002', 9, 4, 'R', 1, 'West'),
          [C]: team('Cats', 'own-0003', 8, 5, '3'),
          [D]: team('Dogs', 'own-0004', 8, 5, 'P', 0, 'West'),
          [E]: team('Eels', 'own-0005', 7, 6, 'M'),
          [F]: team('Foxes', 'own-0006', 3, 10, 'M', 0, 'West'),
        },
      },
    ],
    // [year, week, winner, winnerScore, loser, loserScore, playoffWeek]
    games: [
      // Flipped, E would only draw level with the wild cards: a tiebreaker, not decided.
      [2020, 1, A, 110, E, 100, 0],
      [2020, 2, F, 90, A, 80, 0], // regular: nobody near the line
      [2020, 3, D, 95, F, 90, 0], // flipped, D (7) would be level with E: a tiebreaker
      [2020, 4, E, 99, F, 98, 0], // regular, margin 1
      [2020, 5, A, 54, E, 51, 0], // a tiebreaker again, margin 3
      [2020, 6, E, 120, A, 100, 0], // regular: E won, A won its division
      // Flipped, E (8) passes the wild card it beat (7): the field changes. Decided.
      [2020, 7, C, 100, E, 95, 0], // margin 5
      [2020, 8, D, 100, E, 99, 0], // margin 1
      [2020, 9, C, 100, E, 98, 0], // margin 2
      [2020, 14, A, 130, D, 128, 1], // semifinal
      [2020, 14, B, 110, C, 100, 1], // semifinal
      [2020, 15, A, 140, B, 100, 1], // title game
      [2020, 15, C, 101, D, 100, 1], // third-place game
      [2020, 16, A, 150, E, 149, 1], // consolation: E missed the playoffs
    ],
  };
}

const ixOf = (ds: any) => indexDataset(ds, { groupBy: 'owner' });
const gameAt = (ix: any, wk: number, wf: string) => ix.games.find((g: any) => g.wk === wk && g.wf === wf);

describe('stakes tiers', () => {
  const ix = ixOf(synthetic());
  it('labels every tier from the standings and the bracket', () => {
    expect(gameStakes(ix, gameAt(ix, 15, A), null).label).toBe('Championship');
    expect(gameStakes(ix, gameAt(ix, 14, A), null).label).toBe('Semifinal');
    expect(gameStakes(ix, gameAt(ix, 15, C), null).label).toBe('Third-place game');
    expect(gameStakes(ix, gameAt(ix, 7, C), null).label).toBe('Playoff spot');
    expect(gameStakes(ix, gameAt(ix, 8, D), null).label).toBe('Playoff spot');
    // A flip that only forces a tiebreaker stays a regular-season game, and says so.
    const tied = gameStakes(ix, gameAt(ix, 1, A), null);
    expect(tied.label).toBe('Regular season');
    expect(tied.playoffSpot?.tiebreaker).toBe(true);
    expect(gameStakes(ix, gameAt(ix, 3, D), null).label).toBe('Regular season');
    expect(gameStakes(ix, gameAt(ix, 2, F), null).label).toBe('Regular season');
    expect(gameStakes(ix, gameAt(ix, 6, E), null).label).toBe('Regular season');
  });

  it('orders the tiers championship > later playoff rounds > third place > playoff spot > regular', () => {
    expect(STAKES.championship).toBeGreaterThan(STAKES.championship - STAKES.playoffRoundStep);
    expect(STAKES.playoffFloor).toBeGreaterThan(STAKES.thirdPlace);
    expect(STAKES.thirdPlace).toBeGreaterThan(STAKES.placement);
    expect(STAKES.placement).toBeGreaterThan(STAKES.playoffSpot);
    expect(STAKES.playoffSpot).toBeGreaterThan(STAKES.regular);
    const r = runQuery(synthetic(), { unit: 'rivalryGames', sort: [{ field: 'importance', dir: 'desc' }], columns: ['week', 'stakes'], limit: 25 });
    const stakes = r.rows.map((row) => row.cells[1]);
    // Each game appears once from each side.
    expect(stakes.slice(0, 2)).toEqual(['Championship', 'Championship']);
    expect(stakes.slice(2, 6)).toEqual(['Semifinal', 'Semifinal', 'Semifinal', 'Semifinal']);
    expect(stakes.slice(6, 8)).toEqual(['Third-place game', 'Third-place game']);
    expect(new Set(stakes.slice(8, 14))).toEqual(new Set(['Playoff spot']));
    expect(new Set(stakes.slice(14))).toEqual(new Set(['Regular season']));
  });

  it('breaks a tie inside a tier by the closer margin', () => {
    const ds = synthetic();
    const ix2 = ixOf(ds);
    const rv = rivalryHistory(ix2, C, E) as any;
    const ranked = rankRivalryMeetings(ix2, rv.meetings, { limit: 10 });
    // Both playoff-spot games between C and E: week 9 (by 2) before week 7 (by 5).
    expect(ranked.map((m: any) => [m.wk, m.stakes.label])).toEqual([
      [9, 'Playoff spot'],
      [7, 'Playoff spot'],
    ]);
    const ae = rankRivalryMeetings(ix2, (rivalryHistory(ix2, A, E) as any).meetings, { limit: 10 });
    expect(ae.map((m: any) => m.wk)).toEqual([5, 1, 6]);
    expect(compareBigGames({ stakesLevel: 40, absMargin: 3, year: 2020, week: 5 }, { stakesLevel: 40, absMargin: 10, year: 2020, week: 1 })).toBeLessThan(0);
  });

  it('leaves consolation games out entirely', () => {
    const ds = synthetic();
    const ix2 = ixOf(ds);
    expect(gameStakes(ix2, gameAt(ix2, 16, A), null)).toBeNull();
    const rv = rivalryHistory(ix2, A, E) as any;
    expect(rv.meetings.some((m: any) => m.kind === 'consolation')).toBe(true);
    expect(rankRivalryMeetings(ix2, rv.meetings, { limit: 10 }).some((m: any) => m.wk === 16)).toBe(false);
    const r = runQuery(ds, { unit: 'rivalryGames', where: [{ field: 'week', op: 'eq', value: 16 }] });
    expect(r.total).toBe(0);
    expect(r.description).toContain('consolation games excluded');
  });
});

describe('decided a playoff spot', () => {
  it('counts a game only when the other result changes the playoff field', () => {
    const ix = ixOf(synthetic());
    expect(playoffSpotDetail(ix, gameAt(ix, 7, C), null)).toEqual({
      decided: true,
      tiebreaker: false,
      text: 'with a win, Eels would have made the playoffs instead of Cats; with a loss, Cats would have missed the playoffs',
    });
  });

  it('calls a flip that only leaves teams level a tiebreaker, never decided', () => {
    const ix = ixOf(synthetic());
    expect(playoffSpotDetail(ix, gameAt(ix, 1, A), null)).toEqual({
      decided: false,
      tiebreaker: true,
      text: 'with a win, Eels would have been level for the last spot, a tiebreaker',
    });
    expect(playoffSpotDetail(ix, gameAt(ix, 3, D), null)?.text).toBe('with a loss, Dogs would have been level for the last spot, a tiebreaker');
    // A division winner keeps its bid: its win is never what decided a spot.
    expect(playoffSpotDetail(ix, gameAt(ix, 2, F), null)).toBeNull();
  });

  it('re-runs the race inside each seeding pool', () => {
    const ix = ixOf(synthetic());
    // East: A (division winner), C (wild card, 8), E (7). West: B, D (wild card, 8), F (3).
    const pools = { 2020: { East: 'AL', West: 'NL' } };
    expect(playoffSpotDetail(ix, gameAt(ix, 8, D), null)?.decided).toBe(true);
    // In its own pool D at 7 still clears F; E at 8 only draws level with C.
    expect(playoffSpotDetail(ix, gameAt(ix, 8, D), pools)).toEqual({
      decided: false,
      tiebreaker: true,
      text: 'with a win, Eels would have been level for the last spot, a tiebreaker',
    });
  });

  it('claims no playoff spot when the pools could not be read', () => {
    const ix = ixOf(synthetic());
    expect(playoffSpotDetail(ix, gameAt(ix, 1, A), false)).toBeNull();
  });

  it('reads each season\'s conferences from its own league feed', () => {
    const feed = {
      league: {
        conferences: { conference: [{ id: '00', name: 'American League' }, { id: '01', name: 'National League' }] },
        divisions: { division: [{ name: 'North', conference: '00' }, { name: 'East', conference: '01' }] },
      },
    };
    expect(seedingPoolsFromFeeds({ 2010: feed, 2011: { league: { divisions: { division: [{ name: 'X' }] } } } })).toEqual({
      2010: { North: 'American League', East: 'National League' },
    });
  });
});

describe('the players who decided it', () => {
  const players = {
    players: { q1: ['Star Passer', 'QB'], w1: ['Dud', 'WR'], w2: ['Benchy', 'WR'], q2: ['Ace', 'QB'], w3: ['Wideout', 'WR'] },
    // [year, week, franchise, player, score, flags: 1 started, 2 optimal]
    weeks: [
      [2020, 5, E, 'q1', 50, 3],
      [2020, 5, E, 'w1', 1, 1],
      [2020, 5, E, 'w2', 30, 2],
      [2020, 5, A, 'q2', 40, 3],
      [2020, 5, A, 'w3', 14, 3],
    ],
  };

  it('finds the same-position bench swap that would have flipped it', () => {
    const ds = synthetic();
    const ix = ixOf(ds);
    const rv = rivalryHistory(ix, A, E) as any;
    const [top] = rankRivalryMeetings(ix, rv.meetings, { players, limit: 1 });
    expect(top.wk).toBe(5);
    expect(top.decidedBy.star).toEqual({ name: 'Ace', pos: 'QB', score: 40, beatMargin: true });
    expect(top.decidedBy.benchFlip).toEqual({
      bench: { name: 'Benchy', pos: 'WR', score: 30 },
      starter: { name: 'Dud', pos: 'WR', score: 1 },
      wouldHaveWonBy: 26,
    });
    const r = runQuery(ds, { unit: 'rivalryGames', where: [{ field: 'week', op: 'eq', value: 5 }, { field: 'team', op: 'eq', value: 'Eels' }], columns: ['benchFlip', 'decidedBy'] }, { players });
    expect(r.rows[0].cells[0]).toBe('Benchy (WR) 30.00 over Dud 1.00');
    expect(String(r.rows[0].cells[1])).toContain('would have won it by 26.00');
  });

  it('claims no flip when the starters do not add up to the official score', () => {
    const ix = ixOf(synthetic());
    const partial = { ...players, weeks: players.weeks.filter((w) => w[3] !== 'q1') };
    const rv = rivalryHistory(ix, A, E) as any;
    const [top] = rankRivalryMeetings(ix, rv.meetings, { players: partial, limit: 1 });
    expect(top.decidedBy.benchFlip).toBeNull();
    expect(top.decidedBy.loserOptimal).toBeNull();
  });
});

/** Each season's conferences from the league's committed MFL feeds. */
function poolsFor(slug: string) {
  const dir = path.join(getLeagueBySlug(slug)!.dataPath, 'mfl-feeds');
  const feeds: Record<string, unknown> = {};
  for (const y of fs.readdirSync(dir)) {
    const f = path.join(dir, y, 'league.json');
    if (fs.existsSync(f)) feeds[y] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return seedingPoolsFromFeeds(feeds);
}

const idByName = (ds: any, name: string) => {
  const latest = ds.seasons.at(-1).teams;
  return Object.keys(latest).find((f) => latest[f].n === name)!;
};

describe('real rivalries', () => {
  it('ranks the title game first between Pacific Pigskins and Bring The Pain (theleague)', () => {
    const ix = ixOf(theleague);
    const a = idByName(theleague, 'Pacific Pigskins');
    const b = idByName(theleague, 'Bring The Pain');
    const rv = rivalryHistory(ix, a, b) as any;
    const top = rankRivalryMeetings(ix, rv.meetings, { players: theleaguePlayers, pools: poolsFor('theleague'), limit: 3 });
    expect(top.map((m: any) => [m.y, m.stakes.label])).toEqual([
      [2014, 'Championship'],
      [2019, 'Semifinal'],
      [2021, 'Semifinal'],
    ]);
    // The same answer through Ask the History, by team names.
    const r = runQuery(
      theleague,
      {
        unit: 'rivalryGames',
        where: [{ field: 'team', op: 'contains', value: 'Pigskins' }, { field: 'opponent', op: 'contains', value: 'Bring The Pain' }],
        sort: [{ field: 'importance', dir: 'desc' }],
        columns: ['year', 'stakes'],
        limit: 3,
        chart: 'margin',
      },
      { players: theleaguePlayers, pools: {} },
    );
    expect(r.rows.map((row) => row.cells)).toEqual([[2014, 'Championship'], [2019, 'Semifinal'], [2021, 'Semifinal']]);
    expect(r.chart?.rows.length).toBeGreaterThan(1);
  });

  it('ranks the conference final first between Smokane FC and Vitside Mafia (afl-fantasy)', () => {
    const ix = ixOf(afl);
    const a = idByName(afl, 'Smokane FC');
    const b = idByName(afl, 'Vitside Mafia');
    const rv = rivalryHistory(ix, a, b) as any;
    const top = rankRivalryMeetings(ix, rv.meetings, { players: aflPlayers, pools: poolsFor('afl-fantasy'), limit: 3 });
    expect(top.map((m: any) => [m.y, m.wk, m.stakes.label])).toEqual([
      [2013, 15, 'Conference final'],
      [2010, 16, 'Third-place game'],
      [2015, 16, 'Third-place game'],
    ]);
  });

  it('seeds the AFL per conference in every season it played', () => {
    const pools = poolsFor('afl-fantasy');
    for (const s of (afl as any).seasons) {
      for (const t of Object.values(s.teams) as any[]) expect(pools[s.y]?.[t.d], `${s.y} ${t.d}`).toBeTruthy();
    }
  });
});
