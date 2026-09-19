import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_LEAGUES,
  isSharedAppHost,
  leagueHasOwnFrontDoor,
  resolveSharedHostHiddenLeague,
} from '../src/config/leagues';
import { crossHostLeagueHref } from '../src/config/leagues';
import { getLeagueSwitchTargets } from '../src/utils/nav-utils';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every hostname that serves the shared app, in both environments. */
const SHARED_HOSTS = ['mfl.football', 'v2.mfl.football', 'staging.mfl.football'];

/**
 * The shared app host (mfl.football, v2.mfl.football) is the MFL app — MFL
 * Live, the splash, sign-in, and the leagues that live nowhere else. It is
 * deliberately NOT a second front door into TheLeague or the AFL, which have
 * domains of their own. A league reachable at two addresses is two sets of
 * links to keep alive, two things for a search engine to index, and two places
 * an owner can be signed in.
 *
 * The rule is DERIVED from whether a league owns a domain, and that is the
 * property this file mostly exists to protect. A hardcoded
 * ['theleague', 'afl-fantasy'] reads identically today and fails in both
 * directions later: it would hide best-ball #2 the day it is given an apex,
 * and expose a fourth full league the day one is added.
 */
describe('the shared host does not serve a league that has its own domain', () => {
  const SHARED = SHARED_HOSTS;

  /**
   * The expectation is computed from the registry DATA (`domains`), never from
   * `leagueHasOwnFrontDoor` — asserting a function against itself passes no
   * matter what the function says. An earlier draft of this test did exactly
   * that and survived the helper being replaced with a literal slug list.
   */
  it('hides exactly the leagues that declare a domain of their own', () => {
    for (const host of SHARED) {
      for (const league of ALL_LEAGUES) {
        const ownsADomain = (league.domains?.length ?? 0) > 0;
        const hidden = resolveSharedHostHiddenLeague(host, `/${league.slug}`);
        expect(
          hidden?.slug ?? null,
          `${host}/${league.slug} (domains: ${JSON.stringify(league.domains)})`,
        ).toBe(ownsADomain ? league.slug : null);
      }
    }
  });

  it('the helper agrees with the registry data for every league', () => {
    for (const league of ALL_LEAGUES) {
      expect(leagueHasOwnFrontDoor(league), league.slug).toBe((league.domains?.length ?? 0) > 0);
    }
  });

  /**
   * The above two still pass if the rule is a slug list that HAPPENS to match
   * today's registry — which is the whole failure mode, because it diverges
   * silently the next time a league is added or given an apex. So the rule is
   * also read: it must consult `domains`, and must not name a league.
   */
  it('derives the rule from `domains` rather than naming leagues', () => {
    const registry = readFileSync(join(ROOT, 'src/config/leagues-data.mjs'), 'utf8');
    const body = registry.slice(
      registry.indexOf('export function leagueHasOwnFrontDoor'),
      registry.indexOf('export function resolveSharedHostHiddenLeague'),
    );
    expect(body, 'the helper must exist').toContain('leagueHasOwnFrontDoor');
    expect(body).toContain('domains');
    for (const league of ALL_LEAGUES) {
      expect(body, `${league.slug} is named in a rule that must be derived`)
        .not.toContain(`'${league.slug}'`);
    }
  });

  /**
   * The one that would be a silent deletion. Best Ball #1 has `domains: []` —
   * the shared host's path prefix is the ONLY address it has, so hiding it
   * there removes it from the internet rather than redirecting it somewhere.
   */
  it('never hides a league that has nowhere else to be', () => {
    const homeless = ALL_LEAGUES.filter((l) => !leagueHasOwnFrontDoor(l));
    expect(homeless.length, 'the premise: at least one path-only league exists').toBeGreaterThan(0);
    for (const league of homeless) {
      for (const host of SHARED) {
        expect(resolveSharedHostHiddenLeague(host, `/${league.slug}`)).toBeNull();
        expect(resolveSharedHostHiddenLeague(host, `/${league.slug}/draft`)).toBeNull();
      }
    }
  });

  it('hides the whole subtree, not just the bare prefix', () => {
    for (const p of ['/theleague', '/theleague/', '/theleague/rosters', '/theleague/whats-new/x']) {
      expect(resolveSharedHostHiddenLeague('v2.mfl.football', p), p).not.toBeNull();
    }
  });

  it('matches on a path SEGMENT, so a lookalike route is not caught', () => {
    for (const p of ['/theleague-archive', '/afl-fantasy-history', '/theleaguex']) {
      expect(resolveSharedHostHiddenLeague('v2.mfl.football', p), p).toBeNull();
    }
  });

  it('leaves the app’s own surfaces alone', () => {
    for (const p of ['/', '/live', '/live/settings', '/login', '/api/live-board', '/404']) {
      expect(resolveSharedHostHiddenLeague('v2.mfl.football', p), p).toBeNull();
    }
  });

  /**
   * Hiding is a property of the SHARED host only. A league's own apex must
   * keep serving it, and localhost / Vercel previews must keep serving
   * everything or the branch under test cannot be driven past its front page.
   */
  it('hides nothing on a league host, localhost or a preview', () => {
    const others = [
      'localhost',
      'mfl-football-v2-git-some-branch.vercel.app',
      ...ALL_LEAGUES.flatMap((l) => [...(l.domains ?? []), ...(l.stagingDomains ?? [])]),
    ];
    for (const host of others) {
      expect(isSharedAppHost(host), `${host} is not the shared host`).toBe(false);
      for (const league of ALL_LEAGUES) {
        expect(
          resolveSharedHostHiddenLeague(host, `/${league.slug}/rosters`),
          `${host}/${league.slug}/rosters`,
        ).toBeNull();
      }
    }
  });
});

