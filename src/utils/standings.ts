/**
 * Standings Utilities
 * Handles tiebreakers, playoff seeding, and standings sorting
 */

import type { StandingsFranchise, TeamStanding, DivisionStandings, PlayoffSeeding } from '../types/standings';
// Single source of truth for the all-play accumulation, shared with the node
// tier-movement scripts (scripts/lib/afl-tier-standings.mjs). See all-play.mjs.
import { accumulateAllPlay } from './all-play.mjs';

// Weekly results type for calculating all-play from weekly data
export type WeeklyResult = {
  week: number;
  scores: Record<string, number>;
};

export type WeeklyResultsData = {
  weeks: WeeklyResult[];
};

// Calculated all-play record. `pf` (total points scored across counted weeks)
// is the constitution tiebreak for promotion/relegation; the page ignores it.
export type AllPlayRecord = {
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pct: number;
};

/**
 * Calculate all-play records from weekly results up to a cutoff week.
 * Thin typed wrapper over the shared accumulator in all-play.mjs so the live
 * standings page and the node tier-movement scripts use ONE implementation.
 * All-play: each team gets wins/losses against all other teams each week based on score.
 */
export function calculateAllPlayFromWeekly(
  weeklyResults: WeeklyResultsData,
  cutoffWeek: number
): Map<string, AllPlayRecord> {
  return accumulateAllPlay(weeklyResults, cutoffWeek) as Map<string, AllPlayRecord>;
}

// League config type (can come from either league)
type LeagueConfig = {
  leagueId?: string;
  name?: string;
  domain?: string;
  draftRounds?: number;
  keepers?: number;
  structure?: string;
  teams: Array<{
    franchiseId: string;
    name: string;
    abbrev?: string;
    aliases?: string[];
    conference?: string;
    division: string;
    tier?: string;
    icon?: string;
    banner?: string;
  }>;
  divisions?: string[];
  conferences?: Array<{
    name: string;
    code: string;
    divisions: string[];
    divisionNames?: Record<string, string>;
  }>;
  divisionToConference?: Record<string, string>;
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    cssBundle?: string;
    jsBundle?: string;
  };
  features?: Record<string, boolean>;
  allowedLeagues?: string[];
  assetDomain?: string;
  [key: string]: any; // Allow additional properties
};

// Parse W-L-T string to get wins and losses. Defensive against the missing /
// malformed records in pre-2004 MFL feeds — a blank record parses as 0-0-0.
function parseWLT(wlt: string | undefined): { wins: number; losses: number; ties: number } {
  const [wins = 0, losses = 0, ties = 0] = (wlt ?? '').split('-').map(Number);
  return {
    wins: Number.isNaN(wins) ? 0 : wins,
    losses: Number.isNaN(losses) ? 0 : losses,
    ties: Number.isNaN(ties) ? 0 : ties,
  };
}

// Get team config info
function getTeamConfig(franchiseId: string, config: LeagueConfig) {
  return config.teams.find(t => t.franchiseId === franchiseId);
}

// Compare two teams using a specific tiebreaker metric
function compareBySingleMetric(a: TeamStanding, b: TeamStanding, metric: string): number {
  const getValue = (team: TeamStanding, metric: string): number => {
    switch (metric) {
      case 'h2h':
        return parseFloat(team['h2hpct' as keyof TeamStanding] as any);
      case 'divpct':
        return parseFloat(team.divpct);
      case 'all_play':
        return parseFloat(team.all_play_pct);
      case 'pf':
        return parseFloat(team.pf);
      case 'pwr':
        return parseFloat(team.pwr);
      case 'vp':
        return parseFloat(team.vp);
      case 'pa':
        return parseFloat(team.pa);
      default:
        return 0;
    }
  };

  const aVal = getValue(a, metric);
  const bVal = getValue(b, metric);

  // Lower PA is better, so negate for comparison
  if (metric === 'pa') return aVal - bVal;
  return bVal - aVal; // Descending order
}

