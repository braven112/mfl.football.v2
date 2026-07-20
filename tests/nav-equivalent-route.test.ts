import { describe, it, expect } from 'vitest';
import {
  getEquivalentRoute,
  getLeagueSwitchUrl,
  getLeagueSwitchTargets,
} from '../src/utils/nav-utils';
import { ALL_LEAGUES } from '../src/config/leagues';

// LeagueSwitcher and NavHeader both consume getEquivalentRoute. These tests
// lock in the cross-league deep-link behavior the 7 dual-league owners depend
// on (AFL_DUPLICATION_PLAN §2.6).

describe('getEquivalentRoute', () => {
  // -- League home / root path --

  it('rewrites /theleague to /afl-fantasy (league home)', () => {
    expect(getEquivalentRoute('/theleague', 'afl')).toBe('/afl-fantasy');
  });

  it('rewrites /afl-fantasy to /theleague (league home)', () => {
    expect(getEquivalentRoute('/afl-fantasy', 'theleague')).toBe('/theleague');
  });

  it('rewrites /theleague/ (with trailing slash) to /afl-fantasy', () => {
    expect(getEquivalentRoute('/theleague/', 'afl')).toBe('/afl-fantasy');
  });

  // -- Route equivalence map hits --

  it('rewrites /theleague/rosters to /afl-fantasy/rosters', () => {
    expect(getEquivalentRoute('/theleague/rosters', 'afl')).toBe(
      '/afl-fantasy/rosters'
    );
  });

  it('rewrites /afl-fantasy/standings to /theleague/standings', () => {
    expect(getEquivalentRoute('/afl-fantasy/standings', 'theleague')).toBe(
      '/theleague/standings'
    );
  });

  it('rewrites /theleague/playoffs to /afl-fantasy/playoffs', () => {
    expect(getEquivalentRoute('/theleague/playoffs', 'afl')).toBe(
      '/afl-fantasy/playoffs'
    );
  });

  it('rewrites /theleague/calendar to /afl-fantasy/calendar', () => {
    expect(getEquivalentRoute('/theleague/calendar', 'afl')).toBe(
      '/afl-fantasy/calendar'
    );
  });

  it('rewrites /theleague/news to /afl-fantasy/news', () => {
    expect(getEquivalentRoute('/theleague/news', 'afl')).toBe(
      '/afl-fantasy/news'
    );
  });

  // -- Query string handling --

  it('preserves query strings when an exact match exists', () => {
    expect(getEquivalentRoute('/theleague/rosters?view=nextyear', 'afl')).toBe(
      '/afl-fantasy/rosters?view=nextyear'
    );
  });

  it('preserves query strings on a base-path match', () => {
    // /standings?year=2024 is not in the map, but /standings is
    expect(getEquivalentRoute('/theleague/standings?year=2024', 'afl')).toBe(
      '/afl-fantasy/standings?year=2024'
    );
  });

  // -- Fallback to league home --

  it('falls back to league home for paths not in the equivalence map', () => {
    // /theleague/contracts has no AFL counterpart (AFL has no contracts
    // page — the plan calls for keepers instead).
    expect(getEquivalentRoute('/theleague/contracts', 'afl')).toBe(
      '/afl-fantasy'
    );
  });

  it('falls back to league home for unknown deep paths', () => {
    expect(getEquivalentRoute('/theleague/some-unknown-page', 'afl')).toBe(
      '/afl-fantasy'
    );
  });

  // -- Idempotence --

  it('returns the same path when target league matches current league prefix', () => {
    // Round-trip a TheLeague URL to TheLeague — should resolve to /theleague/rosters
    // (the function strips the prefix and re-adds it).
    expect(getEquivalentRoute('/theleague/rosters', 'theleague')).toBe(
      '/theleague/rosters'
    );
  });

  // -- Nested / tricky paths --

  it('handles nested routes like /contracts/manage', () => {
    expect(getEquivalentRoute('/theleague/contracts/manage', 'afl')).toBe(
      '/afl-fantasy/contracts/manage'
    );
  });
});

