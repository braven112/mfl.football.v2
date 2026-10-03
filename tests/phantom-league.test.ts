/**
 * The phantom league: a league registered in the registry and NOWHERE else.
 *
 * Adding a league is meant to be a registry entry (plus its data files), so
 * every shared helper must answer for a league it has never heard of with that
 * league's own registry values or an honest empty default — never another
 * league's teams, colours, champion, admins or art. A silent fallback to
 * TheLeague is the failure this guards: it does not throw, it renders real-
 * looking data for the wrong league (docs/claude/insights/features/best-ball-league.md).
 *
 * The phantom is pushed into the live registry objects before the helpers are
 * imported, so module-load derivations see it too. When this fails, the fix is
 * a registry field or a default in the helper — not a slug branch for the
 * phantom.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as raw from '../src/config/leagues-data.mjs';
import * as typed from '../src/config/leagues';

const PHANTOM_SLUG = 'phantom-league';
const PHANTOM_NAV = 'phantom';
const PHANTOM_LOGO = { light: '/assets/logos/phantom.svg', dark: '/assets/logos/phantom-dark.svg' };

/** Names that must never appear in anything served for the phantom. */
const OTHER_LEAGUES = /The League|TheLeague|\bAFL\b|Archie|Best Ball|Pacific Pigskins|Gauntlet/;

beforeAll(() => {
  const base = raw.LEAGUES.archies;
  const phantom = {
    ...base,
    id: '99999',
    slug: PHANTOM_SLUG,
    navSlug: PHANTOM_NAV,
    name: 'Phantom League',
    shortName: undefined,
    wordmark: undefined,
    shareCard: undefined,
    logoOg: undefined,
    pushArt: undefined,
    themeColor: undefined,
    logo: PHANTOM_LOGO,
    domains: [],
    stagingDomains: [],
    adminFranchiseIds: [],
    dataPath: 'data/phantom-league',
    configPath: 'data/phantom-league/phantom.config.json',
    schefterFeedPath: 'data/phantom-league/schefter-feed.json',
    schefter: undefined,
    schedulePolicy: undefined,
    archetype: 'standard-redraft',
  };
  (raw.LEAGUES as Record<string, unknown>)[PHANTOM_SLUG] = phantom;
  (raw.ALL_LEAGUES as unknown[]).push(phantom);
  if (!typed.ALL_LEAGUES.some((l) => l.slug === PHANTOM_SLUG)) {
    (typed.ALL_LEAGUES as unknown[]).push(phantom);
  }
});

describe('a league that exists only in the registry', () => {
  it('has no config of anyone else', async () => {
    const { getLeagueConfig, getLeagueTeams, EMPTY_LEAGUE_CONFIG } = await import('../src/utils/league-config');
    expect(getLeagueConfig(PHANTOM_SLUG)).toBe(EMPTY_LEAGUE_CONFIG);
    expect(getLeagueTeams(PHANTOM_NAV)).toEqual([]);
  });

  it('gets no team colours, accents or brands', async () => {
    const { getTeamColorPrimary } = await import('../src/utils/team-colors');
    const { buildTeamAccentCss } = await import('../src/utils/team-accent-css');
    const { getLeagueTeamBrands } = await import('../src/utils/league-team-brands');
    // TheLeague's 0001 has a colour; the phantom's 0001 must not inherit it.
    expect(getTeamColorPrimary('0001', 'theleague')).not.toBe(getTeamColorPrimary('0001', PHANTOM_NAV as never));
    expect(buildTeamAccentCss(PHANTOM_NAV as never)).toBe('');
    expect(getLeagueTeamBrands(PHANTOM_SLUG)).toEqual({});
  });

  it('builds its own homepage hero', async () => {
    const { getLeagueHeroProfile } = await import('../src/utils/league-hero/profiles');
    const { heroLeagueMark } = await import('../src/utils/league-hero/marks');
    const p = getLeagueHeroProfile(PHANTOM_SLUG as never);
    expect(p.league).toBe(PHANTOM_SLUG);
    expect(JSON.stringify(p.copy)).not.toMatch(OTHER_LEAGUES);
    const view = p.defaultView(new Date('2026-10-04T18:00:00Z'));
    expect(`${view.pill} ${view.summary} ${view.link}`).not.toMatch(OTHER_LEAGUES);
    expect(view.link).toContain(PHANTOM_SLUG);
    expect(heroLeagueMark(PHANTOM_SLUG as never)).toBe(PHANTOM_LOGO.dark);
  });

  it('gets the bare dark card on the live board', async () => {
    const { surfaceForLeague, groundsFor, DEFAULT_GROUNDS } = await import('../src/utils/live/surface');
    expect(surfaceForLeague(PHANTOM_SLUG)).toBe(PHANTOM_NAV);
    expect(groundsFor(PHANTOM_NAV)).toEqual(DEFAULT_GROUNDS);
  });

  it("shows no other league's champion, admins or push art", async () => {
    const { getFooterChampions } = await import('../src/utils/footer-champions');
    const { getAdminFranchiseIds } = await import('../src/config/nav-config');
    const { leaguePushIcon, leaguePushBadge } = await import('../src/utils/push-notify-trade');
    expect(getFooterChampions(PHANTOM_SLUG as never)).toEqual([]);
    expect(getAdminFranchiseIds(PHANTOM_NAV as never)).toEqual([]);
    expect(leaguePushIcon(PHANTOM_NAV)).toBe('/assets/icons/pwa/icon-192.png');
    expect(leaguePushBadge(PHANTOM_NAV)).not.toMatch(/afl/);
  });

  it('is not scheduled or scanned until it opts in', async () => {
    const { SCHEDULE_POLICY } = await import('../src/utils/schedule-plan.mjs');
    const { SCHEFTER_LEAGUES } = await import('../scripts/lib/schefter-leagues.mjs');
    expect(SCHEDULE_POLICY[PHANTOM_SLUG]).toBeUndefined();
    expect(SCHEFTER_LEAGUES.some((l: { registrySlug: string }) => l.registrySlug === PHANTOM_SLUG)).toBe(false);
  });

  it('gets its own feature suggestions', async () => {
    const { suggestLeagueSetup } = await import('../src/config/league-archetypes.mjs');
    const s = suggestLeagueSetup({ franchises: { count: '12' }, keeperType: 'none' });
    expect(s.archetype).toBe('standard-redraft');
  });
});