// Division tiebreaker sequence per rulebook
function divisionTiebreaker(teams: TeamStanding[]): TeamStanding[] {
  if (teams.length <= 1) return teams;

  const sorted = [...teams];

  // Sort by overall record first (h2h - wins, then losses)
  sorted.sort((a, b) => {
    // First tiebreaker: overall record (h2h)
    const aOverall = parseWLT(a.h2hwlt);
    const bOverall = parseWLT(b.h2hwlt);

    if (aOverall.wins !== bOverall.wins) return bOverall.wins - aOverall.wins;
    if (aOverall.losses !== bOverall.losses) return aOverall.losses - bOverall.losses;

    // Second tiebreaker: division record (divwlt)
    const aDiv = parseWLT(a.divwlt);
    const bDiv = parseWLT(b.divwlt);

    if (aDiv.wins !== bDiv.wins) return bDiv.wins - aDiv.wins;
    if (aDiv.losses !== bDiv.losses) return aDiv.losses - bDiv.losses;

    // Remaining tiebreaker sequence: all_play, pf, pwr, vp, pa
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);
    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    const aPF = parseFloat(a.pf);
    const bPF = parseFloat(b.pf);
    if (aPF !== bPF) return bPF - aPF;

    const aPWR = parseFloat(a.pwr);
    const bPWR = parseFloat(b.pwr);
    if (aPWR !== bPWR) return bPWR - aPWR;

    const aVP = parseFloat(a.vp);
    const bVP = parseFloat(b.vp);
    if (aVP !== bVP) return bVP - aVP;

    const aPA = parseFloat(a.pa);
    const bPA = parseFloat(b.pa);
    return aPA - bPA; // Lower PA is better
  });

  return sorted;
}

// Wild card tiebreaker sequence per rulebook
function wildCardTiebreaker(teams: TeamStanding[]): TeamStanding[] {
  if (teams.length <= 1) return teams;

  const sorted = [...teams];

  sorted.sort((a, b) => {
    // First compare by all-play record
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);

    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    // Tiebreaker sequence: all_play, pf, pwr, vp, pa
    const tiebreakers = ['pf', 'pwr', 'vp', 'pa'];

    for (const tiebreaker of tiebreakers) {
      let result = 0;

      if (tiebreaker === 'pf') {
        result = parseFloat(b.pf) - parseFloat(a.pf);
      } else if (tiebreaker === 'pwr') {
        result = parseFloat(b.pwr) - parseFloat(a.pwr);
      } else if (tiebreaker === 'vp') {
        result = parseFloat(b.vp) - parseFloat(a.vp);
      } else if (tiebreaker === 'pa') {
        result = parseFloat(a.pa) - parseFloat(b.pa); // Lower PA is better
      }

      if (result !== 0) return result;
    }

    return 0; // Coin flip
  });

  return sorted;
}

// Combine separate W/L/T fields into a "W-L-T" string when the combined field
// is absent (pre-2004 MFL feeds ship only the separate fields).
function normalizeWLT(combined: unknown, w: unknown, l: unknown, t: unknown): string {
  if (combined) return String(combined);
  if (w !== undefined && l !== undefined) {
    return `${w || '0'}-${l || '0'}-${t || '0'}`;
  }
  return '0-0-0';
}

