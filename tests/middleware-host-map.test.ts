import { describe, it, expect } from 'vitest';
import {
  HOST_TO_SLUG,
  SKIP_REWRITE_PREFIXES,
  resolveLeagueRewrite,
} from '../src/utils/league-host-map';

// ---------------------------------------------------------------------------
// HOST_TO_SLUG / SKIP_REWRITE_PREFIXES sanity
// ---------------------------------------------------------------------------

describe('HOST_TO_SLUG', () => {
  it('includes both bare and www. variants for every league', () => {
    const slugs = new Set(Object.values(HOST_TO_SLUG));
    for (const slug of slugs) {
      const hostsForSlug = Object.entries(HOST_TO_SLUG)
        .filter(([, s]) => s === slug)
        .map(([h]) => h);
      const hasBare = hostsForSlug.some((h) => !h.startsWith('www.'));
      const hasWww = hostsForSlug.some((h) => h.startsWith('www.'));
      expect(hasBare, `expected a bare host for slug=${slug}`).toBe(true);
      expect(hasWww, `expected a www host for slug=${slug}`).toBe(true);
    }
  });

  it('contains theleague.us and afl-fantasy.com (dormant)', () => {
    expect(HOST_TO_SLUG['theleague.us']).toBe('theleague');
    expect(HOST_TO_SLUG['afl-fantasy.com']).toBe('afl-fantasy');
  });
});

describe('SKIP_REWRITE_PREFIXES', () => {
  it('contains every league prefix (with trailing slash) so cross-league deep links survive', () => {
    const slugs = Array.from(new Set(Object.values(HOST_TO_SLUG)));
    for (const slug of slugs) {
      expect(SKIP_REWRITE_PREFIXES).toContain(`/${slug}/`);
    }
  });

  it('contains api, astro, image, server-islands, forum, 404, favicon, assets, manifest', () => {
    expect(SKIP_REWRITE_PREFIXES).toContain('/api/');
    expect(SKIP_REWRITE_PREFIXES).toContain('/_astro/');
    expect(SKIP_REWRITE_PREFIXES).toContain('/_image');
    expect(SKIP_REWRITE_PREFIXES).toContain('/_server-islands/');
    expect(SKIP_REWRITE_PREFIXES).toContain('/forum/');
    expect(SKIP_REWRITE_PREFIXES).toContain('/404');
    expect(SKIP_REWRITE_PREFIXES).toContain('/favicon.ico');
    expect(SKIP_REWRITE_PREFIXES).toContain('/assets/');
    expect(SKIP_REWRITE_PREFIXES).toContain('/manifest.json');
  });
});

// ---------------------------------------------------------------------------
// resolveLeagueRewrite — the actual rewrite logic
// ---------------------------------------------------------------------------

describe('resolveLeagueRewrite', () => {
  // -- theleague.us (the in-prod host) --

  it('rewrites / to /theleague on theleague.us', () => {
    expect(resolveLeagueRewrite('theleague.us', '/')).toEqual({
      newPath: '/theleague',
      slug: 'theleague',
    });
  });

  it('rewrites /rosters to /theleague/rosters on theleague.us', () => {
    expect(resolveLeagueRewrite('theleague.us', '/rosters')).toEqual({
      newPath: '/theleague/rosters',
      slug: 'theleague',
    });
  });

  it('rewrites the same way on www.theleague.us', () => {
    expect(resolveLeagueRewrite('www.theleague.us', '/standings')).toEqual({
      newPath: '/theleague/standings',
      slug: 'theleague',
    });
  });

  it('returns null when path is already prefixed (/theleague)', () => {
    expect(resolveLeagueRewrite('theleague.us', '/theleague')).toBeNull();
  });

  it('returns null when path is already prefixed (/theleague/rosters)', () => {
    expect(resolveLeagueRewrite('theleague.us', '/theleague/rosters')).toBeNull();
  });

  it('returns null for /api/* (API routes are root-level)', () => {
    expect(resolveLeagueRewrite('theleague.us', '/api/foo')).toBeNull();
  });

  it('returns null for /_astro/* (Astro internals)', () => {
    expect(
      resolveLeagueRewrite('theleague.us', '/_astro/chunk.123.js')
    ).toBeNull();
  });

  it('returns null for /assets/* (static assets)', () => {
    expect(
      resolveLeagueRewrite('theleague.us', '/assets/theleague/icons/pigskins.png')
    ).toBeNull();
  });

  it('does NOT rewrite a /afl-fantasy/* deep link visited from theleague.us', () => {
    // Cross-league deep links must reach the AFL page.
    expect(
      resolveLeagueRewrite('theleague.us', '/afl-fantasy/standings')
    ).toBeNull();
  });

  // -- afl-fantasy.com (currently dormant, but should work when DNS flips) --

  it('rewrites / to /afl-fantasy on afl-fantasy.com', () => {
    expect(resolveLeagueRewrite('afl-fantasy.com', '/')).toEqual({
      newPath: '/afl-fantasy',
      slug: 'afl-fantasy',
    });
  });

  it('rewrites /standings to /afl-fantasy/standings on afl-fantasy.com', () => {
    expect(resolveLeagueRewrite('afl-fantasy.com', '/standings')).toEqual({
      newPath: '/afl-fantasy/standings',
      slug: 'afl-fantasy',
    });
  });

  it('rewrites the same way on www.afl-fantasy.com', () => {
    expect(resolveLeagueRewrite('www.afl-fantasy.com', '/keepers')).toEqual({
      newPath: '/afl-fantasy/keepers',
      slug: 'afl-fantasy',
    });
  });

  it('returns null when path is already /afl-fantasy', () => {
    expect(resolveLeagueRewrite('afl-fantasy.com', '/afl-fantasy')).toBeNull();
  });

  it('returns null when path is /afl-fantasy/<sub>', () => {
    expect(
      resolveLeagueRewrite('afl-fantasy.com', '/afl-fantasy/standings')
    ).toBeNull();
  });

  it('does NOT rewrite a /theleague/* deep link visited from afl-fantasy.com', () => {
    // Cross-league deep links must reach TheLeague page.
    expect(
      resolveLeagueRewrite('afl-fantasy.com', '/theleague/rosters')
    ).toBeNull();
  });

  // -- non-league hosts --

  it('returns null for a non-league host (vercel deployment)', () => {
    expect(
      resolveLeagueRewrite('mflfootballv2.vercel.app', '/rosters')
    ).toBeNull();
  });

  it('returns null for localhost', () => {
    expect(resolveLeagueRewrite('localhost', '/rosters')).toBeNull();
  });

  // -- edge cases --

  it('does not match a path that merely contains a slug prefix as a substring', () => {
    // e.g. /theleagueX shouldn't be treated as already-prefixed
    expect(resolveLeagueRewrite('theleague.us', '/theleagueX')).toEqual({
      newPath: '/theleague/theleagueX',
      slug: 'theleague',
    });
  });

  it('preserves trailing slash on / → /<slug>', () => {
    expect(resolveLeagueRewrite('theleague.us', '/')).toEqual({
      newPath: '/theleague',
      slug: 'theleague',
    });
  });
});
