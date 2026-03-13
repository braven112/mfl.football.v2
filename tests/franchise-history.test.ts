import { describe, it, expect } from 'vitest';
import {
  getOwnerHistoryFranchiseIdForYear,
  getTeamIdentityForYear,
  resolveConfigForYear,
  resolvePreferredTeamIdForYear,
  HISTORICAL_TEAM_BANNER_FALLBACK,
  HISTORICAL_TEAM_ICON_FALLBACK,
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
      name: 'Las Vegas Elite',
      abbrev: 'LVE',
      icon: 'http://theleague.us/images/team_banners/las_vegas_icon.png',
      banner: 'http://theleague.us/images/team_banners/las_vegas.png',
      yearStart: 2012,
      yearEnd: 2017,
    },
    {
      name: 'The Art of War',
      abbrev: 'ART',
      icon: 'http://theleague.us/images/team_banners/art_of_war_icon.png',
      banner: 'http://theleague.us/images/team_banners/art_of_war.png',
      yearStart: 2018,
      yearEnd: 2018,
    },
    {
      name: 'Drunk Indians',
      abbrev: 'DI',
      icon: 'http://theleague.us/images/team_banners/drunk_Indians_icon.png',
      banner: 'http://theleague.us/images/team_banners/drunk_Indians.png',
      yearStart: 2019,
      yearEnd: 2019,
    },
    {
      name: 'Heavy Chevy',
      nameMedium: 'Heavy Chevy',
      nameShort: 'Heavy',
      abbrev: 'CHEVY',
      aliases: ['Heavy', 'Chevy'],
      icon: '/assets/theleague/icons/heavy_chevy.png',
      banner: '/assets/theleague/banners/heavy_chevy.png',
      groupMe: '/assets/theleague/group-me/heavy_chevy.png',
      yearStart: 2020,
      yearEnd: 2024,
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

const teamWithOwnerHistory: TeamConfig = {
  franchiseId: '0011',
  name: 'Midwestside Connection',
  nameMedium: 'Midwestside',
  nameShort: 'Midwest',
  abbrev: 'MWS',
  division: 'Southwest',
  icon: '/assets/theleague/icons/midwestside.png',
  banner: '/assets/theleague/banners/midwestside.png',
  ownerHistory: [
    {
      franchiseId: '0010',
      yearStart: 2012,
      yearEnd: 2015,
    },
    {
      franchiseId: '0011',
      yearStart: 2019,
      yearEnd: 9999,
    },
  ],
};

describe('getTeamIdentityForYear', () => {
  it('returns historical identity for years within a later history range', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2024);
    expect(identity.name).toBe('Heavy Chevy');
    expect(identity.nameMedium).toBe('Heavy Chevy');
    expect(identity.nameShort).toBe('Heavy');
    expect(identity.abbrev).toBe('CHEVY');
    expect(identity.icon).toBe('/assets/theleague/icons/heavy_chevy.png');
    expect(identity.banner).toBe('/assets/theleague/banners/heavy_chevy.png');
    expect(identity.isHistorical).toBe(true);
  });

  it('returns historical identity for earlier seasons and upgrades http assets', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2014);
    expect(identity.name).toBe('Las Vegas Elite');
    expect(identity.abbrev).toBe('LVE');
    expect(identity.icon).toBe('https://theleague.us/images/team_banners/las_vegas_icon.png');
    expect(identity.banner).toBe('https://theleague.us/images/team_banners/las_vegas.png');
    expect(identity.isHistorical).toBe(true);
  });

  it('supports multiple historical eras for one franchise', () => {
    const identity = getTeamIdentityForYear(teamWithHistory, 2018);
    expect(identity.name).toBe('The Art of War');
    expect(identity.abbrev).toBe('ART');
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

  it('falls back to historical placeholder assets when a history entry omits them', () => {
    const team: TeamConfig = {
      ...teamWithoutHistory,
      history: [
        {
          name: 'Old Pigskins',
          yearStart: 2012,
          yearEnd: 2012,
        },
      ],
    };
    const identity = getTeamIdentityForYear(team, 2012);
    expect(identity.icon).toBe(HISTORICAL_TEAM_ICON_FALLBACK);
    expect(identity.banner).toBe(HISTORICAL_TEAM_BANNER_FALLBACK);
  });

  it('returns current identity for teams with no history', () => {
    const identity = getTeamIdentityForYear(teamWithoutHistory, 2020);
    expect(identity.name).toBe('Pacific Pigskins');
    expect(identity.nameMedium).toBe('Pigskins');
    expect(identity.icon).toBe('/assets/theleague/icons/pigskins.png');
    expect(identity.isHistorical).toBe(false);
  });
});

