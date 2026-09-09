import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_RETURN_PARAMS,
  RETURN_PARAM,
  loginFallbackPath,
  loginPathFor,
  loginUrlFor,
  loginUrlForRequest,
  readReturnPath,
  resolveLoginDestination,
  safeReturnPath,
} from '../src/utils/login-redirect';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues';

/**
 * "Sign in, then send me back where I was going" is one mechanism now
 * (src/utils/login-redirect.ts). It used to be three copies that disagreed,
 * and every disagreement below is a bug that was live in the tree:
 *
 *   - best-ball-1/login read `?next=` alone, so `?redirect=` links died silently
 *   - LoginForm sanitised for same-ORIGIN but not same-LEAGUE, so a stale
 *     parked `/theleague/...` path survived an AFL sign-in
 *   - LoginForm's failure default was the literal '/theleague', which is the
 *     wrong league two times out of three
 *
 * The apex-host cases are the ones with no local symptom: they are correct on
 * a preview deployment and a redirect loop on production.
 */

const theleague = getLeagueBySlug('theleague')!;
const afl = getLeagueBySlug('afl-fantasy')!;
const bb1 = getLeagueBySlug('best-ball-1')!;

describe('safeReturnPath', () => {
  it('accepts a plain in-league path', () => {
    expect(safeReturnPath('/theleague/lineup', theleague)).toBe('/theleague/lineup');
    expect(safeReturnPath('/afl-fantasy/lineup', afl)).toBe('/afl-fantasy/lineup');
  });

  it('accepts the league home itself', () => {
    expect(safeReturnPath('/theleague', theleague)).toBe('/theleague');
  });

  it('preserves query and hash', () => {
    // schefter/tip carries its own query; losing it at the door drops the tip.
    expect(safeReturnPath('/theleague/schefter/tip?draft=abc', theleague))
      .toBe('/theleague/schefter/tip?draft=abc');
    expect(safeReturnPath('/theleague/rosters#taxi', theleague))
      .toBe('/theleague/rosters#taxi');
  });

  describe('normalizes the apex-host shape', () => {
    // On theleague.us the visitor's path has no /theleague prefix, because the
    // middleware rewrites it in. Both shapes must mean the same page.
    it('adds the prefix to a clean path', () => {
      expect(safeReturnPath('/lineup', theleague)).toBe('/theleague/lineup');
      expect(safeReturnPath('/lineup', afl)).toBe('/afl-fantasy/lineup');
    });

    it('treats bare / as the league home', () => {
      expect(safeReturnPath('/', theleague)).toBe('/theleague');
    });

    it('does not mangle a path that merely starts with the slug', () => {
      // `/theleague-foo` is not inside `/theleague/`.
      expect(safeReturnPath('/theleague-foo', theleague)).toBe('/theleague/theleague-foo');
    });
  });

  describe('rejects cross-league paths', () => {
    // The bug this exists for: a dual-league owner signs into the AFL and a
    // same-origin-only check returns them to a TheLeague page their fresh
    // session cannot read.
    it('rejects an AFL path on TheLeague', () => {
      expect(safeReturnPath('/afl-fantasy/lineup', theleague)).toBeNull();
    });

    it('rejects a TheLeague path on the AFL', () => {
      expect(safeReturnPath('/theleague/lineup', afl)).toBeNull();
    });

    it('rejects a best-ball path on both', () => {
      expect(safeReturnPath('/best-ball-1/draft-room', theleague)).toBeNull();
      expect(safeReturnPath('/best-ball-1/draft-room', afl)).toBeNull();
    });

    it('rejects a cross-league path disguised with ..', () => {
      expect(safeReturnPath('/theleague/../afl-fantasy/lineup', theleague)).toBeNull();
    });
  });

  describe('rejects anything that leaves the site', () => {
    const hostile = [
      '//evil.com',                    // protocol-relative; passes startsWith('/')
      '///evil.com',
      'https://evil.com/theleague',
      'http://evil.com',
      '/\\evil.com',                   // backslash normalized to / by some engines
      '\\\\evil.com',
      'javascript:alert(1)',           // no `://`, so a naive check misses it
      'data:text/html,<script>',
      'theleague/lineup',              // relative, not absolute
      '',
    ];

    for (const value of hostile) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(safeReturnPath(value, theleague)).toBeNull();
      });
    }

    it('rejects control characters (header-splitting shape)', () => {
      expect(safeReturnPath('/theleague/lineup\r\nX-Evil: 1', theleague)).toBeNull();
      expect(safeReturnPath('/theleague/ lineup', theleague)).toBeNull();
      expect(safeReturnPath('/theleague/\u0000', theleague)).toBeNull();
    });

    it('rejects null and undefined', () => {
      expect(safeReturnPath(null, theleague)).toBeNull();
      expect(safeReturnPath(undefined, theleague)).toBeNull();
    });
  });
});

