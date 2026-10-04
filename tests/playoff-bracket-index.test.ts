/**
 * The shared Playoffs page (the AFL's, repeated for package leagues — the
 * owner's call, Oct 2026) and the gate that hides it until a league's real MFL
 * brackets exist.
 *
 * Pinned here:
 *   1. data/playoff-bracket-leagues.json agrees with the committed feeds — it
 *      is what the nav, the header and the quick links read, and it must not
 *      drift from the data it summarizes.
 *   2. The feed sync writes predicted brackets for the default league only:
 *      the prediction is TheLeague's format, and written for Archie's it
 *      announced TheLeague's playoff weeks on Archie's calendar.
 *   3. A ticked Playoffs box is not enough — the route, its links and its
 *      article links stay hidden until the league is in the index.
 *   4. The package-league resolver shows MFL's resolved franchises and leaves
 *      an unresolved seed a placeholder rather than guessing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  packageLeagueHasPath,
  packageLinkVisible,
  packageRoutesFor,
} from '../src/config/package-league-routes.mjs';
import { isRealBracketFeed, leaguesWithRealBrackets } from '../src/utils/playoff-bracket-index.mjs';
import {
  buildBracketViews,
  findFinalGame,
  franchiseResolver,
  loadSeasonBrackets,
} from '../src/utils/playoff-bracket-views';
import { buildPackageLeagueEvents } from '../src/utils/package-league-events';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('the playoff-bracket index', () => {
  it('lists exactly the leagues whose committed feeds hold real MFL brackets', () => {
    expect(JSON.parse(read('data/playoff-bracket-leagues.json'))).toEqual(leaguesWithRealBrackets(ROOT));
  });

  it('never counts a predicted or empty feed as real', () => {
    expect(isRealBracketFeed({ predicted: true, brackets: { 1: {} } })).toBe(false);
    expect(isRealBracketFeed({ brackets: {} })).toBe(false);
    expect(isRealBracketFeed(null)).toBe(false);
    expect(isRealBracketFeed({ brackets: { 1: {} } })).toBe(true);
  });

  it('is fed by the sync, which predicts brackets for the default league only', () => {
    const src = read('scripts/fetch-mfl-feeds.mjs');
    const fn = src.slice(src.indexOf('const writePredictedBracketsIfSafe'));
    expect(fn.slice(0, 1200)).toMatch(/if \(leagueName !== DEFAULT_LEAGUE_SLUG\)/);
    expect(src).toMatch(/recordBracketLeague\(process\.cwd\(\), leagueName\)/);
  });
});

describe('the Playoffs gate for a package league', () => {
  const phantom = (slug: string, playoffs: boolean) => ({
    ...LEAGUES.archies,
    slug,
    features: { ...LEAGUES.archies.features, playoffs },
  });

  it('generates the route whenever the box is ticked, so it is there the moment brackets land', () => {
    expect(packageRoutesFor(phantom('phantom', true).features)).toContain('playoffs.astro');
    expect(packageRoutesFor(phantom('phantom', false).features)).not.toContain('playoffs.astro');
  });

  it('links it only once the league is in the index', () => {
    // Not in the index: box ticked, still hidden — in every listing surface's shape.
    const waiting = phantom('phantom', true);
    expect(packageLeagueHasPath(waiting, '/playoffs')).toBe(false);
    expect(packageLinkVisible(waiting, '/playoffs')).toBe(false);
    expect(packageLinkVisible(waiting, '/phantom/playoffs')).toBe(false);
    // In the index (borrowing a slug that is): shown.
    const live = phantom('theleague', true);
    expect(packageLeagueHasPath(live, '/playoffs')).toBe(true);
    // Box unticked: hidden whatever the data says.
    expect(packageLeagueHasPath(phantom('theleague', false), '/playoffs')).toBe(false);
    // Other routes and non-package leagues are untouched.
    expect(packageLinkVisible(waiting, '/standings')).toBe(true);
    expect(packageLinkVisible(LEAGUES['afl-fantasy'], '/afl-fantasy/playoffs')).toBe(true);
  });

  it('is asked by the route and every surface that lists a package league’s pages', () => {
    expect(read('templates/package-league/playoffs.astro.tmpl')).toMatch(/packageRouteHasData\(league, 'playoffs\.astro'\)/);
    expect(read('src/components/shared/Header.astro')).toMatch(/packageLinkVisible\(pkg, l\.path\)/);
    expect(read('src/components/shared/hp-sections/QuickLinks.astro')).toMatch(/packageLinkVisible\(league, p\.path\)/);
  });
});

describe('the package-league bracket resolver', () => {
  const feed = JSON.parse(read('data/theleague/mfl-feeds/2025/playoff-brackets.json'));
  const standings = JSON.parse(read('data/theleague/mfl-feeds/2025/standings.json')).leagueStandings.franchise;
  const teams = standings.map((r: any) => ({ franchiseId: r.id, name: `Club ${r.id}`, icon: `/i/${r.id}.png` }));
  const { brackets } = loadSeasonBrackets(feed);
  const views = buildBracketViews({
    brackets,
    mode: 'projected',
    resolveTeam: franchiseResolver({ standings, teams }),
    weeklyScores: new Map(),
  });

  it("names MFL's resolved franchises with the league's own team names and a champion", () => {
    const final = findFinalGame(views, '1');
    expect(final?.winnerId).toMatch(/^\d{4}$/);
    expect(final?.game.home.label).toMatch(/^Club \d{4}$/);
    expect(final?.game.home.icon).toMatch(/^\/i\/\d{4}\.png$/);
  });

  it('leaves a slot MFL has not filled as a placeholder, never a guessed team', () => {
    const resolve = franchiseResolver({ standings, teams });
    expect(resolve({ seed: '3' }, '1', new Map())).toBeUndefined();
  });
});

describe("a package league's calendar", () => {
  it('reads no playoff weeks out of a predicted bracket file', () => {
    const predicted = {
      predicted: true,
      playoffBrackets: { playoffBracket: [{ id: '1', startWeek: '15', teamsInvolved: '7' }] },
    };
    const events = buildPackageLeagueEvents({
      league: LEAGUES.archies,
      seasons: [{ seasonYear: 2026, calendar: [], playoffBrackets: predicted }],
      referenceDate: new Date('2026-10-04T12:00:00Z'),
    } as never);
    expect(events.map((e: any) => e.id).filter((id: string) => /playoffs|championship/.test(id))).toEqual([]);
  });
});
