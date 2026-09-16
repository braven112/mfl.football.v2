import { describe, it, expect } from 'vitest';
import {
  LEADERBOARD_DEPTH,
  defaultDirFor,
  leaderboardsFor,
  orderedPositions,
  pointsFor,
  resolveTopPlayersView,
  rowsFor,
  sortHref,
  viewHref,
} from '../src/utils/top-players-view';
import type { TopPlayersFile, TopPlayerRow } from '../src/types/top-players';

/**
 * The Top Players page keeps all its state in the URL, so this module IS the
 * page's behaviour. The rules worth pinning are the degradations: a param the
 * page cannot honour must fall back to a populated view, never to an empty
 * table — "nobody scored" and "your link was stale" look identical to a
 * reader, and the recap hero links here with a week number every Tuesday.
 */

const row = (over: Partial<TopPlayerRow> & { name: string }): TopPlayerRow => ({
  id: over.name,
  position: 'QB',
  team: 'CHI',
  espnId: null,
  owners: [],
  weeks: {},
  total: 0,
  avg: 0,
  games: 0,
  best: 0,
  rank: 1,
  posRank: 1,
  ...over,
});

const file: TopPlayersFile = {
  seasonYear: 2026,
  startWeek: 1,
  endWeek: 17,
  lastRegularSeasonWeek: 14,
  completedWeeks: [1, 2],
  positions: ['DEF', 'QB', 'RB', 'WR'],
  players: [
    row({ name: 'Alpha QB', position: 'QB', weeks: { '1': 30, '2': 10 }, total: 40, avg: 20, games: 2, best: 30, rank: 1, posRank: 1 }),
    row({ name: 'Bravo RB', position: 'RB', weeks: { '1': 25, '2': 10 }, total: 35, avg: 17.5, games: 2, best: 25, rank: 2, posRank: 1 }),
    row({ name: 'Charlie QB', position: 'QB', weeks: { '2': 30 }, total: 30, avg: 30, games: 1, best: 30, rank: 3, posRank: 2 }),
    row({ name: 'Delta WR', position: 'WR', weeks: { '1': 5 }, total: 5, avg: 5, games: 1, best: 5, rank: 4, posRank: 1 }),
  ],
};

const view = (search: string) => resolveTopPlayersView(new URL(`https://x/top-players${search}`), file);

describe('resolveTopPlayersView', () => {
  it('defaults to the stacked leaderboards, season totals', () => {
    expect(view('')).toEqual({ mode: 'leaders', position: null, week: 0, sort: 'points', dir: 'desc' });
  });

  it('honours a week the feed actually scored', () => {
    expect(view('?week=2').week).toBe(2);
  });

  it('falls back to season totals for any week it cannot honour', () => {
    // An unplayed week, a bye, week 0, junk, and a negative all mean the same
    // thing to a reader: show me the season. None may blank the table.
    for (const q of ['?week=7', '?week=0', '?week=-1', '?week=abc', '?week=', '?week=1.5']) {
      expect(view(q).week, q).toBe(0);
    }
  });

  it('accepts a position view case-insensitively, and ignores one the league lacks', () => {
    expect(view('?view=qb')).toMatchObject({ mode: 'position', position: 'QB' });
    expect(view('?view=QB')).toMatchObject({ mode: 'position', position: 'QB' });
    // TE is a real football position but this league's feed has none.
    expect(view('?view=te')).toMatchObject({ mode: 'leaders', position: null });
    expect(view('?view=nonsense')).toMatchObject({ mode: 'leaders', position: null });
  });

  it('gives each sort key a sensible default direction', () => {
    expect(defaultDirFor('points')).toBe('desc');
    expect(defaultDirFor('name')).toBe('asc');
    expect(defaultDirFor('rank')).toBe('asc');
    expect(view('?sort=name').dir).toBe('asc');
    expect(view('?sort=name&dir=desc').dir).toBe('desc');
    expect(view('?sort=bogus').sort).toBe('points');
  });
});

describe('orderedPositions', () => {
  it('orders by football convention, not alphabetically', () => {
    expect(orderedPositions(file)).toEqual(['QB', 'RB', 'WR', 'DEF']);
  });

  it('keeps a position the constant does not know rather than dropping it', () => {
    const withIdp = { ...file, positions: [...file.positions, 'LB'] };
    expect(orderedPositions(withIdp)).toEqual(['QB', 'RB', 'WR', 'DEF', 'LB']);
  });
});

describe('rowsFor', () => {
  it('ranks by season total by default', () => {
    expect(rowsFor(file, view('')).map((p) => p.name)).toEqual([
      'Alpha QB', 'Bravo RB', 'Charlie QB', 'Delta WR',
    ]);
  });

  it('re-ranks by that week alone in week mode', () => {
    // Week 2: Charlie (30) beats Alpha and Bravo (10 each), though he is 3rd
    // on the season. This is the whole point of the hero link.
    expect(rowsFor(file, view('?week=2')).map((p) => p.name)).toEqual([
      'Charlie QB', 'Alpha QB', 'Bravo RB',
    ]);
  });

  it('omits players who did not score that week rather than showing them as zero', () => {
    const names = rowsFor(file, view('?week=2')).map((p) => p.name);
    expect(names).not.toContain('Delta WR'); // scored in week 1 only
  });

  it('filters to one position', () => {
    expect(rowsFor(file, view('?view=qb')).map((p) => p.name)).toEqual(['Alpha QB', 'Charlie QB']);
  });

  it('breaks ties on name so two renders of one URL agree', () => {
    const tied: TopPlayersFile = {
      ...file,
      players: [row({ name: 'Zulu', total: 10 }), row({ name: 'Alpha', total: 10 })],
    };
    expect(rowsFor(tied, view('')).map((p) => p.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('does not mutate the payload it was handed', () => {
    const before = file.players.map((p) => p.name);
    rowsFor(file, view('?sort=name'));
    expect(file.players.map((p) => p.name)).toEqual(before);
  });
});

describe('leaderboardsFor', () => {
  it('returns a section per position with rows, capped', () => {
    const sections = leaderboardsFor(file, view(''));
    expect(sections.map((s) => s.position)).toEqual(['QB', 'RB', 'WR']); // DEF has no scorers
    expect(sections[0].rows.map((p) => p.name)).toEqual(['Alpha QB', 'Charlie QB']);
    for (const s of sections) expect(s.rows.length).toBeLessThanOrEqual(LEADERBOARD_DEPTH);
  });

  it('drops a position with nobody scoring that week instead of an empty section', () => {
    const sections = leaderboardsFor(file, view('?week=2'));
    expect(sections.map((s) => s.position)).toEqual(['QB', 'RB']);
  });
});

describe('viewHref / sortHref', () => {
  const base = '/theleague/top-players';

  it('omits every param that is already the default', () => {
    expect(viewHref(base, view(''), {})).toBe(base);
  });

  it('keeps the week when the reader switches position', () => {
    // The reader arrived from the Tuesday hero on ?week=2. Changing position
    // must not silently drop them back to season totals.
    expect(viewHref(base, view('?week=2'), { mode: 'position', position: 'RB' })).toBe(
      `${base}?view=rb&week=2`,
    );
  });

  it('flips direction when the active column is clicked again', () => {
    expect(sortHref(base, view('?sort=avg'), 'avg')).toBe(`${base}?sort=avg&dir=asc`);
    expect(sortHref(base, view('?sort=avg&dir=asc'), 'avg')).toBe(`${base}?sort=avg`);
  });

  it('uses a new column default direction rather than inheriting the old one', () => {
    expect(sortHref(base, view('?sort=name'), 'points')).toBe(base);
  });
});