// The nav drawer's league-switch chevron. The regression this locks in:
// on a league apex host the old code passed the cross-league path through
// resolveLeaguePath, which stripped the TARGET league's prefix too —
// "Switch to AFL" on theleague.us linked to /rosters, which the middleware
// rewrote straight back to TheLeague. The switch never switched.
describe('getLeagueSwitchUrl', () => {
  // -- Shared host (mfl.football, localhost, previews): relative prefixed paths --

  it('returns a relative prefixed path on the shared host', () => {
    expect(getLeagueSwitchUrl('/theleague/rosters', 'afl', false)).toBe(
      '/afl-fantasy/rosters'
    );
    expect(getLeagueSwitchUrl('/afl-fantasy/rosters', 'theleague', false)).toBe(
      '/theleague/rosters'
    );
  });

  // -- League apex hosts: absolute URL to the OTHER league's domain --

  it('links to the AFL apex domain when switching from theleague.us', () => {
    expect(getLeagueSwitchUrl('/theleague/rosters', 'afl', true)).toBe(
      'https://www.afl-fantasy.com/rosters'
    );
  });

  it('links to the TheLeague apex domain when switching from afl-fantasy.com', () => {
    expect(getLeagueSwitchUrl('/afl-fantasy/rosters', 'theleague', true)).toBe(
      'https://www.theleague.us/rosters'
    );
  });

  it('never returns a bare de-prefixed same-host path on an apex host', () => {
    // '/rosters' on theleague.us is TheLeague's roster page — the exact
    // regression this helper exists to prevent.
    expect(getLeagueSwitchUrl('/theleague/rosters', 'afl', true)).not.toBe(
      '/rosters'
    );
  });

  it('falls back to the target league home (clean path) on an apex host', () => {
    // /contracts has no AFL counterpart → AFL home on the AFL domain
    expect(getLeagueSwitchUrl('/theleague/contracts', 'afl', true)).toBe(
      'https://www.afl-fantasy.com/'
    );
  });

  it('preserves query strings across the domain switch', () => {
    expect(
      getLeagueSwitchUrl('/theleague/standings?year=2024', 'afl', true)
    ).toBe('https://www.afl-fantasy.com/standings?year=2024');
  });
});

// Registry-driven switch targets for the nav header. With today's two-league
// registry each league has exactly one target (direct-link chevron); a third
// league flips the header to dropdown mode, and these generic assertions
// must keep holding for every league pair without edits.
describe('getLeagueSwitchTargets', () => {
  it('lists every league except the current one, for each league', () => {
    for (const current of ALL_LEAGUES) {
      const targets = getLeagueSwitchTargets(current.navSlug, `/${current.slug}/rosters`, false);
      expect(targets.map((t) => t.navSlug)).toEqual(
        ALL_LEAGUES.filter((l) => l.navSlug !== current.navSlug).map((l) => l.navSlug)
      );
      // Registry display names label the menu entries
      for (const t of targets) {
        const def = ALL_LEAGUES.find((l) => l.navSlug === t.navSlug)!;
        expect(t.name).toBe(def.name);
      }
    }
  });

  it('resolves every target to the other league (never a same-league URL)', () => {
    for (const current of ALL_LEAGUES) {
      // Apex-host mode: every target must be absolute to the target's own domain
      const targets = getLeagueSwitchTargets(current.navSlug, `/${current.slug}/rosters`, true);
      for (const t of targets) {
        const def = ALL_LEAGUES.find((l) => l.navSlug === t.navSlug)!;
        const expectedDomain = def.domains.find((d) => d.startsWith('www.')) ?? def.domains[0];
        expect(t.href.startsWith(`https://${expectedDomain}/`)).toBe(true);
        for (const currentDomain of current.domains) {
          expect(t.href).not.toContain(currentDomain);
        }
      }
    }
  });

  it('returns relative prefixed paths on the shared host', () => {
    for (const current of ALL_LEAGUES) {
      const targets = getLeagueSwitchTargets(current.navSlug, `/${current.slug}/rosters`, false);
      for (const t of targets) {
        const def = ALL_LEAGUES.find((l) => l.navSlug === t.navSlug)!;
        expect(t.href.startsWith(`/${def.slug}`)).toBe(true);
      }
    }
  });
});
