import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_LEAGUES,
  isSharedAppHost,
  leagueHasOwnFrontDoor,
  resolveSharedHostHiddenLeague,
} from '../src/config/leagues';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

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
  const SHARED = ['mfl.football', 'v2.mfl.football', 'staging.mfl.football'];

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

  it('the splash links hidden leagues out to their own domain', () => {
    const src = read('src/pages/index.astro');
    expect(src).toContain('resolveSharedHostHiddenLeague');
    expect(src).toContain('leagueUrl');
    // Both link surfaces go through the helper — the panels and the
    // What's New cards, whose detailPath is itself a league path.
    expect(src).toMatch(/href=\{linkOut\(`\/\$\{league\.slug\}`\)\}/);
    expect(src).toMatch(/href=\{linkOut\(entry\.detailPath\)\}/);
  });

  it('the splash keeps relative links off the shared host, so previews stay drivable', () => {
    expect(read('src/pages/index.astro')).toMatch(/if \(!onSharedHost\) return path;/);
  });
});
