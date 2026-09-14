/**
 * Density, the drop ladder, and what the strip shows first.
 *
 * The rule under all of it: nothing shrinks below legibility to fit. When the
 * board runs out of room it DROPS things, in a fixed order, and what survives
 * keeps its size.
 */

import { describe, it, expect } from 'vitest';
import {
  DROP_LADDER,
  buildStripPages,
  countCells,
  densityTier,
  dropClasses,
  dropsForTier,
  gameSecondsLeft,
  matchupTimeLeft,
  nameContext,
  padPage,
  progressClockLabel,
  MAX_FEATURED_CELLS,
  MAX_GRID_PANELS,
  splitPanels,
} from '../src/utils/broadcast-layout';
import { NFL_GAME_SECONDS } from '../src/utils/live-win-probability';
import type { BroadcastLeaguePanel, BroadcastTeamScore } from '../src/types/live-broadcast';
import type { NflGame, PlayerMeta } from '../src/types/live-scoring';

const team = (id: string, name: string) => ({
  franchiseId: id,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: `/icon-${id}.png`,
  iconSmall: `/small-${id}.png`,
  primary: '#123456',
  secondary: '#654321',
  // The MARK colour, judged against the header panel — a different question
  // from `primary`, which is the takeover's full-screen field.
  swatch: '#4a90d9',
  gradient: '',
});

const panel = (over: Partial<BroadcastLeaguePanel> = {}): BroadcastLeaguePanel => ({
  leagueId: '13522',
  leagueName: 'TheLeague',
  slug: 'theleague',
  franchiseId: '0001',
  home: true,
  matchups: [{ index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'Theirs') }],
  status: 'ok',
  ...over,
});

/** One outside league — off by default, and never a home league. */
const outside = (id: string, matchups = 1): BroadcastLeaguePanel =>
  panel({
    leagueId: id,
    leagueName: `Outside ${id}`,
    slug: '',
    home: false,
    matchups: Array.from({ length: matchups }, (_, index) => ({
      index,
      mine: team('0001', 'Mine'),
      opponent: team('0002', 'Theirs'),
    })),
  });

describe('density', () => {
  it('scales on matchup CELLS, not leagues', () => {
    // A doubleheader league is one panel and two cells — two matchups' worth
    // of numbers is what has to fit.
    expect(densityTier(1)).toBe(1);
    expect(densityTier(2)).toBe(2);
    expect(densityTier(4)).toBe(3);
    expect(densityTier(6)).toBe(4);
    expect(densityTier(8)).toBe(5);
  });

  it('counts a doubleheader panel as two cells', () => {
    const dh = panel({
      matchups: [
        { index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'A') },
        { index: 1, mine: team('0001', 'Mine'), opponent: team('0003', 'B') },
      ],
    });
    expect(countCells([dh])).toBe(2);
    expect(countCells([panel(), dh])).toBe(3);
  });

  it('counts a panel with no matchup as one cell so it keeps its space', () => {
    // The panel keeps full height on a bye — removing it mid-afternoon
    // re-lays out every other panel, which is the motion a fixed header
    // exists to prevent.
    expect(countCells([panel({ matchups: [], status: 'no-matchup' })])).toBe(1);
  });
});

