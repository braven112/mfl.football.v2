/**
 * Standings Utilities
 * Handles tiebreakers, playoff seeding, and standings sorting
 */

import type { StandingsFranchise, TeamStanding, DivisionStandings, PlayoffSeeding } from '@mfl/shared-types';
// TODO: Remove hardcoded league config - should be passed as parameter
// @ts-ignore - temporary until we refactor to pass config as parameter
const leagueConfig = { teams: [] } as any;

// Parse W-L-T string to get wins and losses
function parseWLT(wlt: string): { wins: number; losses: number; ties: number } {
  const [wins, losses, ties] = wlt.split('-').map(Number);
  return { wins, losses, ties };
}

// Get team config info
function getTeamConfig(franchiseId: string) {
  return leagueConfig.teams.find(t => t.franchiseId === franchiseId);
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

// Enrich franchise data with team config info
export function enrichTeamStanding(franchise: StandingsFranchise): TeamStanding {
  const teamConfig = getTeamConfig(franchise.id);

  return {
    ...franchise,
    teamName: teamConfig?.name || franchise.fname,
    division: teamConfig?.division || 'Unknown',
    teamIcon: teamConfig?.icon || '',
    teamBanner: teamConfig?.banner || '',
  };
}

// Get division standings
export function getDivisionStandings(franchises: StandingsFranchise[]): DivisionStandings[] {
  // First get league standings to get seed information
  const leagueStandings = getLeagueStandings(franchises);
  const seedMap = new Map(leagueStandings.map(t => [t.id, t.seed]));

  const divisions: { [key: string]: TeamStanding[] } = {};

  // Group by division and enrich data
  franchises.forEach(franchise => {
    const standing = enrichTeamStanding(franchise);
    const div = standing.division;
    // Add seed from league standings
    standing.seed = seedMap.get(standing.id);

    if (!divisions[div]) {
      divisions[div] = [];
    }
    divisions[div].push(standing);
  });

  // Sort each division by tiebreakers
  const divisionOrder = ['Northwest', 'Southwest', 'Central', 'East'];

  return divisionOrder
    .filter(div => divisions[div])
    .map(div => ({
      name: div,
      teams: divisionTiebreaker(divisions[div]),
    }));
}

// Get league standings (all teams sorted by playoff seeding)
export function getLeagueStandings(franchises: StandingsFranchise[]): TeamStanding[] {
  const standings = franchises.map(enrichTeamStanding);

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

  // Combine: seeds 1-4 (div winners), 5-16 (rest sorted by record)
  const league = [
    ...sortedDivWinners.map((team, idx) => ({ ...team, seed: idx + 1 })),
    ...sortedNonDivWinners.map((team, idx) => ({ ...team, seed: idx + 5 })),
  ];

  return league;
}

// Get all-play standings
export function getAllPlayStandings(franchises: StandingsFranchise[]): TeamStanding[] {
  // First get league standings to get seed information
  const leagueStandings = getLeagueStandings(franchises);
  const seedMap = new Map(leagueStandings.map(t => [t.id, t.seed]));

  const standings = franchises.map(franchise => {
    const standing = enrichTeamStanding(franchise);
    // Add seed from league standings
    standing.seed = seedMap.get(standing.id);
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

// Determine playoff status for seeding view
export function getPlayoffSeeding(franchises: StandingsFranchise[]): PlayoffSeeding {
  const league = getLeagueStandings(franchises);

  return {
    divisionWinners: league.filter(t => t.seed && t.seed <= 4),
    wildCards: league.filter(t => t.seed && t.seed >= 5 && t.seed <= 7),
    playInTeams: league.filter(t => t.seed && (t.seed === 8 || t.seed === 9)),
    toiletBowlTeams: league.filter(t => t.seed && t.seed >= 10),
  };
}
