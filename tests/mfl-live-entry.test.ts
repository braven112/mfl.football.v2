/**
 * MFL Live's branded front door and its menu, as Archie's members meet them.
 *
 *  - `/live?from=<slug>` brands the signed-out sign-in for a league whose
 *    owners may sign in to MFL Live, and for nobody else: the slug is looked up
 *    in the registry, so a crafted link cannot name a league we do not run,
 *    and a best-ball league (refused by the sign-in) is never invited.
 *  - The menu's "League sites" names only the session's own league, so an
 *    Archie's owner is never shown The League's or the AFL's site.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveMflLiveEntryLeague } from '../src/utils/mfl-live-entry';
import { ALL_LEAGUES, mflLiveSignInLeagueIds } from '../src/config/leagues';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('resolveMflLiveEntryLeague', () => {
  it("brands Archie's", () => {
    expect(resolveMflLiveEntryLeague('archies')?.slug).toBe('archies');
    expect(resolveMflLiveEntryLeague(' Archies ')?.slug).toBe('archies');
  });

  it('accepts exactly the leagues MFL Live signs in', () => {
    for (const league of ALL_LEAGUES) {
      const listed = mflLiveSignInLeagueIds().includes(league.id);
      expect(resolveMflLiveEntryLeague(league.slug)?.id ?? null).toBe(listed ? league.id : null);
    }
  });

  it('ignores anything that is not a registry slug', () => {
    for (const bad of [null, undefined, '', 'nope', '10105', '/archies', 'https://evil.example']) {
      expect(resolveMflLiveEntryLeague(bad)).toBeNull();
    }
  });
});

describe('/live wiring', () => {
  it('shows the branded sign-in only to a signed-out visitor', () => {
    const page = read('src/pages/live/index.astro');
    expect(page).toMatch(/const entryLeague = authUser\s*\?\s*null/);
    expect(page).toContain('<MflLiveLeagueSignIn');
  });

  it('lists only the session league under "League sites"', () => {
    const layout = read('src/layouts/MflAppLayout.astro');
    expect(layout).toContain('getLeagueById(authUser.leagueId)');
    // The old every-league list must not come back.
    expect(layout).not.toMatch(/ALL_LEAGUES\.filter/);
  });

  it('never records the MFL Live install against a league site', () => {
    const page = read('src/pages/live/index.astro');
    expect(page).toMatch(/<InstallAppPrompt[\s\S]*?report=\{false\}/);
  });
});
