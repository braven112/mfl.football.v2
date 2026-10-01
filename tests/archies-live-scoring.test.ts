/**
 * Archie's live scoring — the league board, the homepage hero and /broadcast.
 *
 * Three things had to be true for Archie's (MFL 10105, 99 franchises, nine
 * divisions, two games per team per week) to get the SAME board the other
 * leagues get, and each is pinned here:
 *
 *  1. **Pairings.** MFL serves this league's `liveScoring` FLAT — scores and
 *     starters with no matchups. Only MFL Live (`cross-league-live.ts`) used to
 *     fall back to the schedule, so the league board and the homepage hero, both
 *     reading `loadLiveScoringPayload`, would have told all 99 owners they had
 *     no game. The fallback now lives in that one read, off the COMMITTED
 *     schedule, with a public read only when the disk copy lacks the week.
 *  2. **The division picker.** 99 matchups is not a scroll; a league whose
 *     config declares `structure: 'divisions'` carries its divisions on the
 *     panel, and every other league's board is left byte-identical.
 *  3. **The registry and the routes.** The flag is on, the offseason replay is
 *     off (the bundled sample is another league's teams), and both routes are
 *     thin wrappers holding their own gates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearLiveScoringPayloadCache,
  loadLiveScoringPayload,
} from '../src/utils/live-scoring-source';
import {
  clearSchedulePairingsCache,
  readRegisteredSchedulePairings,
} from '../src/utils/mfl-schedule-pairings';
import { buildLiveScoringHeroProps } from '../src/utils/live-scoring-hero-props';
import {
  ALL_GROUPS,
  buildPanelGroups,
  filterMatchupsByGroup,
  groupChipLabel,
  viewerGroupId,
} from '../src/utils/live/board-groups';
import { getLeagueConfigStructure, getLeagueTeamConfigs } from '../src/utils/league-team-brands';
import { getLeagueBySlug, leagueHasFeature, ALL_LEAGUES } from '../src/config/leagues';
import type { LiveMatchup, LiveTeam } from '../src/types/live';

const ARCHIES = getLeagueBySlug('archies')!;
const ROOT = resolve(__dirname, '..');

/** The committed full-season schedule the sync wrote — the source of truth. */
const committedSchedule = JSON.parse(
  readFileSync(resolve(ROOT, 'data/archies/mfl-feeds/2026/schedule.json'), 'utf8'),
);
const committedWeek = (week: number) =>
  [committedSchedule.schedule.weeklySchedule]
    .flat()
    .find((w: { week: string }) => Number(w.week) === week);

/** Archie's flat `liveScoring`, scoring: starters present, no `matchup`. */
const flatScoring = (week: number) => ({
  liveScoring: {
    week: String(week),
    franchise: [
      {
        id: '0001',
        score: '114.95',
        gameSecondsRemaining: '3600',
        players: { player: [{ id: '15237', score: '6.96', status: 'starter', gameSecondsRemaining: '0' }] },
      },
      { id: '0088', score: '98.10', gameSecondsRemaining: '3600', players: {} },
    ],
  },
});

/** The same export for a week nobody has played: every player `nonstarter`. */
const flatUnplayed = (week: number) => ({
  liveScoring: {
    week: String(week),
    franchise: [
      { id: '0001', score: '0.00', players: { player: [{ id: '15237', score: '0.00', status: 'nonstarter' }] } },
    ],
  },
});

const respond = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const typeOf = (call: unknown[]) => new URL(String(call[0])).searchParams.get('TYPE');

