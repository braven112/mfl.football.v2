/**
 * Guard: staging hostnames resolve, and NEVER leak into production URLs.
 *
 * The staging sites (staging.theleague.us, staging.afl-fantasy.com) exist so a stable
 * host can hold a session cookie — `createSessionCookie` sets no `Domain`, so
 * a cookie belongs to exactly the host that set it, and Vercel's per-deploy
 * *.vercel.app hostnames orphan it on every push.
 *
 * That buys exactly one requirement: the staging host must map to its league
 * slug so middleware rewrites `/rosters` → `/theleague/rosters`. It must NOT
 * become a candidate for any absolute URL we emit — a GroupMe link or an OG
 * tag on a staging host would send owners somewhere they are not logged in,
 * which is the same class of bug `canonicalDomain` was introduced to fix.
 *
 * Hence `stagingDomains` is a field of its own, and this file pins the split in
 * both directions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_LEAGUES,
  buildHostToSlugMap,
  leagueOrigin,
  leagueUrl,
} from '../src/config/leagues';
import { HOST_TO_SLUG, resolveLeagueRewrite } from '../src/utils/league-host-map';

const ROOT = join(__dirname, '..');
const allStagingDomains = ALL_LEAGUES.flatMap((l) => l.stagingDomains ?? []);

describe('league stagingDomains', () => {
  it('at least one league declares a staging host', () => {
    expect(allStagingDomains.length).toBeGreaterThan(0);
  });

  it('every staging host resolves to its own league slug', () => {
    const map = buildHostToSlugMap();
    for (const league of ALL_LEAGUES) {
      for (const host of league.stagingDomains ?? []) {
        expect(map[host], `${host} missing from host map`).toBe(league.slug);
        expect(HOST_TO_SLUG[host]).toBe(league.slug);
      }
    }
  });

  it('rewrites a bare path under the league prefix on a staging host', () => {
    // The whole point of being in the host map: without this every path on
    // the staging site 404s, because the real Astro route is prefixed.
    for (const league of ALL_LEAGUES) {
      for (const host of league.stagingDomains ?? []) {
        expect(resolveLeagueRewrite(host, '/rosters')).toEqual({
          newPath: `/${league.slug}/rosters`,
          slug: league.slug,
        });
      }
    }
  });

  it('keeps staging hosts OUT of `domains`', () => {
    // `domains` carries invariants a staging host cannot satisfy — a `www.`
    // twin (tests/leagues-registry.test.ts) and prefix-strip redirects in
    // vercel.json (tests/league-url-prefix.test.ts) — and feeds leagueOrigin.
    for (const league of ALL_LEAGUES) {
      for (const host of league.stagingDomains ?? []) {
        expect(league.domains, `${host} must not be in domains`).not.toContain(host);
      }
    }
  });

  it('never lets a staging host become a canonical origin', () => {
    for (const league of ALL_LEAGUES) {
      const origin = leagueOrigin(league);
      for (const host of allStagingDomains) {
        expect(league.canonicalDomain).not.toBe(host);
        expect(origin ?? '').not.toContain(host);
        expect(leagueUrl(league, `/${league.slug}/rosters`)).not.toContain(host);
      }
    }
  });

  it('scopes each staging host under a domain the league already owns', () => {
    // A staging host on some unrelated apex would need its own DNS zone and,
    // worse, would read as a third-party site to anyone checking a link.
    for (const league of ALL_LEAGUES) {
      for (const host of league.stagingDomains ?? []) {
        const apexes = league.domains.filter((d) => !d.startsWith('www.'));
        expect(
          apexes.some((apex) => host.endsWith(`.${apex}`)),
          `${host} is not a subdomain of any of ${league.slug}'s apex domains`,
        ).toBe(true);
      }
    }
  });

  it('leaves the SHARED host unmapped, staging included', () => {
    // mfl.football serves every league under a path prefix. Mapping it (or
    // its staging twin) to a slug would rewrite every OTHER league's paths
    // under that one slug. Path-only leagues therefore declare no staging
    // host of their own — staging.mfl.football is attached in Vercel only.
    for (const host of ['mfl.football', 'www.mfl.football', 'staging.mfl.football']) {
      expect(HOST_TO_SLUG[host]).toBeUndefined();
      expect(resolveLeagueRewrite(host, '/rosters')).toBeNull();
    }
  });

  it('does not put a staging host in vercel.json', () => {
    // vercel.json's host-matched redirects and rewrites are production
    // routing. A staging host listed there would 301 test traffic to prod.
    const vercelJson = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
    for (const host of allStagingDomains) {
      expect(vercelJson, `${host} must not appear in vercel.json`).not.toContain(host);
    }
  });
});
