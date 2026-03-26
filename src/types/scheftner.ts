// ── Scheftner Report Types ──

/** Post types — MVP ships 'transaction' only; others architected for Phase 2 */
export type ScheftnerPostType =
  | 'transaction'
  | 'article'
  | 'milestone'
  | 'power-ranking'
  | 'matchup-preview'
  | 'board'
  | 'ask-roger';

/** MFL transaction sub-types we care about */
export type TransactionSubType =
  | 'TRADE'
  | 'AUCTION_WON'
  | 'FREE_AGENT'
  | 'BBID_WAIVER';

/** Visual treatment and content depth */
export type PostTier = 'breaking' | 'standard' | 'minor';

/** A single Scheftner feed post */
export interface ScheftnerPost {
  /** Unique ID: sf_{timestamp}_{hash} */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Post classification */
  type: ScheftnerPostType;
  /** Transaction sub-type (only when type === 'transaction') */
  transactionSubType?: TransactionSubType;
  /** Visual/content tier */
  tier: PostTier;
  /** Short headline (~60 chars, for card display and widget) */
  headline: string;
  /** Post body (may contain HTML for bold/italic) */
  body: string;
  /** Scheftner hot take / trade grade (breaking tier only) */
  analysis?: string;
  /** Franchise IDs involved (for "my team" filtering) */
  franchiseIds: string[];
  /** Player IDs involved (for linking to player modals) */
  playerIds?: string[];
  /** Link to source page (transaction detail, article, etc.) */
  link?: string;
  /** Link CTA label */
  linkLabel?: string;
  /** MFL transaction timestamp (Unix epoch string, for dedup) */
  sourceTimestamp?: string;
  /** League slug for multi-league support */
  league: 'theleague' | 'afl';
}

/** The full feed file structure */
export interface ScheftnerFeed {
  /** ISO timestamp of last agent scan */
  lastScanTimestamp: string;
  /** MFL transaction timestamp watermark — only process newer transactions */
  lastProcessedMflTimestamp: string;
  /** All posts, newest first */
  posts: ScheftnerPost[];
}

/** Fixed reaction emoji set */
export const SCHEFTNER_REACTIONS = ['🔥', '💰', '💩', '🏆', '📉', '💯', '🤔', '😂', '📈', '💉'] as const;
export type ScheftnerReaction = (typeof SCHEFTNER_REACTIONS)[number];

/** Emoji → array of franchiseIds who reacted */
export interface ScheftnerReactionMap {
  [emoji: string]: string[];
}

/** API response for reactions on a single post */
export interface ScheftnerReactionResponse {
  reactions: Record<string, number>;
  userReaction: string | null;
}

/** Parsed transaction data (intermediate, before post generation) */
export interface ParsedTransaction {
  type: TransactionSubType;
  franchiseId: string;
  franchiseId2?: string;
  timestamp: string;
  /** Players acquired by franchise1 (for TRADE: from franchise2) */
  playersAcquired: ParsedTransactionItem[];
  /** Players given up by franchise1 (for TRADE: to franchise2) */
  playersGivenUp: ParsedTransactionItem[];
  /** Draft picks acquired by franchise1 */
  picksAcquired: ParsedDraftPick[];
  /** Draft picks given up by franchise1 */
  picksGivenUp: ParsedDraftPick[];
  /** Salary involved (for auction/FA) */
  salary?: number;
  /** Raw MFL comments field */
  comments?: string;
  /** Was this a commissioner-executed transaction? */
  byCommish: boolean;
}

/** A player in a transaction */
export interface ParsedTransactionItem {
  playerId: string;
  playerName?: string;
  position?: string;
  nflTeam?: string;
  salary?: number;
}

/** A draft pick in a transaction */
export interface ParsedDraftPick {
  originalFranchiseId: string;
  year: number;
  round: number;
  /** Resolved display string: "Team's 2026 1st" */
  display?: string;
}

/** Raw MFL transaction from transactions.json */
export interface MFLRawTransaction {
  type: string;
  franchise: string;
  franchise2?: string;
  timestamp: string;
  transaction: string;
  franchise1_gave_up?: string;
  franchise2_gave_up?: string;
  comments?: string;
  by_commish?: string;
  dropped?: string;
  expires?: string;
}