describe('loginUrlFor', () => {
  it('emits ?next= on the shared host', () => {
    expect(loginUrlFor({ league: theleague, returnTo: '/theleague/lineup' }))
      .toBe(`/theleague/login?${RETURN_PARAM}=${encodeURIComponent('/theleague/lineup')}`);
  });

  it('uses each league own login route', () => {
    expect(loginUrlFor({ league: afl, returnTo: '/afl-fantasy/lineup' }))
      .toContain('/afl-fantasy/login?');
    expect(loginUrlFor({ league: bb1, returnTo: '/best-ball-1/draft-room' }))
      .toContain('/best-ball-1/login?');
  });

  describe('apex host', () => {
    // The redirect-loop case: emit a prefixed URL on theleague.us and Vercel
    // 301s it straight back. Production-only, invisible on previews.
    it('emits clean paths on both sides when the prefix is hidden', () => {
      const url = loginUrlFor({
        league: theleague,
        returnTo: '/lineup',
        hideLeaguePrefix: true,
      });
      expect(url).toBe(`/login?${RETURN_PARAM}=${encodeURIComponent('/lineup')}`);
      expect(url).not.toContain('/theleague');
    });

    it('strips the prefix from a return path that arrived prefixed', () => {
      const url = loginUrlFor({
        league: afl,
        returnTo: '/afl-fantasy/lineup',
        hideLeaguePrefix: true,
      });
      expect(url).toBe(`/login?${RETURN_PARAM}=${encodeURIComponent('/lineup')}`);
    });
  });

  it('falls back to a bare login URL when the return path is unusable', () => {
    expect(loginUrlFor({ league: theleague, returnTo: '//evil.com' })).toBe('/theleague/login');
    expect(loginUrlFor({ league: afl, returnTo: '/theleague/lineup' })).toBe('/afl-fantasy/login');
    expect(loginUrlFor({ league: theleague, returnTo: null })).toBe('/theleague/login');
    expect(loginUrlFor({ league: theleague })).toBe('/theleague/login');
  });

  it('never returns the visitor to the login page itself', () => {
    // Otherwise a signed-out visitor who reloads /login gets ?next=/login and
    // bounces on the spot after signing in.
    expect(loginUrlFor({ league: theleague, returnTo: '/theleague/login' }))
      .toBe('/theleague/login');
    expect(loginUrlFor({ league: theleague, returnTo: '/theleague/login?next=/x' }))
      .toBe('/theleague/login');
  });

  it('encodes the return path so its query survives', () => {
    const url = loginUrlFor({
      league: theleague,
      returnTo: '/theleague/schefter/tip?draft=a&b=c',
    });
    // The inner query must not read as another param of the login URL.
    expect(new URL(url, 'https://x.test').searchParams.get(RETURN_PARAM))
      .toBe('/theleague/schefter/tip?draft=a&b=c');
    expect(new URL(url, 'https://x.test').searchParams.get('draft')).toBeNull();
  });
});

describe('loginUrlForRequest', () => {
  // What every gate actually calls. `Astro` satisfies this shape structurally.
  const ctx = (href: string, hideLeaguePrefix = false) => ({
    url: new URL(href),
    locals: { hideLeaguePrefix },
  });

  it('returns the visitor to the page they are standing on', () => {
    expect(loginUrlForRequest(ctx('https://mfl.football/theleague/lineup'), theleague))
      .toBe(`/theleague/login?${RETURN_PARAM}=${encodeURIComponent('/theleague/lineup')}`);
  });

  it('carries the query string', () => {
    expect(loginUrlForRequest(ctx('https://mfl.football/theleague/schefter/tip?target=0003'), theleague))
      .toBe(`/theleague/login?${RETURN_PARAM}=${encodeURIComponent('/theleague/schefter/tip?target=0003')}`);
  });

  /**
   * THE PRODUCTION-ONLY BUG THIS PREVENTS. On theleague.us the middleware
   * rewrites `/lineup` → `/theleague/lineup`, so a gate may see EITHER shape
   * in Astro.url.pathname depending on where the rewrite lands. Both must
   * produce a URL in the shape THIS host serves, or the gate 302s to a URL
   * the edge 301s straight back — a loop that never appears on a preview.
   */
  describe('is host-shape agnostic', () => {
    it('apex host + clean path -> clean login URL', () => {
      expect(loginUrlForRequest(ctx('https://www.theleague.us/lineup', true), theleague))
        .toBe(`/login?${RETURN_PARAM}=${encodeURIComponent('/lineup')}`);
    });

    it('apex host + already-rewritten prefixed path -> STILL a clean login URL', () => {
      expect(loginUrlForRequest(ctx('https://www.theleague.us/theleague/lineup', true), theleague))
        .toBe(`/login?${RETURN_PARAM}=${encodeURIComponent('/lineup')}`);
    });

    it('shared host + prefixed path -> prefixed login URL', () => {
      expect(loginUrlForRequest(ctx('https://mfl.football/afl-fantasy/lineup'), afl))
        .toBe(`/afl-fantasy/login?${RETURN_PARAM}=${encodeURIComponent('/afl-fantasy/lineup')}`);
    });

    it('never emits a prefix on an apex host', () => {
      for (const league of [theleague, afl]) {
        const url = loginUrlForRequest(
          ctx(`https://example.test/${league.slug}/anything`, true),
          league,
        );
        expect(url).not.toContain(`/${league.slug}`);
      }
    });
  });

  it('tolerates locals with no hideLeaguePrefix set', () => {
    expect(loginUrlForRequest({ url: new URL('https://mfl.football/theleague/lineup'), locals: {} }, theleague))
      .toContain('/theleague/login?');
  });
});