describe('which leagues get a full-size panel', () => {
  const theleague = panel({ leagueId: '13522', leagueName: 'TheLeague', home: true });
  const afl = panel({ leagueId: '19621', leagueName: 'AFL Fantasy', slug: 'afl-fantasy', home: true });

  it('leaves a small board exactly as it was', () => {
    const split = splitPanels([theleague, afl]);
    expect(split.featured).toEqual([theleague, afl]);
    expect(split.compact).toEqual([]);
  });

  it('never demotes a home league, however many outside ones are added', () => {
    // TheLeague and the AFL are the leagues this site manages and the reason
    // the board exists. An owner in four other people's leagues must not have
    // his own week pushed into a 4vh row.
    const split = splitPanels([outside('a'), outside('b'), outside('c'), theleague, afl]);
    expect(split.featured).toContain(theleague);
    expect(split.featured).toContain(afl);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['c']);
  });

  it('puts the home leagues FIRST, whatever order the board hands them over', () => {
    const split = splitPanels([outside('a'), theleague, outside('b'), afl]);
    expect(split.featured.slice(0, 2)).toEqual([theleague, afl]);
  });

  it('fills the remaining slots up to four CELLS, not four leagues', () => {
    // The same distinction `densityTier` makes: a doubleheader league is one
    // panel and two games' worth of numbers, and it is the numbers that fit.
    const dh = panel({ leagueId: 'dh', home: false, slug: '', matchups: [
      { index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'A') },
      { index: 1, mine: team('0001', 'Mine'), opponent: team('0003', 'B') },
    ] });
    const split = splitPanels([dh, outside('a'), outside('b'), outside('c')]);
    expect(countCells(split.featured)).toBeLessThanOrEqual(MAX_FEATURED_CELLS);
    expect(split.featured.map((p) => p.leagueId)).toEqual(['dh', 'a', 'b']);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['c']);
  });

  it('never splits one league’s doubleheader across the two shelves', () => {
    const dh = panel({ leagueId: 'dh', home: false, slug: '', matchups: [
      { index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'A') },
      { index: 1, mine: team('0001', 'Mine'), opponent: team('0003', 'B') },
    ] });
    const split = splitPanels([outside('a'), outside('b'), outside('c'), dh]);
    // Three singles fill three of four slots; the doubleheader needs two and
    // goes whole into the compact row rather than leaving one game upstairs.
    expect(split.featured.map((p) => p.leagueId)).toEqual(['a', 'b', 'c']);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['dh']);
  });

  it('fills in behind a panel that did not fit, rather than stranding a slot', () => {
    const dh = panel({ leagueId: 'dh', home: false, slug: '', matchups: [
      { index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'A') },
      { index: 1, mine: team('0001', 'Mine'), opponent: team('0003', 'B') },
    ] });
    // a, b, c take three slots; dh needs two and cannot fit — but `d` can, and
    // the owner asked for four games.
    const split = splitPanels([outside('a'), outside('b'), outside('c'), dh, outside('d')]);
    expect(split.featured.map((p) => p.leagueId)).toEqual(['a', 'b', 'c', 'd']);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['dh']);
  });

  it('counts a league with no matchup as one cell, so a bye still holds its space', () => {
    const bye = panel({ leagueId: 'bye', home: false, slug: '', matchups: [], status: 'no-matchup' });
    const split = splitPanels([bye, outside('a'), outside('b'), outside('c'), outside('d')]);
    expect(split.featured.map((p) => p.leagueId)).toEqual(['bye', 'a', 'b', 'c']);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['d']);
  });

  it('never returns an empty featured shelf', () => {
    // A board whose entire header is a compact row has nothing on it worth
    // reading from ten feet — so the first panel is featured even when it
    // alone blows the budget.
    const huge = panel({ leagueId: 'huge', home: false, slug: '', matchups: Array.from({ length: 6 }, (_, index) => ({
      index,
      mine: team('0001', 'Mine'),
      opponent: team('0002', 'Theirs'),
    })) });
    const split = splitPanels([huge, outside('a')]);
    expect(split.featured.map((p) => p.leagueId)).toEqual(['huge']);
    expect(split.compact.map((p) => p.leagueId)).toEqual(['a']);
  });

  it('demotes nothing when expanded, and keeps the same home-first order', () => {
    const all = [outside('a'), theleague, outside('b'), afl];
    const split = splitPanels(all, Number.POSITIVE_INFINITY);
    expect(split.compact).toEqual([]);
    expect(split.featured.map((p) => p.leagueId)).toEqual(['13522', '19621', 'a', 'b']);
  });

  it('never features more panels than the grid can place, even expanded', () => {
    // The stylesheet declares columns and rows for one through eight and stops
    // there — the rows are explicit so a panel cannot grow past the header's
    // fixed height, which means a ninth panel lands in an implicit row inside
    // an `overflow: hidden` box and is simply not drawn. A league the layout
    // cannot draw belongs on the compact row, where it is at least legible.
    const many = Array.from({ length: 12 }, (_, i) => outside(`x${i}`));
    const split = splitPanels(many, Number.POSITIVE_INFINITY);
    expect(split.featured).toHaveLength(MAX_GRID_PANELS);
    expect(split.compact).toHaveLength(12 - MAX_GRID_PANELS);
    expect([...split.featured, ...split.compact]).toHaveLength(12);
  });

  it('holds the grid ceiling collapsed too, where the cell cap binds first', () => {
    const many = Array.from({ length: 12 }, (_, i) => outside(`x${i}`));
    const split = splitPanels(many);
    expect(split.featured.length).toBeLessThanOrEqual(MAX_GRID_PANELS);
    expect(countCells(split.featured)).toBeLessThanOrEqual(MAX_FEATURED_CELLS);
  });

  it('loses no league between the two shelves', () => {
    const all = [outside('a'), theleague, outside('b'), afl, outside('c'), outside('d')];
    const split = splitPanels(all);
    expect([...split.featured, ...split.compact]).toHaveLength(all.length);
    for (const p of all) {
      expect([...split.featured, ...split.compact]).toContain(p);
    }
  });
});

