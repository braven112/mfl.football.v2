/**
 * Contract Eligibility Types
 * Types for determining which players are eligible for contract declarations
 */

/** The kind of contract action available to a player */
export type DeclarationType =
  | 'new-acquisition'    // BBID/auction player declaring years (2-5)
  | 'rookie-override'    // Rookie reducing from 4yr RC default (1-3)
  | 'franchise-tag'      // Applying franchise tag (1yr remaining)
  | 'veteran-extension'  // Extending veteran contract (+2 years)
  | 'rookie-extension';  // Extending RC contract (+2 years)

/** Result of checking a single player's eligibility */
export interface EligibilityResult {
  playerId: string;
  franchiseId: string;
  eligible: boolean;
  declarationType: DeclarationType | null;
  /** For new acquisitions: when the player was added */
  acquisitionTimestamp?: number;
  /** For new acquisitions: when the declaration window closes */
  deadlineTimestamp?: number;
  /** Whether the deadline has already passed */
  isExpired?: boolean;
  /** Valid year options for the owner to choose from */
  yearOptions?: number[];
  /** For extensions: the calculated new salary */
  extensionSalary?: number;
  /** For extensions: total contract years after extension (currentYears + 2) */
  extensionYears?: number;
  /** For franchise tags: the calculated tag salary */
  tagSalary?: number;
  /** Description of how tag salary was determined */
  tagBasis?: string;
  /** Current contract state */
  currentYears: number;
  currentSalary: number;
  contractInfo: string;
  isRookieContract: boolean;
}

/** A normalized transaction record parsed from MFL data */
export interface TransactionRecord {
  type: 'BBID_WAIVER' | 'FREE_AGENT' | 'TRADE' | 'BBID_AUTO_PROCESS_WAIVERS' | string;
  franchise: string;
  timestamp: number;
  /** Player IDs that were added in this transaction */
  addedPlayerIds: string[];
  /** Player IDs that were dropped in this transaction */
  droppedPlayerIds: string[];
  /** BBID amount if applicable */
  bbidAmount?: number;
}

/** Raw MFL transaction from the API */
export interface MFLRawTransaction {
  type: string;
  franchise: string;
  franchise2?: string;
  timestamp: string;
  transaction: string;
  by_commish?: string;
  franchise1_gave_up?: string;
  franchise2_gave_up?: string;
  comments?: string;
  expires?: string;
}

/** Player data from rosters.json */
export interface RosterPlayer {
  id: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
  status: string;
}

/** Player data from players.json (subset of fields we need) */
export interface MFLPlayerInfo {
  id: string;
  name: string;
  position: string;
  team: string;
  status?: string;      // "R" = rookie
  draft_year?: string;
}

/** Draft pick from draftResults.json */
export interface DraftPick {
  player: string;        // player ID
  franchise: string;     // franchise ID
  round: string;
  pick: string;
  timestamp: string;
}

/** Batch result for a full team's eligibility */
export interface TeamEligibilityResult {
  franchiseId: string;
  players: EligibilityResult[];
  /** Count of players with active eligibility windows */
  eligibleCount: number;
  /** Count of players with approaching deadlines (< 4 hours) */
  urgentCount: number;
}