// Enrich franchise data with team config info
export function enrichTeamStanding(franchise: StandingsFranchise, config: LeagueConfig): TeamStanding {
  const teamConfig = getTeamConfig(franchise.id, config);
  const raw = franchise as Record<string, any>;

  // Normalize the fields the tiebreaker comparators read. Older MFL feeds ship
  // separate W/L/T fields instead of the combined strings (2003) and omit
  // several metrics entirely (all_play/vp until ~2017, pa/pf in some years).
  // A missing metric becomes '0' — every team ties on it and the comparison
  // falls through to the next tiebreaker instead of producing NaN sorts.
  return {
    ...franchise,
    h2hwlt: normalizeWLT(raw.h2hwlt, raw.h2hw, raw.h2hl, raw.h2ht),
    divwlt: normalizeWLT(raw.divwlt, raw.divw, raw.divl, raw.divt),
    divpct: raw.divpct ?? '0',
    all_play_wlt: raw.all_play_wlt ?? '',
    all_play_pct: raw.all_play_pct ?? '0',
    pf: raw.pf ?? '0',
    pa: raw.pa ?? '0',
    pwr: raw.pwr ?? '0',
    vp: raw.vp ?? '0',
    teamName: teamConfig?.name || franchise.fname,
    division: teamConfig?.division || 'Unknown',
    teamIcon: teamConfig?.icon || '',
    teamBanner: teamConfig?.banner || '',
  };
}

// Get division standings
export function getDivisionStandings(franchises: StandingsFranchise[], config: LeagueConfig): DivisionStandings[] {
  // First get league standings to get seed information
  const leagueStandings = getLeagueStandings(franchises, config);
  const seedMap = new Map(leagueStandings.map(t => [t.id, t.seed]));

  const divisions: { [key: string]: TeamStanding[] } = {};

  // Group by division and enrich data
  franchises.forEach(franchise => {
    const standing = enrichTeamStanding(franchise, config);
    const div = standing.division;
    // Add seed from league standings
    standing.seed = seedMap.get(standing.id);

    if (!divisions[div]) {
      divisions[div] = [];
    }
    divisions[div].push(standing);
  });

  // Get division order from config, or use sorted keys
  const divisionOrder = config.divisions || Object.keys(divisions).sort();

  return divisionOrder
    .filter(div => divisions[div])
    .map(div => ({
      name: div,
      teams: divisionTiebreaker(divisions[div]),
    }));
}

// Get league standings (all teams sorted by playoff seeding)
export function getLeagueStandings(franchises: StandingsFranchise[], config: LeagueConfig): TeamStanding[] {
  const standings = franchises.map(f => enrichTeamStanding(f, config));

  // Group by division
  const divisions: { [key: string]: TeamStanding[] } = {};
  standings.forEach(standing => {
    if (!divisions[standing.division]) {
      divisions[standing.division] = [];
    }
    divisions[standing.division].push(standing);
  });

  // Get division winners (one per division)
  const divisionWinners = Object.values(divisions)
    .map(divTeams => divisionTiebreaker(divTeams)[0]);

  // Sort division winners by overall record, then tiebreakers
  const sortedDivWinners = divisionWinners.sort((a, b) => {
    // First sort by overall record (h2h)
    const aRecord = parseWLT(a.h2hwlt);
    const bRecord = parseWLT(b.h2hwlt);

    if (aRecord.wins !== bRecord.wins) return bRecord.wins - aRecord.wins;
    if (aRecord.losses !== bRecord.losses) return aRecord.losses - bRecord.losses;

    // Tiebreaker sequence: all-play, pf, pwr, vp, pa
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);
    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    const aPF = parseFloat(a.pf);
    const bPF = parseFloat(b.pf);
    if (aPF !== bPF) return bPF - aPF;

    const aPWR = parseFloat(a.pwr);
    const bPWR = parseFloat(b.pwr);
    if (aPWR !== bPWR) return bPWR - aPWR;

    const aVP = parseFloat(a.vp);
    const bVP = parseFloat(b.vp);
    if (aVP !== bVP) return bVP - aVP;

    const aPA = parseFloat(a.pa);
    const bPA = parseFloat(b.pa);
    return aPA - bPA; // Lower PA is better
  });

  // Get non-division winners and sort by overall record
  const nonDivWinners = standings.filter(
    team => !sortedDivWinners.find(dw => dw.id === team.id)
  );

  // Sort non-division winners by overall record (h2h - wins, then losses)
  const sortedNonDivWinners = nonDivWinners.sort((a, b) => {
    const aRecord = parseWLT(a.h2hwlt);
    const bRecord = parseWLT(b.h2hwlt);
    return bRecord.wins - aRecord.wins || aRecord.losses - bRecord.losses;
  });

  // Combine: division winners get the top seeds (1-N, one per division), the
  // rest follow sorted by record. N is however many divisions the config has —
  // 4 today, but 6 in the AFL's 2003-2012 layout (see afl-structure.ts).
  const league = [
    ...sortedDivWinners.map((team, idx) => ({ ...team, seed: idx + 1 })),
    ...sortedNonDivWinners.map((team, idx) => ({ ...team, seed: sortedDivWinners.length + idx + 1 })),
  ];

  return league;
}