describe('getOwnerHistoryFranchiseIdForYear', () => {
  it('maps a returning owner to the original franchise for earlier seasons', () => {
    expect(getOwnerHistoryFranchiseIdForYear(teamWithOwnerHistory, 2014)).toBe('0010');
  });

  it('returns the current franchise after the owner comes back', () => {
    expect(getOwnerHistoryFranchiseIdForYear(teamWithOwnerHistory, 2026)).toBe('0011');
  });

  it('returns null for seasons where the current owner had no team in the league', () => {
    expect(getOwnerHistoryFranchiseIdForYear(teamWithOwnerHistory, 2017)).toBeNull();
  });

  it('defaults to the current franchise when no owner history is configured', () => {
    expect(getOwnerHistoryFranchiseIdForYear(teamWithoutHistory, 2014)).toBe('0001');
  });
});

describe('resolvePreferredTeamIdForYear', () => {
  const mockConfig = {
    leagueId: '13522',
    teams: [teamWithHistory, teamWithOwnerHistory, teamWithoutHistory],
  };

  it('translates current-team preference through owner lineage for historical views', () => {
    expect(resolvePreferredTeamIdForYear(mockConfig, '0011', 2014)).toBe('0010');
  });

  it('returns undefined when a returning owner had no active team that year', () => {
    expect(resolvePreferredTeamIdForYear(mockConfig, '0011', 2017)).toBeUndefined();
  });

  it('leaves ordinary team preferences untouched', () => {
    expect(resolvePreferredTeamIdForYear(mockConfig, '0004', 2014)).toBe('0004');
  });
});

describe('resolveConfigForYear', () => {
  const mockConfig = {
    leagueId: '13522',
    teams: [teamWithHistory, teamWithoutHistory],
  };

  it('resolves historical names for all teams in a config', () => {
    const resolved = resolveConfigForYear(mockConfig, 2024);
    const team0004 = resolved.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Heavy Chevy');
    expect(team0004?.icon).toBe('/assets/theleague/icons/heavy_chevy.png');
    expect(team0004?.banner).toBe('/assets/theleague/banners/heavy_chevy.png');
  });

  it('resolves earlier historical eras too', () => {
    const resolved = resolveConfigForYear(mockConfig, 2018);
    const team0004 = resolved.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('The Art of War');
    expect(team0004?.abbrev).toBe('ART');
  });

  it('resolves current names for the current year', () => {
    const resolved = resolveConfigForYear(mockConfig, 2026);
    const team0004 = resolved.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Dead Cap Walking');
    expect(team0004?.icon).toBe('/assets/theleague/icons/dead_cap_walking.png');
  });

  it('does not modify teams without history', () => {
    const resolved = resolveConfigForYear(mockConfig, 2024);
    const team0001 = resolved.teams.find(t => t.franchiseId === '0001');
    expect(team0001?.name).toBe('Pacific Pigskins');
    expect(team0001?.icon).toBe('/assets/theleague/icons/pigskins.png');
  });

  it('preserves non-team config properties', () => {
    const resolved = resolveConfigForYear(mockConfig, 2024);
    expect(resolved.leagueId).toBe('13522');
  });

  it('does not mutate the original config', () => {
    resolveConfigForYear(mockConfig, 2024);
    const team0004 = mockConfig.teams.find(t => t.franchiseId === '0004');
    expect(team0004?.name).toBe('Dead Cap Walking');
  });
});