describe("Archie's flat liveScoring is paired from the league's own schedule", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearLiveScoringPayloadCache();
    clearSchedulePairingsCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fills every pairing from the COMMITTED schedule, with no extra MFL request', async () => {
    fetchMock.mockResolvedValue(respond(flatScoring(2)));
    const payload = await loadLiveScoringPayload({ leagueId: ARCHIES.id, year: 2026, week: 2 });

    expect(payload.ok).toBe(true);
    expect(payload.matchups).toHaveLength(committedWeek(2).matchup.length);
    // The committed week has 99 games and every franchise appears twice.
    const appearances = payload.matchups.flatMap((m) => [m.home, m.away]);
    expect(new Set(appearances).size).toBe(99);
    expect(appearances.filter((id) => id === '0001')).toHaveLength(2);
    // Disk, not network: only the liveScoring read went to MFL.
    expect(fetchMock.mock.calls.map(typeOf)).toEqual(['liveScoring']);
  });

  it('keeps the scores the flat payload carried', async () => {
    fetchMock.mockResolvedValue(respond(flatScoring(2)));
    const payload = await loadLiveScoringPayload({ leagueId: ARCHIES.id, year: 2026, week: 2 });
    expect(payload.scores['0001']).toBeCloseTo(114.95);
  });

  it('spends nothing on an UNPLAYED week — that is not-played, whatever its pairings', async () => {
    fetchMock.mockResolvedValue(respond(flatUnplayed(9)));
    const payload = await loadLiveScoringPayload({ leagueId: ARCHIES.id, year: 2026, week: 9 });
    expect(payload.matchups).toEqual([]);
    expect(fetchMock.mock.calls.map(typeOf)).toEqual(['liveScoring']);
  });

  it('never pairs a FAILED read — an outage must not grow matchups', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('html'); } });
    const payload = await loadLiveScoringPayload({ leagueId: ARCHIES.id, year: 2026, week: 2 });
    expect(payload.ok).toBe(false);
    expect(payload.matchups).toEqual([]);
  });

  it('leaves a GROUPED league alone — TheLeague already names its pairings', async () => {
    const theleague = getLeagueBySlug('theleague')!;
    fetchMock.mockResolvedValue(
      respond({
        liveScoring: {
          matchup: [
            {
              franchise: [
                { id: '0002', score: '10', isHome: '0', players: { player: [{ id: '1', status: 'starter', score: '10' }] } },
                { id: '0010', score: '12', isHome: '1', players: { player: [{ id: '2', status: 'starter', score: '12' }] } },
              ],
            },
          ],
        },
      }),
    );
    const payload = await loadLiveScoringPayload({ leagueId: theleague.id, year: 2026, week: 2 });
    expect(payload.matchups).toHaveLength(1);
    expect(fetchMock.mock.calls.map(typeOf)).toEqual(['liveScoring']);
  });

  it('reaches the homepage live hero, which reads through the same function', async () => {
    fetchMock.mockResolvedValue(respond(flatScoring(2)));
    const hero = await buildLiveScoringHeroProps({
      league: 'archies',
      week: 2,
      teams: getLeagueTeamConfigs('archies'),
      userFranchiseId: '0001',
    });
    expect(hero).toBeDefined();
    expect(hero!.matchups.length).toBe(committedWeek(2).matchup.length);
    expect(hero!.matchups.some((m) => m.home === '0001' || m.away === '0001')).toBe(true);
  });
});

describe('readRegisteredSchedulePairings — disk first, a public read only for a missing week', () => {
  beforeEach(() => {
    clearSchedulePairingsCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the public schedule when the committed copy lacks the week, with no cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      respond({
        schedule: {
          weeklySchedule: { week: '3', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0002', isHome: '0' }] }] },
        },
      }),
    );
    const pairings = await readRegisteredSchedulePairings(ARCHIES, 2026, 3, {
      readCommitted: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(pairings).toEqual([{ home: '0001', away: '0002' }]);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.hostname).toBe(ARCHIES.mflHost);
    expect(url.searchParams.get('L')).toBe(ARCHIES.id);
    expect(url.searchParams.get('W')).toBe('3');
  });

  it("refuses another week's pairings — the week is checked, never assumed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      respond({
        schedule: { weeklySchedule: { week: '4', matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }] } },
      }),
    );
    const pairings = await readRegisteredSchedulePairings(ARCHIES, 2026, 3, {
      readCommitted: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(pairings).toEqual([]);
  });

  it('never throws — an HTML page under a 200 is no pairings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('html'); } });
    await expect(
      readRegisteredSchedulePairings(ARCHIES, 2026, 3, {
        readCommitted: () => null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
  });
});