// Get all-play standings (one combined table, no tier split).
// Optional calculatedAllPlay overrides MFL's cumulative all-play with records
// computed from weekly results (mirrors getTierAllPlayStandings) — required
// for pre-2017 feeds, which carry no all_play fields at all.
export function getAllPlayStandings(
  franchises: StandingsFranchise[],
  config: LeagueConfig,
  calculatedAllPlay?: Map<string, AllPlayRecord>
): TeamStanding[] {
  // First get league standings to get seed information
  const leagueStandings = getLeagueStandings(franchises, config);
  const seedMap = new Map(leagueStandings.map(t => [t.id, t.seed]));

  const standings = franchises.map(franchise => {
    const standing = enrichTeamStanding(franchise, config);
    // Add seed from league standings
    standing.seed = seedMap.get(standing.id);

    if (calculatedAllPlay) {
      const allPlayRecord = calculatedAllPlay.get(standing.id);
      if (allPlayRecord) {
        standing.all_play_wlt = `${allPlayRecord.wins}-${allPlayRecord.losses}-${allPlayRecord.ties}`;
        standing.all_play_pct = allPlayRecord.pct.toFixed(3);
      }
    }

    return standing;
  });

  return standings.sort((a, b) => {
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);

    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    // Tiebreaker: PF, PWR, VP, PA
    const aPF = parseFloat(a.pf);
    const bPF = parseFloat(b.pf);
    if (aPF !== bPF) return bPF - aPF;

    const aPWR = parseFloat(a.pwr);
    const bPWR = parseFloat(b.pwr);
    if (aPWR !== bPWR) return bPWR - aPWR;

    const aVP = parseFloat(a.vp);
    const bVP = parseFloat(b.vp);
    if (aVP !== bVP) return bVP - aVP;

    const aPA = parseFloat(a.pa);
    const bPA = parseFloat(b.pa);
    return aPA - bPA;
  });
}

