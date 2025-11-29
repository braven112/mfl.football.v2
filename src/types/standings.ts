/**
 * Standings and Playoff Types
 */

export interface StandingsFranchise {
  id: string;
  fname: string;
  divwlt: string;
  divpct: string;
  divw: string;
  divl: string;
  divt: string;
  h2hwlt: string;
  h2hpct: string;
  h2hw: string;
  h2hl: string;
  h2ht: string;
  nondivwlt: string;
  nondivpct: string;
  nondivw: string;
  nondivl: string;
  nondivt: string;
  all_play_wlt: string;
  all_play_pct: string;
  pf: string;
  pa: string;
  pwr: string;
  pp: string;
  vp: string;
  op: string;
  strk: string;
  eliminated: string;
}

export interface TeamStanding extends StandingsFranchise {
  teamName: string;
  division: string;
  teamIcon: string;
  teamBanner: string;
  seed?: number;
  playoffStatus?: 'division_winner' | 'wild_card' | 'playoff_team' | 'play_in' | 'toilet_bowl';
}

export interface DivisionStandings {
  name: string;
  teams: TeamStanding[];
}

export interface PlayoffSeeding {
  divisionWinners: TeamStanding[];
  wildCards: TeamStanding[];
  playInTeams: TeamStanding[];
  toiletBowlTeams: TeamStanding[];
}