describe('the drop ladder', () => {
  it('drops nothing at the roomy tiers', () => {
    expect(dropsForTier(1)).toEqual([]);
    expect(dropsForTier(2)).toEqual([]);
  });

  it('drops in a fixed order, never out of order', () => {
    for (const tier of [3, 4, 5] as const) {
      const drops = dropsForTier(tier);
      expect(drops).toEqual(DROP_LADDER.slice(0, drops.length));
    }
  });

  it('keeps BOTH yet-to-play counts at the ordinary Sunday density', () => {
    // Four cells — two leagues with a doubleheader each — is tier 3, and it is
    // what the board actually runs. `oppytp` was rung one, so that board
    // printed a single bare "1 to play" that read as the matchup's rather than
    // as one team's (owner, 2026-09-13).
    expect(dropsForTier(3)).not.toContain('oppytp');
    expect(dropClasses(3)).not.toMatch(/oppytp/);
  });

  it('still takes the opponent’s yet-to-play before the owner’s own', () => {
    // The rung survives for tier 4+, where the cell genuinely cannot carry two.
    expect(DROP_LADDER).toContain('oppytp');
    expect(dropsForTier(4)).toContain('oppytp');
  });

  it('keeps the projected final longer than the clock', () => {
    expect(DROP_LADDER.indexOf('clock')).toBeLessThan(DROP_LADDER.indexOf('proj'));
  });

  it('never drops a score or the lead indicator at ANY tier', () => {
    // If those cannot fit, the league does not belong on this television.
    const everyDrop = dropsForTier(5);
    expect(everyDrop).not.toContain('score');
    expect(everyDrop).not.toContain('lead');
    expect(dropClasses(5)).not.toMatch(/score|lead/);
  });

  it('emits one class per dropped rung', () => {
    expect(dropClasses(3).split(' ').filter(Boolean)).toHaveLength(2);
    expect(dropClasses(1)).toBe('');
  });
});

describe('name form', () => {
  it('steps down with the tier and never invents a truncation', () => {
    expect(nameContext(1)).toBe('default');
    expect(nameContext(3)).toBe('short');
    expect(nameContext(5)).toBe('abbrev');
  });
});