// Get all-play standings grouped by tier (for AFL Fantasy)
// Optional calculatedAllPlay parameter allows using week-limited all-play records
// instead of MFL's cumulative all-play data.
// Optional tierMembership ({ franchiseId: tier }) overrides the static
// config.tier so a given season is grouped by THAT season's makeup (from
// data/afl-fantasy/tier-history.json via getTierMembership), not the current
// one. Teams absent from the override fall back to config.tier.
export function getTierAllPlayStandings(
  franchises: StandingsFranchise[],
  config: LeagueConfig,
  calculatedAllPlay?: Map<string, AllPlayRecord>,
  tierMembership?: Record<string, string> | null
): { tier: string; teams: TeamStanding[] }[] {
  // First get league standings to get seed information
  const leagueStandings = getLeagueStandings(franchises, config);
  const seedMap = new Map(leagueStandings.map(t => [t.id, t.seed]));

  const standings = franchises.map(franchise => {
    const standing = enrichTeamStanding(franchise, config);
    // Add seed from league standings
    standing.seed = seedMap.get(standing.id);

    // Override all-play data if calculated records are provided
    if (calculatedAllPlay) {
      const allPlayRecord = calculatedAllPlay.get(standing.id);
      if (allPlayRecord) {
        standing.all_play_wlt = `${allPlayRecord.wins}-${allPlayRecord.losses}-${allPlayRecord.ties}`;
        standing.all_play_pct = allPlayRecord.pct.toFixed(3);
      }
    }

    return standing;
  });

  // Group by tier
  const tiers: { [key: string]: TeamStanding[] } = {};
  standings.forEach(team => {
    const teamConfig = getTeamConfig(team.id, config);
    // Only honor a recognized override tier; an unknown value (typo/new tier)
    // would group the team under a stray key and then get silently dropped by
    // the `tierOrder` filter below — fall back to config.tier instead.
    const overrideTier = tierMembership?.[team.id];
    const validOverride =
      overrideTier === 'Premier League' || overrideTier === 'D-League'
        ? overrideTier
        : undefined;
    const tier = validOverride || teamConfig?.tier || 'Unknown';
    if (!tiers[tier]) {
      tiers[tier] = [];
    }
    tiers[tier].push(team);
  });

  // Sort teams within each tier by All-Play percentage
  const sortTeamsByAllPlay = (teams: TeamStanding[]) => {
    return teams.sort((a, b) => {
      const aAllPlay = parseFloat(a.all_play_pct);
      const bAllPlay = parseFloat(b.all_play_pct);

      if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

      // Tiebreaker: PF, PWR, VP, PA
      const aPF = parseFloat(a.pf);
      const bPF = parseFloat(b.pf);
      if (aPF !== bPF) return bPF - aPF;

      const aPWR = parseFloat(a.pwr);
      const bPWR = parseFloat(b.pwr);
      if (aPWR !== bPWR) return bPWR - aPWR;

      const aVP = parseFloat(a.vp);
      const bVP = parseFloat(b.vp);
      if (aVP !== bVP) return bVP - aVP;

      const aPA = parseFloat(a.pa);
      const bPA = parseFloat(b.pa);
      return aPA - bPA;
    });
  };

  // Return tiers in order: Premier League first, then D-League
  const tierOrder = ['Premier League', 'D-League'];
  return tierOrder
    .filter(tier => tiers[tier])
    .map(tier => ({
      tier,
      teams: sortTeamsByAllPlay(tiers[tier]),
    }));
}