describe('the division picker is offered to a declared-divisions league only', () => {
  const groupsFor = (slug: string) => buildPanelGroups(getLeagueConfigStructure(slug), getLeagueTeamConfigs(slug));

  it("Archie's: nine divisions, every franchise in exactly one", () => {
    const groups = groupsFor('archies')!;
    expect(groups).toHaveLength(9);
    const all = groups.flatMap((g) => g.franchiseIds);
    expect(all).toHaveLength(99);
    expect(new Set(all).size).toBe(99);
  });

  it('every other league renders exactly as before — no groups at all', () => {
    for (const league of ALL_LEAGUES) {
      if (league.slug === 'archies') continue;
      expect(groupsFor(league.slug), league.slug).toBeUndefined();
    }
  });

  const side = (franchiseId: string): LiveTeam => ({ franchiseId }) as unknown as LiveTeam;
  const game = (a: string, b: string): LiveMatchup => ({ sides: [side(a), side(b)] }) as unknown as LiveMatchup;
  const groups = [
    { id: '00', name: 'Barry Sanders Division', franchiseIds: ['0001', '0002'] },
    { id: '01', name: 'Payton Manning Division', franchiseIds: ['0003', '0004'] },
  ];
  const games = [game('0001', '0002'), game('0002', '0003'), game('0003', '0004')];

  it("a cross-division game shows under BOTH divisions — hiding it would hide a division's own game", () => {
    expect(filterMatchupsByGroup(games, groups, '00')).toEqual([games[0], games[1]]);
    expect(filterMatchupsByGroup(games, groups, '01')).toEqual([games[1], games[2]]);
  });

  it('All, or a division this league no longer has, shows every game rather than none', () => {
    expect(filterMatchupsByGroup(games, groups, ALL_GROUPS)).toEqual(games);
    expect(filterMatchupsByGroup(games, groups, 'gone')).toEqual(games);
  });

  it("starts a signed-in viewer on their own division, and a stranger on none", () => {
    expect(viewerGroupId(groups, '0004')).toBe('01');
    expect(viewerGroupId(groups, null)).toBeNull();
    expect(viewerGroupId(groups, '9999')).toBeNull();
  });

  it('drops the repeated "Division" from a chip, and never empties one', () => {
    expect(groupChipLabel('Dan Marino Division ')).toBe('Dan Marino');
    expect(groupChipLabel('Division')).toBe('Division');
  });
});

describe("Archie's registry entry and routes", () => {
  it('has live scoring, and no offseason replay of another league\'s teams', () => {
    expect(leagueHasFeature('archies', 'liveScoring')).toBe(true);
    expect(leagueHasFeature('archies', 'liveScoringSample')).toBe(false);
  });

  const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

  it('the live-scoring route is a thin wrapper over the SHARED board, with its gate in the page', () => {
    const src = read('src/pages/archies/live-scoring.astro');
    expect(src).toMatch(/import LiveBoardPage from '..\/..\/components\/shared\/live\/LiveBoardPage.astro'/);
    expect(src).toMatch(/leagueHasFeature\(league\.slug, 'liveScoring'\)/);
    expect(src).toMatch(/Astro\.redirect\('\/archies'\)/);
  });

  it("the broadcast route sends a signed-out visitor to Archie's OWN login", () => {
    const src = read('src/pages/archies/broadcast.astro');
    expect(src).toMatch(/<LiveBroadcastPage user=\{user\} \/>/);
    expect(src).toMatch(/loginUrlForRequest\(Astro, getLeagueBySlug\('archies'\)!\)/);
  });
});