describe('the strip', () => {
  const meta: Record<string, PlayerMeta> = {
    live1: { id: 'live1', name: 'Live One', position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 10 },
    live2: { id: 'live2', name: 'Live Two', position: 'WR', nflTeam: 'KC', headshot: '', espnId: null, projected: 10 },
    pre: { id: 'pre', name: 'Pre Game', position: 'TE', nflTeam: 'SF', headshot: '', espnId: null, projected: 10 },
    done: { id: 'done', name: 'All Done', position: 'QB', nflTeam: 'ATL', headshot: '', espnId: null, projected: 10 },
    opp: { id: 'opp', name: 'Their Guy', position: 'WR', nflTeam: 'KC', headshot: '', espnId: null, projected: 10 },
  };

  const games: NflGame[] = [
    { id: 'g1', state: 'in', shortDetail: '4:08 - 3rd', period: 3, clock: '4:08', home: { code: 'KC', score: 14 }, away: { code: 'LV', score: 7 }, possession: 'KC', date: '' },
    { id: 'g2', state: 'pre', shortDetail: 'Sun 4:25 PM ET', period: 0, clock: '', home: { code: 'SF', score: 0 }, away: { code: 'SEA', score: 0 }, possession: null, date: '' },
    { id: 'g3', state: 'post', shortDetail: 'Final', period: 4, clock: '0:00', home: { code: 'ATL', score: 24 }, away: { code: 'NO', score: 20 }, possession: null, date: '' },
  ];

  const score = (ids: string[], pts: Record<string, number> = {}): BroadcastTeamScore => ({
    live: 0,
    projectedFinal: 0,
    remainingPoints: 0,
    yetToPlay: 0,
    players: ids.map((id) => ({
      id,
      live: pts[id] ?? 0,
      secondsRemaining: id === 'done' ? 0 : id === 'pre' ? 3600 : 1800,
      status: 'starter',
    })),
  });

  const scores = {
    '13522': {
      '0001': score(['done', 'pre', 'live1', 'live2'], { done: 22, live1: 9, live2: 4 }),
      '0002': score(['opp'], { opp: 12 }),
    },
  };

  it('leads with the games being played right now', () => {
    const pages = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    expect(pages[0].rows.map((r) => r.name)).toEqual(['Live One', 'Live Two', 'Pre Game', 'All Done']);
  });

  it('prints the REAL clock where ESPN has the game and a state word where it does not', () => {
    const pages = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    const byName = Object.fromEntries(pages[0].rows.map((r) => [r.name, r.clock]));
    expect(byName['Live One']).toBe('4:08 - 3rd');
    expect(byName['All Done']).toBe('Final');

    // No ESPN game for this player's team: a state word, never a number
    // derived from MFL's clock, which does not tick.
    const noGames = buildStripPages({ panels: [panel()], scores, meta, games: [], rowsPerPage: 4 });
    const clocks = noGames[0].rows.map((r) => r.clock);
    expect(clocks).not.toContain('Q3 4:08');
    expect(clocks.every((c) => ['Final', 'Yet to play', 'In progress'].includes(c))).toBe(true);
  });

  it('carries the franchise crest, so a cross-league board says WHICH team he is on', () => {
    const pages = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    expect(pages[0].rows.every((r) => r.crest === '/small-0001.png')).toBe(true);
  });

  it('gives the opponent his own page, marked as his', () => {
    const pages = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    const theirs = pages.find((p) => p.kind === 'opponent');
    expect(theirs).toBeDefined();
    expect(theirs!.rows.every((r) => r.side === 'opponent')).toBe(true);
    expect(theirs!.label).toContain('Theirs');
  });

  it('keys rows per league, so the same player on two teams is two rows', () => {
    const afl = panel({
      leagueId: '19621',
      leagueName: 'AFL',
      slug: 'afl-fantasy',
      matchups: [{ index: 0, mine: team('0001', 'AFL Mine'), opponent: team('0009', 'AFL Theirs') }],
    });
    const pages = buildStripPages({
      panels: [panel(), afl],
      scores: { ...scores, '19621': { '0001': score(['live1'], { live1: 9 }) } },
      meta,
      games,
      rowsPerPage: 8,
    });
    const keys = pages[0].rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.endsWith(':live1'))).toHaveLength(2);
  });

  it('is stable across identical polls', () => {
    const once = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    const twice = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 4 });
    expect(once.map((p) => p.rows.map((r) => r.key))).toEqual(twice.map((p) => p.rows.map((r) => r.key)));
  });

  it('pads a short page so the strip never changes height', () => {
    const pages = buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 6 });
    expect(padPage(pages[0], 6)).toHaveLength(6);
    expect(padPage(pages[0], 6).filter((r) => r === null).length).toBeGreaterThan(0);
  });

  it('returns nothing rather than dividing by zero when no rows fit', () => {
    expect(buildStripPages({ panels: [panel()], scores, meta, games, rowsPerPage: 0 })).toEqual([]);
  });
});

/**
 * The matchup clock.
 *
 * It replaced "the ESPN clock of the game most of my starters are in", which
 * late on a Sunday is whichever game kicked off LAST: a board with one starter
 * left in the night game printed "1:33 - 1st" beside a slate that was
 * otherwise over (owner, 2026-09-13). The string was true of that game and
 * true of nothing the cell was showing.
 */
