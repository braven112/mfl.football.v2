import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leagueHasFeature } from '../src/config/leagues';
import { DEFAULT_VIEWER_PREFERENCES } from '../src/utils/viewer-preferences';
import { countryOptions } from '../src/utils/broadcast-channels';

/**
 * The nav drawer's account menu — the viewer's own settings, under their team
 * name.
 *
 * Four things about it are load-bearing rather than stylistic:
 *
 * 1. **The clock is read from the COOKIE, never resolved.** `/preferences`
 *    calls `resolveViewerPreferences`, which WRITES cookies (illegal from a
 *    component — the headers are already committed, see
 *    `docs/claude/rules/viewer-preferences.md`) and reads Redis when the device
 *    has no cookie. The nav renders on EVERY page, so that would be a blanked
 *    page at worst and a Redis round-trip per page view at best. The cookies
 *    are written only by an explicit choice, so their presence carries the same
 *    signal and their absence is the honest "still on the league's clock".
 *
 * 2. **Both link rows are registry-gated.** Best Ball publishes neither
 *    `/preferences` nor `/notifications`; an ungated row 404s a third of the
 *    leagues.
 *
 * 3. **The disclosure re-initializes on `astro:page-load`.** The ClientRouter
 *    swaps the footer on every in-site navigation; a `DOMContentLoaded`-only
 *    binding leaves the chevron inert after the first page.
 *
 * 4. **The row's two halves sit on DIFFERENT floors, and that is deliberate.**
 *    The FLAG always renders: the country has a real default
 *    (`DEFAULT_VIEWER_PREFERENCES` is US) that Sunday Ticket and every network
 *    badge already resolve on, so showing it reports what the site is doing
 *    rather than guessing. The CLOCK does not follow — every league surface
 *    prints PT alone until the viewer names a zone, so with no cookie the row
 *    must still read "League time (PT)". Collapsing the two into one default
 *    would put an Eastern clock on the menu for every viewer who never opened
 *    the picker.
 */

const REPO_ROOT = process.cwd();
const NAV_FOOTER = path.join(REPO_ROOT, 'src/components/nav/NavFooter.astro');
const source = readFileSync(NAV_FOOTER, 'utf8');

