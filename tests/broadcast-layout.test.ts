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
  nameContext,
  padPage,
} from '../src/utils/broadcast-layout';
import type { BroadcastLeaguePanel, BroadcastTeamScore } from '../src/types/live-broadcast';
import type { NflGame, PlayerMeta } from '../src/types/live-scoring';

const team = (id: string, name: string) => ({
  franchiseId: id,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: `/icon-${id}.png`,
  iconSmall: `/small-${id}.png`,
  crestStroke: 0,
  primary: '#123456',
  secondary: '#654321',
  gradient: '',
});

const panel = (over: Partial<BroadcastLeaguePanel> = {}): BroadcastLeaguePanel => ({
  leagueId: '13522',
  leagueName: 'TheLeague',
  slug: 'theleague',
  franchiseId: '0001',
  matchups: [{ index: 0, mine: team('0001', 'Mine'), opponent: team('0002', 'Theirs') }],
  status: 'ok',
  ...over,
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

  it('takes the opponent’s yet-to-play before the owner’s own numbers', () => {
    expect(DROP_LADDER[0]).toBe('oppytp');
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
