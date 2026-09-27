/**
 * `assembleMflLeagueBoard` — the wiring, run rather than scanned.
 *
 * `tests/live-league-board-guard.test.ts` pins by source scan that the
 * assembler forwards `franchiseIcons` to both tabs. A scan stops the exact
 * pre-fix file coming back, but not a rewrite that gets the icons wrong some
 * other way. This test runs the assembler against a mocked read and checks
 * what actually renders: on 2026-09-27 Archie's league (10105) showed a Chicago
 * Bears logo and initials in place of its uploaded crests, because only the
 * NAMES made it through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/cross-league-live', () => ({
  readCrossLeagueLive: vi.fn(),
}));
vi.mock('../src/utils/live/standings', async (importActual) => ({
  ...(await importActual<typeof import('../src/utils/live/standings')>()),
  readLeagueStandings: vi.fn(),
}));

import { assembleMflLeagueBoard } from '../src/utils/live/mfl-league-board';
import { readCrossLeagueLive } from '../src/utils/cross-league-live';
import { readLeagueStandings } from '../src/utils/live/standings';

const league = {
  id: '99999',
  name: 'Some Other League',
  registered: null,
  host: 'www45.myfantasyleague.com',
  franchiseId: '0001',
} as never;
const user = { id: 'cookie' } as never;

const row = (id: string, live: number) => ({ id, live, secondsRemaining: 0, status: 'starter' });

const snapshot = {
  matchups: [{ home: '0001', away: '0004' }],
  scores: { '0001': 100, '0004': 90 },
  remaining: { '0001': 0, '0004': 0 },
  players: { '0001': [row('p1', 100)], '0004': [row('p2', 90)] },
  bench: {},
  playersYetToPlay: {},
};

const names = { '0001': 'Rhinos', '0004': 'Bears' };
const icons = { '0001': 'https://example.com/a.png', '0004': '' };

const standingsRow = (franchiseId: string, rank: number) => ({
  franchiseId,
  rank,
  name: '',
  nameShort: '',
  initials: '',
  icon: '',
  iconAlt: '',
  rung: 'text' as const,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  isViewer: false,
});

beforeEach(() => {
  vi.mocked(readCrossLeagueLive).mockResolvedValue([
    {
      league,
      ok: true,
      snapshot,
      projections: new Map(),
      franchiseNames: names,
      franchiseIcons: icons,
      hasSignal: true,
    },
  ] as never);
  vi.mocked(readLeagueStandings).mockResolvedValue([
    standingsRow('0001', 1),
    standingsRow('0004', 2),
  ]);
});

describe("assembleMflLeagueBoard carries an outside league's uploaded marks", () => {
  it('the Scores tab wears the uploaded crest and lends no NFL logo', async () => {
    const { board } = await assembleMflLeagueBoard({ user, league, week: 4, year: 2026 });
    const sides = board.panels[0].matchups.flatMap((m) => m.sides);
    const rhinos = sides.find((s) => s.franchiseId === '0001')!;
    const bears = sides.find((s) => s.franchiseId === '0004')!;
    expect(rhinos.rung).toBe('mfl');
    expect(rhinos.icon).toContain('example.com');
    // "Bears" matches an NFL club name, but this league uploaded art of its own.
    expect(bears.rung).toBe('text');
  });

  it('the Standings tab agrees with the Scores tab', async () => {
    const { board } = await assembleMflLeagueBoard({ user, league, week: 4, year: 2026 });
    const standings = board.panels[0].standings!;
    expect(standings.find((r) => r.franchiseId === '0001')?.rung).toBe('mfl');
    expect(standings.find((r) => r.franchiseId === '0004')?.rung).toBe('text');
    expect(standings.find((r) => r.franchiseId === '0004')?.name).toBe('Bears');
  });

  it('still lends the NFL logo in a league that uploaded no marks', async () => {
    vi.mocked(readCrossLeagueLive).mockResolvedValue([
      {
        league,
        ok: true,
        snapshot,
        projections: new Map(),
        franchiseNames: names,
        franchiseIcons: {},
        hasSignal: true,
      },
    ] as never);
    const { board } = await assembleMflLeagueBoard({ user, league, week: 4, year: 2026 });
    const bears = board.panels[0].matchups
      .flatMap((m) => m.sides)
      .find((s) => s.franchiseId === '0004')!;
    expect(bears.rung).toBe('nfl');
    expect(board.panels[0].standings!.find((r) => r.franchiseId === '0004')?.rung).toBe('nfl');
  });
});