describe('the matchup clock', () => {
  const meta: Record<string, PlayerMeta> = {
    kc: { id: 'kc', name: 'KC Guy', position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 10 },
    sf: { id: 'sf', name: 'SF Guy', position: 'WR', nflTeam: 'SF', headshot: '', espnId: null, projected: 10 },
    atl: { id: 'atl', name: 'ATL Guy', position: 'QB', nflTeam: 'ATL', headshot: '', espnId: null, projected: 10 },
    bye: { id: 'bye', name: 'No Game', position: 'TE', nflTeam: 'ZZZ', headshot: '', espnId: null, projected: 10 },
  };

  const games: NflGame[] = [
    // Kickoff of the LAST game of the day — the shape that used to take over
    // the whole cell.
    { id: 'g1', state: 'in', shortDetail: '1:33 - 1st', period: 1, clock: '1:33', home: { code: 'KC', score: 3 }, away: { code: 'LV', score: 0 }, possession: 'KC', date: '' },
    { id: 'g2', state: 'pre', shortDetail: 'Sun 4:25 PM ET', period: 0, clock: '', home: { code: 'SF', score: 0 }, away: { code: 'SEA', score: 0 }, possession: null, date: '' },
    { id: 'g3', state: 'post', shortDetail: 'Final', period: 4, clock: '0:00', home: { code: 'ATL', score: 24 }, away: { code: 'NO', score: 20 }, possession: null, date: '' },
  ];

  const row = (id: string, secondsRemaining = 3600) => ({ id, live: 0, secondsRemaining, status: 'starter' as const });

  it('reads ESPN’s own period and clock, never MFL’s seconds', () => {
    // 1:33 left in the 1st = three whole quarters plus 93s still to play.
    expect(gameSecondsLeft(games[0])).toBe(2793);
    expect(gameSecondsLeft(games[1])).toBe(3600);
    expect(gameSecondsLeft(games[2])).toBe(0);
    // Overtime is not a fifth quarter — it is only what OT has left.
    expect(gameSecondsLeft({ ...games[0], period: 5, clock: '2:00' })).toBe(120);
  });

  it('prints NO clock when ESPN placed none of the starters', () => {
    // `assembleBroadcastBoard` substitutes `games: []` on any scoreboard
    // error. Every row would then fall to MFL's non-ticking seconds, which is
    // the one thing this must never print a clock from.
    expect(matchupTimeLeft([row('kc'), row('sf')], [], meta)).toBe('');
    expect(matchupTimeLeft([row('bye')], games, meta)).toBe('');
  });

  it('leaves a starter with no game out of the denominator, not just the numerator', () => {
    // A bye starter has no football left BY DEFINITION. Counting him as a full
    // unplayed game floors the meter above zero, so `Final` never prints and a
    // Monday board reads "4th 6:40 left" over a finished slate.
    expect(matchupTimeLeft([row('atl', 0), row('bye')], games, meta)).toBe('Final');
  });

  it('prints a fraction of one game as a position on one game clock', () => {
    expect(progressClockLabel(1)).toBe('1st 15:00 left');
    expect(progressClockLabel(0.75)).toBe('2nd 15:00 left');
    expect(progressClockLabel(0.5)).toBe('3rd 15:00 left');
    expect(progressClockLabel(0.25)).toBe('4th 15:00 left');
    expect(progressClockLabel(0.125)).toBe('4th 7:30 left');
    expect(progressClockLabel(0)).toBe('Final');
  });

  it('never spells itself the way ESPN spells a real game clock', () => {
    // ESPN prints "4:08 - 3rd". Anything printing that shape is asserting a
    // single real game, which a matchup spanning eighteen of them is not.
    for (const f of [1, 0.6, 0.33, 0.05]) {
      expect(progressClockLabel(f)).not.toMatch(/^\d{1,2}:\d{2} - /);
      expect(progressClockLabel(f)).toMatch(/left$/);
    }
  });

  it('does not let the last game to kick off speak for the whole matchup', () => {
    // Three starters: one final, one in a game that just kicked, one to come.
    const clock = matchupTimeLeft([row('atl', 0), row('kc'), row('sf')], games, meta);
    // (0 + 2793 + 3600) / 10800 = 59.2% of one game left — mid-2nd on the
    // matchup's clock, NOT "1:33 - 1st".
    expect(clock).toBe('2nd 5:31 left');
    expect(clock).not.toContain('1st');
  });

  it('is Final only when every starter’s game is over', () => {
    expect(matchupTimeLeft([row('atl', 0), row('atl', 0)], games, meta)).toBe('Final');
    expect(matchupTimeLeft([row('atl', 0), row('kc')], games, meta)).not.toBe('Final');
  });

  it('never ROUNDS a matchup still being played down to Final', () => {
    // The fraction is the slate's remaining seconds over the starter COUNT, so
    // a nine-starter lineup with four real seconds left is 4/9 of a second on
    // the meter — which rounded to zero and printed `Final` over a live game
    // (Copilot, #1079). Every positive fraction floors at one second.
    const nine = 9 * NFL_GAME_SECONDS;
    expect(progressClockLabel(4 / nine)).toBe('4th 0:01 left');
    expect(progressClockLabel(1 / nine)).toBe('4th 0:01 left');
    // And a whole second of a one-starter matchup is still a second.
    expect(progressClockLabel(1 / NFL_GAME_SECONDS)).toBe('4th 0:01 left');
    // Nothing left is the only thing that may say Final.
    expect(progressClockLabel(0)).toBe('Final');
    expect(progressClockLabel(-1)).toBe('Final');
  });

  it('floors the whole way through matchupTimeLeft, not just the label', () => {
    // Nine starters, one game with a single second left on ESPN's clock.
    const oneSecond = { ...games[0], period: 4, clock: '0:01' };
    const rows = [row('kc'), ...Array.from({ length: 8 }, () => row('atl', 0))];
    expect(matchupTimeLeft(rows, [oneSecond, games[2]], meta)).toBe('4th 0:01 left');
  });

  it('prints nothing at all rather than a clock for no starters', () => {
    expect(matchupTimeLeft([], games, meta)).toBe('');
  });
});
