import { describe, it, expect } from 'vitest';
import {
  getTeamIdentityForYear,
  resolveConfigForYear,
  type TeamConfig,
} from '../src/utils/team-names';

const teamWithHistory: TeamConfig = {
  franchiseId: '0004',
  name: 'Dead Cap Walking',
  nameMedium: 'Dead Cap',
  nameShort: 'Dead Cap',
  abbrev: 'DEAD',
  aliases: ['DCW'],
  division: 'Southwest',
  icon: '/assets/theleague/icons/dead_cap_walking.png',
  banner: '/assets/theleague/banners/dead_cap_walking.png',
  groupMe: '/assets/theleague/group-me/dead_cap_walking.png',
  history: [
    {
      name: 'Heavy Chevy',
      nameMedium: 'Heavy Chevy',
      nameShort: 'Heavy',
      abbrev: 'CHEVY',
      aliases: ['Heavy', 'Chevy'],
      icon: '/assets/theleague/icons/heavy_chevy.png',
      banner: '/assets/theleague/banners/heavy_chevy.png',
      groupMe: '/assets/theleague/group-me/heavy_chevy.png',
      yearStart: 2007,
      yearEnd: 2025,
    },
  ],
};

const teamWithoutHistory: TeamConfig = {
  franchiseId: '0001',
  name: 'Pacific Pigskins',
  nameMedium: 'Pigskins',
  nameShort: 'Pigskins',
  abbrev: 'SKINS',
  aliases: ['Pigskins', 'Skins', 'Pigs'],
  division: 'Northwest',
  icon: '/assets/theleague/icons/pigskins.png',
  banner: '/assets/theleague/banners/pigskins.png',
};

describe('getTeamIdentityForYear', () => {
  it('returns historical identity for years within a history entry range', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2025);
    expect(identity.name).toBe('Heavy Chevy');
    expect(identity.nameMedium).toBe('Heavy Chevy');
    expect(identity.nameShort).toBe('Heavy');
    expect(identity.abbrev).toBe('CHEVY');
    expect(identity.icon).toBe('/assets/theleague/icons/heavy_chevy.png');
    expect(identity.banner).toBe('/assets/theleague/banners/heavy_chevy.png');
    expect(identity.isHistorical).toBe(true);
  });

  it('returns historical identity for the first year of a history entry', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2007);
    expect(identity.name).toBe('Heavy Chevy');
    expect(identity.isHistorical).toBe(true);
  });

  it('returns historical identity for a mid-range year', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2020);
    expect(identity.name).toBe('Heavy Chevy');
    expect(identity.isHistorical).toBe(true);
  });

  it('returns current identity for years after all history entries', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2026);
    expect(identity.name).toBe('Dead Cap Walking');
    expect(identity.nameMedium).toBe('Dead Cap');
    expect(identity.nameShort).toBe('Dead Cap');
    expect(identity.abbrev).toBe('DEAD');
    expect(identity.icon).toBe('/assets/theleague/icons/dead_cap_walking.png');
    expect(identity.banner).toBe('/assets/theleague/banners/dead_cap_walking.png');
    expect(identity.isHistorical).toBe(false);
  });

  it('returns current identity for years before all history entries', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2006);
    expect(identity.name).toBe('Dead Cap Walking');
    expect(identity.isHistorical).toBe(false);
  });

  it('returns current identity for teams with no history', () => {
    const identity = getTeamIdentityForYear(teamWithoutHistory, 2020);
    expect(identity.name).toBe('Pacific Pigskins');
    expect(identity.nameMedium).toBe('Pigskins');
    expect(identity.icon).toBe('/assets/theleague/icons/pigskins.png');
    expect(identity.isHistorical).toBe(false);
  });

  it('returns current identity for teams with empty history array', () => {
    const team: TeamConfig = { ...teamWithoutHistory, history: [] };
    const identity = getTeamIdentityForYear(team, 2020);
    expect(identity.name).toBe('Pacific Pigskins');
    expect(identity.isHistorical).toBe(false);
  });

  it('preserves aliases from historical entries', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2024);
    expect(identity.aliases).toEqual(['Heavy', 'Chevy']);
  });

  it('preserves aliases from current identity', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2026);
    expect(identity.aliases).toEqual(['DCW']);
  });
});

describe('resolveConfigForYear', () => {
  const mockConfig = {
    leagueId: '13522',
    teams: [teamWithHistory, teamWithoutHistory],
  };

  it('resolves historical names for all teams in a config', () => {
    const resolved = resolveConfigForYear(mockConfig, 2025);
    const team0004 = resolved.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Heavy Chevy');
    expect(team0004?.icon).toBe('/assets/theleague/icons/heavy_chevy.png');
    expect(team0004?.banner).toBe('/assets/theleague/banners/heavy_chevy.png');
  });

  it('resolves current names for the current year', () => {
    const resolved = resolveConfigForYear(mockConfig, 2026);
    const team0004 = resolved.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Dead Cap Walking');
    expect(team0004?.icon).toBe('/assets/theleague/icons/dead_cap_walking.png');
  });

  it('does not modify teams without history', () => {
    const resolved = resolveConfigForYear(mockConfig, 2025);
    const team0001 = resolved.teams.find(t => t.franchiseId === '0001');
    expect(team0001?.name).toBe('Pacific Pigskins');
    expect(team0001?.icon).toBe('/assets/theleague/icons/pigskins.png');
  });

  it('preserves non-team config properties', () => {
    const resolved = resolveConfigForYear(mockConfig, 2025);
    expect(resolved.leagueId).toBe('13522');
  });

  it('does not mutate the original config', () => {
    resolveConfigForYear(mockConfig, 2025);
    const team0004 = mockConfig.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Dead Cap Walking');
  });
});
