import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, LEAGUES } from '../src/config/leagues';
import type { LeagueDefinition } from '../src/config/leagues';
import {
  buildPackageHeroProfile,
  getLeagueHeroProfile,
  numberWord,
} from '../src/utils/league-hero/profiles';

describe('homepage hero profile for any registry league', () => {
  it('resolves for every league without throwing', () => {
    for (const league of ALL_LEAGUES) {
      const p = getLeagueHeroProfile(league.slug);
      expect(p.league, league.slug).toBe(league.slug);
    }
  });

  it("builds Archie's from its registry entry and config", () => {
    const p = getLeagueHeroProfile('archies');
    expect(p.copy.columnName).toBe('The Gauntlet');
    expect(p.copy.everyPool).toBe('all nine divisions');
    expect(p.copy.default.summary).toBe("Ninety-nine teams, nine divisions, one champion. Welcome to Archie's.");
  });

  it('builds a working profile for a league it has never seen', () => {
    // A brand-new league: no profile of its own, no config file in the repo.
    const def = {
      ...LEAGUES.archies,
      slug: 'smith-league',
      navSlug: 'smith',
      name: 'Smith League',
      shortName: undefined,
      configPath: 'data/smith-league/smith.config.json',
      features: { ...LEAGUES.archies.features, schefterFeed: false, powerRankings: false },
    } as unknown as LeagueDefinition;
    const p = buildPackageHeroProfile(def);
    expect(p.copy.shortName).toBe('Smith League');
    expect(p.copy.columnName).toBe('The Column');
    expect(p.copy.everyPool).toBe('the league');
    expect(p.capabilities).toMatchObject({ columnSlot: false, peckingOrderSlot: false });
    expect(p.eventIdPrefix).toBe('smith');
    expect(JSON.stringify(p.copy)).not.toMatch(/Archie|nine|Gauntlet/);
    const view = p.defaultView(new Date('2026-10-04T18:00:00Z'));
    expect(view.pill).toBe('SMITH LEAGUE');
    expect(view.summary).toBe('One champion. Welcome to Smith League.');
    // The accent word finishes the headline ("NINE DIVISIONS. ONE CHAMP."); a bare
    // "ONE." read as an unfinished sentence.
    expect(view.accentWord).toBe('ONE CHAMP.');
  });

  it('spells numbers the way the copy needs', () => {
    expect(numberWord(9)).toBe('nine');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(40)).toBe('forty');
    expect(numberWord(99)).toBe('ninety-nine');
    expect(numberWord(120)).toBe('120');
  });
});
