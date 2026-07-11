import { describe, it, expect } from 'vitest';
import leagueConfig from '../src/data/theleague.config.json';
import { getEligibleThrowbackEras, resolveThrowbackIdentity } from '../src/utils/throwback-identity';
import type { TeamConfig } from '../src/utils/team-names';

const teams = leagueConfig.teams as unknown as TeamConfig[];
const findTeam = (franchiseId: string) => {
  const t = teams.find((t) => t.franchiseId === franchiseId);
  if (!t) throw new Error(`fixture team ${franchiseId} not found`);
  return t;
};

describe('throwback-identity', () => {
  it('resolves Pacific Pigskins to its default era (2013 middle look)', () => {
    const identity = resolveThrowbackIdentity(findTeam('0001'));
    expect(identity.isHistorical).toBe(true);
    expect(identity.name).toBe('Pacific Pigskins');
    expect(identity.icon).toBe('/assets/theleague/history/pigskins_2013_icon_circle.png');
  });

  it('Pigskins has both its 2007 black and 2013 middle eras eligible', () => {
    const eligible = getEligibleThrowbackEras(findTeam('0001'));
    expect(eligible.map((e) => e.yearStart)).toEqual([2007, 2013]);
  });

  it('excludes Da Dangsters\' 2007 "Sabertooths" — the identity is exclusive to Gridiron Geeks', () => {
    const eligible = getEligibleThrowbackEras(findTeam('0002'));
    // Only one franchise gets to be the Sabertooths on the scoreboard (the
    // Geeks, whose seeded default it is). The Dangsters keep their other
    // recovered eras.
    expect(eligible.map((e) => e.name)).toEqual(['Degenerates', 'Da Dangsters']);
  });

  it('keeps the Sabertooths entry eligible for Gridiron Geeks', () => {
    const eligible = getEligibleThrowbackEras(findTeam('0013'));
    expect(eligible.some((e) => e.name === 'Sabertooths' && e.yearStart === 2009)).toBe(true);
  });

  it('includes Computer Jocks\' 2011 "Midwestside Connection" entry now that it has distinct art', () => {
    const eligible = getEligibleThrowbackEras(findTeam('0010'));
    expect(eligible.some((e) => e.yearStart === 2011)).toBe(true);
    expect(eligible.map((e) => e.name)).toEqual([
      'Witch City Warlocks',
      'Midwestside Connection',
    ]);
  });

  it('a team with only one history entry still resolves to it', () => {
    const identity = resolveThrowbackIdentity(findTeam('0007')); // Fire Ready Aim -> Acer FC Edge
    expect(identity.isHistorical).toBe(true);
    expect(identity.name).toBe('Acer FC Edge');
    expect(identity.icon).toBe('/assets/theleague/history/acer_fc_edge_icon_circle.png');
  });

  it('Bring The Pain has both its skull (2007) and red-graffiti (2023) eras eligible', () => {
    const eligible = getEligibleThrowbackEras(findTeam('0008'));
    expect(eligible.map((e) => e.yearStart)).toEqual([2007, 2023]);
    // Default is the most recent old look (2023 red-graffiti).
    const identity = resolveThrowbackIdentity(findTeam('0008'));
    expect(identity.icon).toBe('/assets/theleague/history/bring_the_pain_2023_icon_circle.png');
  });

  it('owner override takes precedence over the commissioner default', () => {
    const team = findTeam('0004'); // Dead Cap Walking — 4 eligible eras, default is 2007
    const eligible = getEligibleThrowbackEras(team);
    const nonDefault = eligible.find((e) => e.yearStart !== 2007);
    expect(nonDefault).toBeTruthy();

    const withOverride = resolveThrowbackIdentity(team, nonDefault!.yearStart);
    expect(withOverride.name).toBe(nonDefault!.name);

    const withoutOverride = resolveThrowbackIdentity(team);
    expect(withoutOverride.name).not.toBe(nonDefault!.name);
  });

  it('an invalid owner override falls through to the default instead of erroring', () => {
    const team = findTeam('0001');
    const identity = resolveThrowbackIdentity(team, 1999); // no such era
    expect(identity.name).toBe('Pacific Pigskins');
  });

  it('falls back to current identity when a team has no eligible eras', () => {
    const fauxTeam: TeamConfig = {
      franchiseId: '9999',
      name: 'No History FC',
      icon: '/assets/theleague/icons/placeholder.png',
      banner: '/assets/theleague/banners/placeholder.png',
    };
    const identity = resolveThrowbackIdentity(fauxTeam);
    expect(identity.isHistorical).toBe(false);
    expect(identity.name).toBe('No History FC');
  });

  it('missing banner art falls back to the placeholder, not a broken icon path', () => {
    const music = resolveThrowbackIdentity(findTeam('0006'), 2007); // LBer-DeCleaters
    expect(music.banner).toBe('/assets/theleague/history/historical-team-banner-placeholder.svg');

    const cboy = resolveThrowbackIdentity(findTeam('0014'), 2007); // Devil Dogs
    expect(cboy.banner).toBe('/assets/theleague/history/historical-team-banner-placeholder.svg');
  });
});
