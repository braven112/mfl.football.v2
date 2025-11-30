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

/**
 * Draft Prediction & Toilet Bowl Types
 */

export interface DraftPickOwnership {
  franchiseId: string;
  year: number;
  round: number;
  pickInRound: number;
  originalFranchiseId?: string;
  tradeChain?: string[]; // [original, intermediate1, intermediate2, ...current]
}

export interface DraftPrediction {
  overallPickNumber: number; // 1-51 (or 48 if no toilet bowl)
  round: number; // 1-3
  pickInRound: number; // 1-16, or special (17, 18)
  franchiseId: string;
  teamName: string;
  teamIcon: string;
  teamBanner: string;
  currentRecord: {
    wins: number;
    losses: number;
    ties: number;
  };
  currentStanding: {
    allPlayPct: number;
    pointsFor: number;
    pointsAgainst: number;
    powerRating: number;
    victoryPoints: number;
  };
  tradeHistory?: {
    originalTeam: string;
    originalFranchiseId: string;
    chain: Array<{ team: string; franchiseId: string }>;
  };
  originalTeamName?: string; // For displaying original owner in actual picks view
  originalTeamIcon?: string; // Icon of original owner (for dual icon display)
  isTraded?: boolean; // Whether this pick was traded
  isToiletBowlPick: boolean;
  toiletBowlType?: 'winner' | 'consolation' | 'consolation2';
  isLeagueWinner: boolean;
  predictedPickRank?: number; // For comparison/ranking
}

export interface ToiletBowlResult {
  level: 'winner' | 'consolation' | 'consolation2';
  franchiseId: string;
  franchiseName: string;
}

export interface SpecialDraftPick {
  round: number;
  pickInRound: number;
  franchiseId: string;
  level: 'winner' | 'consolation' | 'consolation2';
}
