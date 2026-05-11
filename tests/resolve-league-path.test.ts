import { describe, it, expect } from 'vitest';
import { resolveLeaguePath } from '../src/utils/nav-utils';

// resolveLeaguePath is the outbound complement to the middleware host map.
// When the request comes in on a league apex host (theleague.us,
// afl-fantasy.com) the middleware sets locals.hideLeaguePrefix=true and
// rewrites the URL internally. resolveLeaguePath ensures generated <a>
// targets match the clean URL the user sees in the address bar.

describe('resolveLeaguePath', () => {
  describe('hidePrefix = false (e.g. preview deployment, localhost)', () => {
    it('returns /theleague paths unchanged', () => {
      expect(resolveLeaguePath('/theleague/rosters', false)).toBe(
        '/theleague/rosters'
      );
    });

    it('returns /afl-fantasy paths unchanged', () => {
      expect(resolveLeaguePath('/afl-fantasy/standings', false)).toBe(
        '/afl-fantasy/standings'
      );
    });

    it('returns root unchanged', () => {
      expect(resolveLeaguePath('/', false)).toBe('/');
    });
  });

  describe('hidePrefix = true (on a league apex host)', () => {
    it('strips /theleague from /theleague/rosters → /rosters', () => {
      expect(resolveLeaguePath('/theleague/rosters', true)).toBe('/rosters');
    });

    it('maps bare /theleague → /', () => {
      expect(resolveLeaguePath('/theleague', true)).toBe('/');
    });

    it('strips /afl-fantasy from /afl-fantasy/standings → /standings', () => {
      expect(resolveLeaguePath('/afl-fantasy/standings', true)).toBe(
        '/standings'
      );
    });

    it('maps bare /afl-fantasy → /', () => {
      expect(resolveLeaguePath('/afl-fantasy', true)).toBe('/');
    });

    it('strips deep paths /afl-fantasy/franchises/0001 → /franchises/0001', () => {
      expect(resolveLeaguePath('/afl-fantasy/franchises/0001', true)).toBe(
        '/franchises/0001'
      );
    });

    it('preserves query strings', () => {
      expect(resolveLeaguePath('/afl-fantasy/standings?view=all_play', true)).toBe(
        '/standings?view=all_play'
      );
    });

    it('leaves non-league paths unchanged', () => {
      // /api/* and other root-level paths should pass through unmolested
      expect(resolveLeaguePath('/api/foo', true)).toBe('/api/foo');
      expect(resolveLeaguePath('/assets/icon.png', true)).toBe('/assets/icon.png');
    });

    it('does not strip /theleagueX (substring collision guard)', () => {
      // The check is for exact prefix match or `/theleague/`, so /theleagueX
      // is left alone. (Also see middleware-host-map.test.ts for the
      // inbound-side equivalent of this trap.)
      expect(resolveLeaguePath('/theleagueX', true)).toBe('/theleagueX');
    });

    it('does not strip /afl-fantasy-x (substring collision guard)', () => {
      expect(resolveLeaguePath('/afl-fantasy-x', true)).toBe('/afl-fantasy-x');
    });
  });
});
