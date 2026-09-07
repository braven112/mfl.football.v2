import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, leagueClock } from '../src/config/leagues';
import { LEAGUE_CLOCK, zoneOptionsFor, isLeagueClock, COUNTRY_CODES } from '../src/utils/viewer-preferences';

/**
 * A league's OFFICIAL CLOCK is a registry setting, not a constant.
 *
 * It was `LEAGUE_CLOCK` — a hardcoded Pacific in `viewer-preferences.ts` —
 * until Sep 2026, which meant "the league keeps its time in Pacific" was a
 * fact compiled into the time code rather than something a league declares.
 * Both leagues are still PT; the point is that changing one is now an edit to
 * `officialClock` in the registry and nothing else.
 *
 * Three things have to hold for that to be true, and each is a way the setting
 * quietly stops being one:
 *
 * 1. **Every league declares it.** A missing entry falls back to the default
 *    league's clock, which is a silent wrong answer rather than a build error.
 * 2. **`viewer-preferences.ts` must NOT import the registry.** It is in
 *    Storybook's rendering graph — every Sunday Ticket snapshot would wake on
 *    any registry edit. The clock travels IN as a value, which is the whole
 *    reason `LeagueClock` is declared in both places instead of imported one
 *    way. This test is what keeps the two shapes honest.
 * 3. **`equivalents` is an IDENTITY list.** Zones that keep the same wall
 *    clock as the league's all year, DST included — never a snapshot of
 *    today's offsets, which is right for half the year and wrong for the other.
 */

const REPO_ROOT = process.cwd();

describe('league official clock', () => {
  it('is declared by every league in the registry', () => {
    expect(ALL_LEAGUES.length).toBeGreaterThan(0);
    for (const league of ALL_LEAGUES) {
      const clock = league.officialClock;
      expect(clock, `${league.slug} must declare officialClock`).toBeTruthy();
      expect(clock.id, `${league.slug}.officialClock.id`).toBeTruthy();
      expect(clock.label, `${league.slug}.officialClock.label`).toBeTruthy();
      expect(clock.name, `${league.slug}.officialClock.name`).toBeTruthy();
      expect(clock.zone, `${league.slug}.officialClock.zone must be IANA`).toMatch(
        /^[A-Za-z_]+\/[A-Za-z_+-]+$/
      );
    }
  });

  it('resolves through leagueClock(slug), and falls back rather than throwing', () => {
    for (const league of ALL_LEAGUES) {
      expect(leagueClock(league.slug)).toEqual(league.officialClock);
    }
    // A caller that cannot name its league gets the site's own clock, not a
    // crash and not an invented zone.
    expect(leagueClock(null).zone).toBeTruthy();
    expect(leagueClock('not-a-league').zone).toBeTruthy();
  });

  it('names a zone the preferences catalog can actually offer', () => {
    // The picker tags an option "league clock" via `isLeagueClock`. A league
    // clock no country's catalog contains would render that tag nowhere, and
    // the viewer would have no way to select the league's own time.
    for (const league of ALL_LEAGUES) {
      const offered = COUNTRY_CODES.some((code) =>
        zoneOptionsFor(code).some((z) => isLeagueClock(z, league.officialClock))
      );
      expect(offered, `${league.slug}'s clock is in no country's catalog`).toBe(true);
    }
  });

  it('treats equivalents as an identity list, never including the clock itself', () => {
    for (const league of ALL_LEAGUES) {
      const { zone, equivalents = [] } = league.officialClock;
      expect(equivalents, `${league.slug}.equivalents must not repeat its own zone`).not.toContain(zone);
      expect(new Set(equivalents).size, `${league.slug}.equivalents has duplicates`).toBe(
        equivalents.length
      );
      for (const eq of equivalents) {
        expect(eq, `${league.slug} equivalent "${eq}" must be IANA`).toMatch(
          /^[A-Za-z_]+\/[A-Za-z_+-]+$/
        );
        expect(isLeagueClock({ zone: eq }, league.officialClock)).toBe(true);
      }
    }
  });

  it('keeps the registry OUT of viewer-preferences.ts', () => {
    // The dependency must run one way only. `viewer-preferences.ts` is
    // reachable from a Storybook story, so importing the registry here would
    // put every league edit into Chromatic's rendering graph — see
    // docs/claude/rules/viewer-preferences.md.
    const source = readFileSync(path.join(REPO_ROOT, 'src/utils/viewer-preferences.ts'), 'utf8');
    expect(
      /from '\.\.\/config\/leagues/.test(source),
      'viewer-preferences.ts must not import the league registry — the clock is passed in'
    ).toBe(false);
  });

  it('still ships a fallback clock for a caller with no league', () => {
    // Not the setting — the answer for a caller that cannot name a league.
    // It exists so `eventZonesFor` and friends stay total.
    expect(LEAGUE_CLOCK.zone).toBeTruthy();
    expect(isLeagueClock({ zone: LEAGUE_CLOCK.zone })).toBe(true);
  });
});