describe('Nav account menu', () => {
  it('reads the viewer clock from the cookie, never through the route-only resolver', () => {
    expect(
      source.includes('viewer-preferences-page'),
      'NavFooter must not import viewer-preferences-page — it writes cookies (ResponseSentError from a component) and reads Redis per render'
    ).toBe(false);
    expect(source).toMatch(/Astro\.cookies\.get\(COUNTRY_COOKIE\)/);
    expect(source).toMatch(/Astro\.cookies\.get\(ZONE_COOKIE\)/);
    expect(
      /resolveViewerPreferences\s*\(/.test(source),
      'Resolving preferences is route-only; the nav renders on every page'
    ).toBe(false);
  });

  it('always flies a country flag on the Preferences row, defaulting to the catalog country', () => {
    // The AFL drawer showed no flag at all for anyone who had never opened
    // /preferences on afl-fantasy.com — cookies are per apex domain, so a
    // country picked on theleague.us never reaches it. The country has a
    // default; the row now shows it.
    expect(source).toMatch(/viewerPrefs\?\.country \?\? DEFAULT_VIEWER_PREFERENCES\.country/);
    expect(
      /const viewerCountry = viewerPrefs\s*\n?\s*\?/.test(source),
      'A viewerPrefs-conditional viewerCountry renders no flag until the viewer picks one'
    ).toBe(false);

    // The default country must actually have a flag to fly, or the row renders
    // an empty span and the fix is invisible.
    const fallback = countryOptions().find((c) => c.code === DEFAULT_VIEWER_PREFERENCES.country);
    expect(fallback, 'The default country must exist in the catalog').toBeTruthy();
    expect(fallback?.flag, 'The default country needs a flag emoji').toBeTruthy();
  });

  it('leaves the clock on the league floor when the viewer has chosen nothing', () => {
    // The flag defaults; the clock must not. `DEFAULT_ZONE_IDS` is US/ET, and
    // printing it here would name an Eastern clock nobody picked.
    expect(source).toMatch(
      /const clockValue = viewerPrefs \? zoneSummary\(viewerPrefs\) : `League time \(\$\{zoneShortName\(LEAGUE_CLOCK\)\}\)`/
    );
    expect(
      /DEFAULT_VIEWER_PREFERENCES\.zoneId|DEFAULT_ZONE_IDS/.test(source),
      'The nav must never fall back to a default ZONE — every league surface prints PT alone until the viewer names one'
    ).toBe(false);
  });

  it('gates the Preferences and Notifications rows on the registry, not on a league literal', () => {
    expect(source).toMatch(/leagueFeatures\.viewerPreferences/);
    expect(source).toMatch(/leagueFeatures\.pushNotifications/);

    // The flags themselves must keep matching which leagues publish the pages.
    expect(leagueHasFeature('theleague', 'viewerPreferences')).toBe(true);
    expect(leagueHasFeature('afl-fantasy', 'viewerPreferences')).toBe(true);
    expect(leagueHasFeature('best-ball-1', 'viewerPreferences')).toBe(false);
    expect(leagueHasFeature('theleague', 'pushNotifications')).toBe(true);
    expect(leagueHasFeature('afl-fantasy', 'pushNotifications')).toBe(true);
    expect(leagueHasFeature('best-ball-1', 'pushNotifications')).toBe(false);
  });

  it('offers the menu to every signed-in owner, so Sign out is never gated away', () => {
    // Gating the disclosure on the two link rows left a best-ball owner (both
    // flags off, not a commissioner) with no way to sign out — Sign out is the
    // one row every signed-in owner always has.
    expect(source).toMatch(/const showAccountMenu = isAuthenticated;/);
    expect(
      /showAccountMenu = isAuthenticated &&/.test(source),
      'The account menu is gated on being signed in ALONE — extra conditions hide Sign out'
    ).toBe(false);
  });

  it('resolves every internal link against the apex-domain prefix rule', () => {
    // vercel.json 301s `/theleague/:path*` to `/:path*` on theleague.us, so a
    // prefixed href costs every apex visitor a redirect hop.
    for (const link of ['rosters', 'login', 'preferences', 'notifications']) {
      const pattern = new RegExp(
        `resolveLeaguePath\\(\`\\$\\{leagueBase\\}/${link}\`, hideLeaguePrefix\\)`
      );
      expect(
        source,
        `The ${link} link must go through resolveLeaguePath, or it is prefixed on an apex host`
      ).toMatch(pattern);
    }
  });

  it('ships the panel closed, and opens it from the disclosure button', () => {
    expect(source).toMatch(/data-account-panel hidden/);
    expect(source).toMatch(/aria-expanded="false"/);
    expect(source).toMatch(/aria-controls="nav-account-panel"/);
  });

  it('re-initializes the disclosure and sign out after a ClientRouter navigation', () => {
    expect(source).toMatch(/document\.addEventListener\('astro:page-load', initAccountPanel\)/);
    expect(source).toMatch(/document\.addEventListener\('astro:page-load', initSignOut\)/);
    expect(
      /addEventListener\('DOMContentLoaded'/.test(source),
      'DOMContentLoaded-only init leaves the account menu inert after an in-site navigation'
    ).toBe(false);
  });

  it('keeps commissioner mode inside the menu instead of behind a bare chevron', () => {
    expect(source).toMatch(/data-commish-toggle/);
    expect(source).toMatch(/Commissioner mode/);
    // The chevron beside the team name is now the account disclosure, and it
    // is offered to every signed-in owner, not just commissioners.
    expect(source).toMatch(/data-account-toggle/);
  });
});
