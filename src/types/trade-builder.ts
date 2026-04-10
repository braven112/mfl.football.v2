/**
 * Trade Builder Types
 * Defines interfaces for the trade simulation page
 */

/** Processed player data passed from Astro to React */
export interface TradeBuilderPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  contractYears: number;
  contractInfo: string;
  status: string;
  normalizedStatus: 'ACTIVE' | 'PRACTICE' | 'INJURED';
  nflTeam: string;
  /** Player headshot image URL */
  headshot: string;
  /** NFL team logo URL */
  nflLogo: string;
  isRookie: boolean;
  isFranchiseTagged: boolean;
  /** Whether the player is on their team's trade bait list */
  tradeBait: boolean;
  /** Pre-computed cap hit for each of SALARY_YEARS */
  capHitByYear: number[];
}

/** Draft pick ownership info */
export interface TradeBuilderDraftPick {
  year: string;
  round: string;
  originalPickFor: string;
  originalTeamName: string;
}

/** Processed team data passed from Astro to React */
export interface TradeBuilderTeam {
  franchiseId: string;
  name: string;
  nameMedium: string;
  nameShort: string;
  abbrev: string;
  icon: string;
  division: string;
  players: TradeBuilderPlayer[];
  draftPicks: TradeBuilderDraftPick[];
  /** Pre-computed cap charges for SALARY_YEARS */
  capCharges: number[];
  /** Dead money for SALARY_YEARS */
  deadMoney: number[];
  currentCapSpace: number;
  totalSalary: number;
  rosterCount: number;
}

/** Salary averages per position (for rookie extension calc) */
export interface PositionSalaryAverages {
  [position: string]: {
    top3Average: number;
    top5Average: number;
  };
}

/** Surplus value data per player (admin-only, from surplus-value calculator) */
export interface PlayerSurplusData {
  dollarValue: number;
  estimatedCost: number;
  surplusValue: number;
}

/** Draft pick value data (admin-only, from draft-pick-value calculator) */
export interface DraftPickValueData {
  round: number;
  expectedSalary: number;
  surplusValue: number;
  totalSurplusOverContract: number;
  contractYears: number;
}

/** All data the Astro page passes to React */
export interface TradeBuilderPageData {
  teams: TradeBuilderTeam[];
  salaryYears: number[];
  salaryCap: number;
  rosterLimit: number;
  leagueYear: number;
  positionAverages: PositionSalaryAverages;
  surplusMap?: Record<string, PlayerSurplusData>;
  pickValueMap?: Record<string, DraftPickValueData>;
}

/** Key to uniquely identify a draft pick */
export interface DraftPickKey {
  year: string;
  round: string;
  originalPickFor: string;
}

/** Result of simulating a rookie contract extension */
export interface RookieExtensionSim {
  newSalary: number;
  newContractYears: number;
  extensionYears: number;
  capHitByYear: number[];
}

/** One side of the trade */
export interface TradeSide {
  franchiseId: string | null;
  playerIds: string[];
  draftPicks: DraftPickKey[];
  rookieExtensions: Record<string, RookieExtensionSim>;
}

/** Core trade state managed by useReducer */
export interface TradeState {
  teamA: TradeSide;
  teamB: TradeSide;
  rookieModalTarget: { playerId: string; side: 'A' | 'B' } | null;
}

/** Reducer actions */
export type TradeAction =
  | { type: 'SET_TEAM'; side: 'A' | 'B'; franchiseId: string }
  | { type: 'ADD_PLAYER'; side: 'A' | 'B'; playerId: string }
  | { type: 'REMOVE_PLAYER'; side: 'A' | 'B'; playerId: string }
  | { type: 'ADD_DRAFT_PICK'; side: 'A' | 'B'; pick: DraftPickKey }
  | { type: 'REMOVE_DRAFT_PICK'; side: 'A' | 'B'; pick: DraftPickKey }
  | { type: 'SET_ROOKIE_EXTENSION'; side: 'A' | 'B'; playerId: string; sim: RookieExtensionSim }
  | { type: 'CLEAR_ROOKIE_EXTENSION'; side: 'A' | 'B'; playerId: string }
  | { type: 'SHOW_ROOKIE_MODAL'; playerId: string; side: 'A' | 'B' }
  | { type: 'HIDE_ROOKIE_MODAL' }
  | { type: 'RESET' }
  | { type: 'SWAP_TEAMS' }
  | { type: 'START_TRADE_FOR_PLAYER'; franchiseId: string; playerId: string }
  | { type: 'LOAD_DRAFT'; teamA: TradeSide; teamB: TradeSide };

/** Computed cap impact for one team in a trade */
export interface TeamTradeImpact {
  preTradeCapCharges: number[];
  postTradeCapCharges: number[];
  preTradeCapSpace: number[];
  postTradeCapSpace: number[];
  capDelta: number[];
  isOverCap: boolean[];
  totalSalaryTraded: number;
  totalSalaryReceived: number;
  rosterCountDelta: number;
  positionBreakdown: PositionChange[];
}

/** Net change in position depth */
export interface PositionChange {
  position: string;
  lost: number;
  gained: number;
  netChange: number;
}

// ---------------------------------------------------------------------------
// Trade Submission & Pending Trades
// ---------------------------------------------------------------------------

/** Auth user info passed from Astro to React */
export interface TradeBuilderAuthUser {
  name: string;
  franchiseId: string;
  leagueId: string;
  role: string;
}

/** A pending trade from MFL's pendingTrades export */
export interface PendingTrade {
  tradeId: string;
  offeredBy: string;
  offeredTo: string;
  willGiveUp: string;
  willReceive: string;
  timestamp: number;
  expires: number;
  comments: string;
  byCommish: boolean;
}

/** Submission status for the confirmation modal */
export interface TradeSubmissionState {
  status: 'idle' | 'submitting' | 'success' | 'error';
  errorMessage: string | null;
}

/** Extended trade actions for submission UI */
export type TradeActionExtended =
  | TradeAction
  | { type: 'SHOW_CONFIRMATION_MODAL' }
  | { type: 'HIDE_CONFIRMATION_MODAL' }
  | { type: 'TOGGLE_PENDING_PANEL' }
  | { type: 'HIDE_PENDING_PANEL' }
  | { type: 'SUBMIT_TRADE_START' }
  | { type: 'SUBMIT_TRADE_SUCCESS' }
  | { type: 'SUBMIT_TRADE_ERROR'; message: string }
  | { type: 'SUBMIT_TRADE_RESET' };

// ---------------------------------------------------------------------------
// Draft Trades (localStorage persistence)
// ---------------------------------------------------------------------------

/** A saved draft trade */
export interface DraftTrade {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  teamA: TradeSide;
  teamB: TradeSide;
}