describe('the middleware serves it as a real 404', () => {
  const src = read('src/middleware.ts');

  it('asks the registry rather than testing the path itself', () => {
    expect(src).toContain('resolveSharedHostHiddenLeague');
    // A slug literal here would be the hardcoded list this rule avoids.
    expect(src).not.toMatch(/['"`]\/theleague['"`]/);
    expect(src).not.toMatch(/['"`]\/afl-fantasy['"`]/);
  });

  /**
   * `/404` sets no status, so rewriting there answers 200 with a not-found
   * page — a SOFT 404, which stays indexed. This repo's real 404 status lives
   * in the catch-all (`[...path].astro` sets `Astro.response.status = 404`),
   * so the rewrite target must be a path no route claims.
   */
  it('rewrites to the catch-all, not to the soft-404 page', () => {
    const target = src.match(/context\.rewrite\(new URL\('([^']+)'/)?.[1];
    expect(target, 'the shared-host block rewrites somewhere').toBeTruthy();
    expect(target, 'a rewrite to /404 would answer 200').not.toBe('/404');
    expect(existsSync(join(ROOT, `src/pages${target}.astro`)), `${target} must not be a real page`)
      .toBe(false);
  });

  it('rewrites outside every league prefix, so the branch cannot re-enter itself', () => {
    const target = src.match(/context\.rewrite\(new URL\('([^']+)'/)?.[1] ?? '';
    for (const host of ['mfl.football', 'v2.mfl.football', 'staging.mfl.football']) {
      expect(resolveSharedHostHiddenLeague(host, target), `${target} must not itself be hidden`)
        .toBeNull();
    }
  });

  it('the catch-all still pins the 404 status this depends on', () => {
    expect(read('src/pages/[...path].astro')).toMatch(/Astro\.response\.status\s*=\s*404/);
  });
});

describe('nothing on the shared host links into a hidden league', () => {
  /**
   * The escape hatch that pointed back at the trapdoor: 404.astro derives its
   * "get me home" CTA from the league, which on the shared host resolves to
   * `/theleague` — itself a 404 there.
   */
  it('the 404 page sends shared-host visitors to the splash, not a league', () => {
    const src = read('src/pages/404.astro');
    expect(src).toContain('isSharedAppHost');
    expect(src).toMatch(/onSharedHost\s*\?\s*'\/'/);
  });

  /**
   * One rule, one implementation. The splash panels, the What's New cards and
   * the nav switcher all ask "is this league hidden here, and where does it
   * live?" — `crossHostLeagueHref` is the single answer, so these assert its
   * BEHAVIOUR rather than the shape of any one call site.
   */
  it('rewrites a hidden league’s path to its own domain, on every shared host', () => {
    for (const host of ['mfl.football', 'v2.mfl.football', 'staging.mfl.football']) {
      for (const p of ['/theleague', '/afl-fantasy/rosters', '/theleague/whats-new/abc']) {
        const href = crossHostLeagueHref(host, p);
        expect(href.startsWith('https://'), `${host} ${p} -> ${href}`).toBe(true);
        expect(resolveSharedHostHiddenLeague(host, href), `${href} must not itself be hidden`)
          .toBeNull();
      }
    }
  });

  it('leaves everything else exactly as it was', () => {
    // Best Ball on the shared host, and every league off it. An unchanged
    // return is what keeps previews drivable and bb1 reachable.
    expect(crossHostLeagueHref('v2.mfl.football', '/best-ball-1/draft')).toBe('/best-ball-1/draft');
    for (const host of ['localhost', 'mfl-football-v2-git-branch.vercel.app']) {
      for (const p of ['/theleague/rosters', '/afl-fantasy', '/best-ball-1']) {
        expect(crossHostLeagueHref(host, p), `${host} ${p}`).toBe(p);
      }
    }
  });

  it('both splash link surfaces go through it — the panels AND the cards', () => {
    const src = read('src/pages/index.astro');
    expect(src).toContain('crossHostLeagueHref');
    expect(src).toMatch(/href=\{hrefFromHere\(`\/\$\{league\.slug\}`\)\}/);
    expect(src).toMatch(/href=\{hrefFromHere\(entry\.detailPath\)\}/);
  });

  it('the switcher shares that helper rather than re-deciding it', () => {
    expect(read('src/utils/nav-utils.ts')).toContain('crossHostLeagueHref');
  });
});

/**
 * The regression that is invisible in the diff.
 *
 * Best Ball #1 still renders on the shared host — it has no other address —
 * and it renders the SHARED nav, whose league switcher offered a relative
 * `/theleague/rosters`. That became a 404 the moment the host stopped serving
 * TheLeague, in a file the hiding change never touched.
 */
describe('the nav switcher does not offer a link the current host refuses', () => {
  it('goes absolute for a hidden league, from the one league still served there', () => {
    for (const host of ['mfl.football', 'v2.mfl.football', 'staging.mfl.football']) {
      const targets = getLeagueSwitchTargets('bb1', '/best-ball-1/rosters', false, host);
      expect(targets.length, 'the premise: other leagues exist to switch to').toBeGreaterThan(0);
      for (const t of targets) {
        expect(
          resolveSharedHostHiddenLeague(host, t.href),
          `${host} switcher offers ${t.href}, which 404s there`,
        ).toBeNull();
        expect(t.href.startsWith('http'), `${t.name} must leave the shared host`).toBe(true);
      }
    }
  });

  it('still links relatively on localhost and previews, so they stay drivable', () => {
    for (const host of ['localhost', 'mfl-football-v2-git-branch.vercel.app']) {
      for (const t of getLeagueSwitchTargets('bb1', '/best-ball-1/rosters', false, host)) {
        expect(t.href.startsWith('/'), `${host} should keep ${t.name} relative`).toBe(true);
      }
    }
  });

  /**
   * Required, not optional: an optional hostname would let a future caller
   * reintroduce the dead link by simply not passing it.
   */
  it('requires the hostname rather than defaulting it away', () => {
    const src = readFileSync(join(ROOT, 'src/utils/nav-utils.ts'), 'utf8');
    expect(src).toMatch(/hostname: string\n\): string \{/);
    expect(src, 'an optional hostname is a footgun').not.toMatch(/hostname\?: string/);
    expect(readFileSync(join(ROOT, 'src/components/nav/NavHeader.astro'), 'utf8'))
      .toContain('Astro.url.hostname');
  });
});

/**
 * The front door advertises the FULL-MANAGEMENT leagues only (Sep 2026).
 *
 * This is the only rule in this file that hides a league with nowhere else to
 * be, which makes it the one most likely to be mistaken for the ROUTING rule
 * above and "corrected" into it. It is a presentation rule and nothing more:
 * the splash stops naming Best Ball, and every way of actually reaching Best
 * Ball keeps working. The assertions below are split along exactly that line.
 */
describe('the splash advertises only the full-management leagues', () => {
  const src = read('src/pages/index.astro');

  it('has something to exclude and something to keep', () => {
    // The premise. Without both halves every assertion below is vacuous.
    expect(ALL_LEAGUES.some((l) => l.bestBall), 'a best-ball league exists').toBe(true);
    expect(ALL_LEAGUES.some((l) => !l.bestBall), 'a full-management league exists').toBe(true);
  });

  it('derives the advertised set from `bestBall` rather than listing slugs', () => {
    // Same derivation BOTH_LEAGUES uses for the changelog. A slug list reads
    // identically today and diverges the day a league is added — the failure
    // this file's opening docblock describes, arrived at from a new direction.
    expect(src).toContain('ALL_LEAGUES.filter((league) => !league.bestBall)');
  });

  it('renders the panels from that set, not from ALL_LEAGUES', () => {
    // The one-character regression: restoring `ALL_LEAGUES.map` in the markup
    // puts the panel back while every other assertion here still passes.
    expect(src).toMatch(/\{splashLeagues\.map\(\(league\) => \{/);
    expect(src, 'the panels must not iterate the full registry')
      .not.toMatch(/\{ALL_LEAGUES\.map\(\(league\) => \{/);
  });

  it('counts the headline from the advertised set, not the registry', () => {
    // "Three Leagues. One Home." over two panels is the visible half of
    // forgetting that these are now two different numbers.
    expect(src).toContain('const leagueCount = splashLeagues.length');
  });

  it('scopes the What’s New feed to the same set', () => {
    // A card for a league the page offers no way into, linking to a league
    // prefix the splash no longer names.
    expect(src).toMatch(/getLatestWhatsNewAcrossLeagues\(\s*6,\s*splashLeagues\.map/);
    expect(src).toContain('advertisedNavSlugs.has(slug)');
  });

  /**
   * The half that must NOT have changed. Everything above is about what the
   * splash says; everything below is about whether Best Ball still exists.
   */
  it('still SERVES every hidden-from-the-splash league on the shared host', () => {
    for (const league of ALL_LEAGUES.filter((l) => l.bestBall)) {
      for (const host of SHARED_HOSTS) {
        for (const p of [`/${league.slug}`, `/${league.slug}/draft`]) {
          expect(
            resolveSharedHostHiddenLeague(host, p),
            `${host}${p} must still be served — this league has no other address`,
          ).toBeNull();
        }
      }
    }
  });

  it('still offers it in the nav switcher, which is now how it is found', () => {
    // With the panel gone, the switcher on the two league sites is the
    // remaining discoverable route in. It must be absolute: bb1 has no apex,
    // so buildSwitchUrl sends it to the shared origin.
    for (const league of ALL_LEAGUES.filter((l) => l.bestBall)) {
      const targets = getLeagueSwitchTargets('theleague', '/theleague/rosters', true, 'theleague.us');
      const target = targets.find((t) => t.navSlug === league.navSlug);
      expect(target, `${league.name} must stay in the switcher`).toBeTruthy();
      expect(target!.href.startsWith('http'), `${target!.href} must leave the league apex`).toBe(true);
      expect(target!.href).toContain(`/${league.slug}`);
    }
  });
});