describe('readReturnPath', () => {
  const at = (search: string) => new URL(`https://mfl.football/theleague/login${search}`);

  it('reads the emitted ?next=', () => {
    expect(readReturnPath(at('?next=%2Ftheleague%2Flineup'), theleague))
      .toBe('/theleague/lineup');
  });

  it('still reads legacy ?redirect= links', () => {
    // Links already in GroupMe messages, Schefter posts and bookmarks.
    expect(readReturnPath(at('?redirect=%2Ftheleague%2Flineup'), theleague))
      .toBe('/theleague/lineup');
  });

  it('prefers ?next= when both are present', () => {
    expect(
      readReturnPath(at('?next=%2Ftheleague%2Fa&redirect=%2Ftheleague%2Fb'), theleague),
    ).toBe('/theleague/a');
  });

  it('falls through to ?redirect= when ?next= is unusable', () => {
    expect(readReturnPath(at('?next=%2F%2Fevil.com&redirect=%2Ftheleague%2Fok'), theleague))
      .toBe('/theleague/ok');
  });

  it('returns null with no params', () => {
    expect(readReturnPath(at(''), theleague)).toBeNull();
  });

  it('validates against the league, not just the origin', () => {
    expect(readReturnPath(at('?next=%2Fafl-fantasy%2Flineup'), theleague)).toBeNull();
  });
});

describe('resolveLoginDestination', () => {
  it('never returns null — the league home is the floor', () => {
    const bare = new URL('https://mfl.football/afl-fantasy/login');
    expect(resolveLoginDestination(bare, afl)).toBe('/afl-fantasy');
  });

  it('lands the wrong-league request on THIS league home, not TheLeague', () => {
    // LoginForm's old fallback was the literal '/theleague', which is the
    // wrong answer on two of the three login pages.
    const hostile = new URL('https://mfl.football/afl-fantasy/login?next=%2Ftheleague%2Flineup');
    expect(resolveLoginDestination(hostile, afl)).toBe('/afl-fantasy');
  });
});

describe('every registry league is covered', () => {
  // Adding a league must not require touching this module. If this fails, the
  // new league has no login route or no prefix and its gates will 404.
  for (const league of ALL_LEAGUES) {
    it(`${league.slug} resolves a login path, fallback and round-trip`, () => {
      expect(loginPathFor(league)).toBe(`/${league.slug}/login`);
      expect(loginFallbackPath(league)).toBe(`/${league.slug}`);

      const returnTo = `/${league.slug}/some-page`;
      const url = loginUrlFor({ league, returnTo });
      const parsed = new URL(url, 'https://mfl.football');
      expect(parsed.pathname).toBe(loginPathFor(league));
      expect(readReturnPath(parsed, league)).toBe(returnTo);
    });

    it(`${league.slug} round-trips through its apex shape`, () => {
      const url = loginUrlFor({
        league,
        returnTo: `/${league.slug}/some-page`,
        hideLeaguePrefix: true,
      });
      expect(url.startsWith('/login?')).toBe(true);
      // The clean path read back on the apex host resolves to the same page.
      const parsed = new URL(url, 'https://mfl.football');
      expect(readReturnPath(parsed, league)).toBe(`/${league.slug}/some-page`);
    });
  }
});

describe('constants', () => {
  it('emits next and accepts redirect', () => {
    expect(RETURN_PARAM).toBe('next');
    expect(ACCEPTED_RETURN_PARAMS).toContain('redirect');
    expect(ACCEPTED_RETURN_PARAMS[0]).toBe(RETURN_PARAM);
  });
});
