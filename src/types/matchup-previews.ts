/**
 * Dynamic Matchup Previews Types
 * Core data models for the matchup preview system
 */

/**
 * Game state enumeration
 */
export type GameState = 'pre-game' | 'in-progress' | 'completed';

/**
 * Player injury status from MFL API
 */
export type PlayerStatus = 'Healthy' | 'Questionable' | 'Doubtful' | 'Out' | 'IR';

/**
 * Time slot for NFL games
 */
export type TimeSlot = 'early' | 'late';

/**
 * Lineup optimization issue types
 */
export type OptimizationType = 'bench_upgrade' | 'injury_warning' | 'ir_eligible';

/**
 * Optimization severity levels
 */
export type OptimizationSeverity = 'low' | 'medium' | 'high';

/**
 * Weather information for NFL games
 */
export interface WeatherInfo {
  temperature?: number;
  conditions?: string;
  windSpeed?: number;
  precipitation?: number;
  dome?: boolean;
}

/**
 * Broadcast information for NFL games
 */
export interface BroadcastInfo {
  network?: string;
  announcers?: string[];
  isNationalGame?: boolean;
}

/**
 * Player news update
 */
export interface PlayerNews {
  id: string;
  playerId: string;
  headline: string;
  summary?: string;
  timestamp: Date;
  source?: string;
  impactLevel?: 'low' | 'medium' | 'high';
}

/**
 * Player matchup data for specific games
 */
export interface PlayerMatchupData {
  opponent: string;
  gameTime: Date;
  isHome: boolean;
  weather?: WeatherInfo;
  projectedPoints?: number;
  actualPoints?: number;
}

/**
 * Bench upgrade information
 */
export interface BenchUpgrade {
  hasUpgrade: boolean;
  upgradePlayer?: FantasyPlayer;
  pointsDifference?: number;
}

/**
 * Fantasy player with matchup-specific data
 */
export interface FantasyPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  fantasyTeamId: string;
  projectedPoints?: number;
  actualPoints?: number;
  matchupData?: PlayerMatchupData;
  newsUpdates?: PlayerNews[];
  isStarting: boolean;
  injuryStatus: PlayerStatus;
  isIReligible?: boolean;
  benchUpgrade?: BenchUpgrade;
}

/**
 * Fantasy team information
 */
export interface FantasyTeam {
  id: string;
  name: string;
  ownerName: string;
  icon?: string;
  banner?: string;
  projectedPoints?: number;
  actualPoints?: number;
}

/**
 * NFL game with fantasy player data
 */
export interface NFLGame {
  id: string;
  team1: string;
  team2: string;
  players: FantasyPlayer[];
  playerCount: number;
  gameTime: Date;
  timeSlot: TimeSlot;
  isCompleted: boolean;
  projectedPoints?: number;
  actualPoints?: number;
  isGameOfWeek?: boolean;
  analysis?: string;
  weather?: WeatherInfo;
  broadcast?: BroadcastInfo;
}

/**
 * Starting lineup by position
 */
export interface StartingLineup {
  teamId: string;
  week: number;
  positions: {
    QB: FantasyPlayer[];
    RB: FantasyPlayer[];
    WR: FantasyPlayer[];
    TE: FantasyPlayer[];
    FLEX: FantasyPlayer[];
    K: FantasyPlayer[];
    DEF: FantasyPlayer[];
  };
  bench: FantasyPlayer[];
  totalProjected: number;
  totalActual?: number;
  optimizationOpportunities: LineupOptimization[];
}

/**
 * Lineup optimization opportunity
 */
export interface LineupOptimization {
  type: OptimizationType;
  severity: OptimizationSeverity;
  startingPlayer: FantasyPlayer;
  suggestedPlayer?: FantasyPlayer;
  pointsDifference?: number;
  message: string;
  actionUrl?: string;
  includeInAnalysis: boolean;
  analysisText?: string;
}

/**
 * Analysis prompt for generating matchup commentary
 */
export interface AnalysisPrompt {
  matchupContext: {
    homeTeam: string;
    awayTeam: string;
    week: number;
    gameState: GameState;
  };
  criticalIssues: {
    injuredStarters: LineupOptimization[];
    significantUpgrades: LineupOptimization[];
  };
  focusAreas: string[];
  maxSentences: number;
  tone: 'predictive' | 'analytical';
}

/**
 * Score update information
 */
export interface ScoreUpdate {
  matchupId: string;
  homeScore: number;
  awayScore: number;
  lastUpdated: Date;
  gameStates: Record<string, GameState>;
  analysisGenerated: {
    preGame: boolean;
    postGame: boolean;
  };
}

/**
 * Main matchup interface
 */
export interface Matchup {
  id: string;
  week: number;
  homeTeam: FantasyTeam;
  awayTeam: FantasyTeam;
  nflGames: NFLGame[];
  gameState: GameState;
  projectedTotal?: number;
  actualTotal?: number;
  analysis: string;
  lastUpdated: Date;
}