// Get conference standings (for leagues with conferences like AFL Fantasy)
export function getConferenceStandings(franchises: StandingsFranchise[], config: LeagueConfig, conferenceCode: string) {
  if (!config.conferences || !config.divisionToConference) {
    throw new Error('League config does not have conference structure');
  }

  const conference = config.conferences.find(c => c.code === conferenceCode);
  if (!conference) {
    throw new Error(`Conference ${conferenceCode} not found`);
  }

  // Get all teams and enrich them
  const allStandings = franchises.map(f => enrichTeamStanding(f, config));

  // Filter to only teams in this conference's divisions
  const conferenceTeams = allStandings.filter(team =>
    conference.divisions.includes(team.division)
  );

  // Group by division
  const divisionGroups: { [key: string]: TeamStanding[] } = {};
  conferenceTeams.forEach(team => {
    if (!divisionGroups[team.division]) {
      divisionGroups[team.division] = [];
    }
    divisionGroups[team.division].push(team);
  });

  // Get division winners (one per division)
  const divisionWinners = Object.values(divisionGroups)
    .map(divTeams => divisionTiebreaker(divTeams)[0]);

  // Sort division winners by overall record
  const sortedDivWinners = divisionWinners.sort((a, b) => {
    const aRecord = parseWLT(a.h2hwlt);
    const bRecord = parseWLT(b.h2hwlt);

    if (aRecord.wins !== bRecord.wins) return bRecord.wins - aRecord.wins;
    if (aRecord.losses !== bRecord.losses) return aRecord.losses - bRecord.losses;

    // Tiebreakers
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);
    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    const aPF = parseFloat(a.pf);
    const bPF = parseFloat(b.pf);
    if (aPF !== bPF) return bPF - aPF;

    return 0;
  });

  // Get non-division winners (wild card candidates)
  const wildCardCandidates = conferenceTeams.filter(
    team => !sortedDivWinners.find(dw => dw.id === team.id)
  );

  // Sort wild card candidates by overall record
  const sortedWildCards = wildCardCandidates.sort((a, b) => {
    const aRecord = parseWLT(a.h2hwlt);
    const bRecord = parseWLT(b.h2hwlt);

    if (aRecord.wins !== bRecord.wins) return bRecord.wins - aRecord.wins;
    if (aRecord.losses !== bRecord.losses) return aRecord.losses - bRecord.losses;

    // Tiebreakers
    const aAllPlay = parseFloat(a.all_play_pct);
    const bAllPlay = parseFloat(b.all_play_pct);
    if (aAllPlay !== bAllPlay) return bAllPlay - aAllPlay;

    const aPF = parseFloat(a.pf);
    const bPF = parseFloat(b.pf);
    if (aPF !== bPF) return bPF - aPF;

    return 0;
  });

  // Assign seeds within conference: division winners take the top seeds
  // (1..sortedDivWinners.length — 2 today, but 3 in the AFL's 2003-2012
  // six-division layout, see afl-structure.ts), wild cards fill in after.
  const conferenceStandings = [
    ...sortedDivWinners.map((team, idx) => ({ ...team, conferenceSeed: idx + 1 })),
    ...sortedWildCards.map((team, idx) => ({ ...team, conferenceSeed: sortedDivWinners.length + idx + 1 })),
  ];

  return {
    conference,
    divisionWinners: sortedDivWinners.map((team, idx) => ({ ...team, conferenceSeed: idx + 1 })),
    wildCards: sortedWildCards.slice(0, 2).map((team, idx) => ({ ...team, conferenceSeed: sortedDivWinners.length + idx + 1 })),
    allTeams: conferenceStandings,
  };
}

// Get division champions (first-place team in each division by overall record + tiebreakers)
export function getDivisionChampions(franchises: StandingsFranchise[], config: LeagueConfig): Record<string, string> {
  const divStandings = getDivisionStandings(franchises, config);
  const champions: Record<string, string> = {};
  for (const division of divStandings) {
    if (division.teams.length > 0) {
      champions[division.name] = division.teams[0].teamName;
    }
  }
  return champions;
}

export interface DivisionChampion {
  id: string;
  name: string;
  icon: string;
}

/**
 * Like {@link getDivisionChampions}, but returns the champion's franchise id,
 * team name, and square team icon per division — everything the branded
 * division header needs to render the defending-champion logo.
 */
export function getDivisionChampionDetails(
  franchises: StandingsFranchise[],
  config: LeagueConfig
): Record<string, DivisionChampion> {
  const divStandings = getDivisionStandings(franchises, config);
  const champions: Record<string, DivisionChampion> = {};
  for (const division of divStandings) {
    if (division.teams.length > 0) {
      const top = division.teams[0];
      champions[division.name] = { id: top.id, name: top.teamName, icon: top.teamIcon };
    }
  }
  return champions;
}

// Determine playoff status for seeding view
export function getPlayoffSeeding(franchises: StandingsFranchise[], config: LeagueConfig): PlayoffSeeding {
  const league = getLeagueStandings(franchises, config);

  return {
    divisionWinners: league.filter(t => t.seed && t.seed <= 4),
    wildCards: league.filter(t => t.seed && t.seed >= 5 && t.seed <= 7),
    playInTeams: league.filter(t => t.seed && (t.seed === 8 || t.seed === 9)),
    toiletBowlTeams: league.filter(t => t.seed && t.seed >= 10),
  };
}
