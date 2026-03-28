// ── Scheftner Report Types ──

// ── Author System ──

/** A news feed author/contributor */
export interface ScheftnerAuthor {
  id: string;
  name: string;
  handle: string;
  /** Avatar filename — resolved to /assets/scheftner/{avatar} or /assets/{avatar} */
  avatar: string;
  bio: string;
  /** True for external sources (ESPN, etc.) — posts link out instead of showing inline */
  external?: boolean;
}

/** Known authors — keyed by authorId */
export const SCHEFTNER_AUTHORS: Record<string, ScheftnerAuthor> = {
  claude: {
    id: 'claude',
    name: 'Claude Schefter',
    handle: '@schefter',
    avatar: 'claude-schefter-avatar.webp',
    bio: 'League insider. Beat reporter. I\'m told I have the best sources in the building. Breaking trades, grading picks, and calling out overpays since 2026.',
  },
  'adam-schefter': {
    id: 'adam-schefter',
    name: 'Adam Schefter',
    handle: '@AdamSchefter',
    avatar: 'adam-schefter-avatar.webp',
    bio: 'ESPN Senior NFL Insider. Host of The Adam Schefter Podcast.',
    external: true,
  },
  'mel-kiper': {
    id: 'mel-kiper',
    name: 'Mel Kiper Jr.',
    handle: '@MelKiperESPN',
    avatar: 'mel-kiper-avatar.webp',
    bio: 'ESPN NFL Draft Analyst. Big board season is year-round.',
    external: true,
  },
  'field-yates': {
    id: 'field-yates',
    name: 'Field Yates',
    handle: '@FieldYates',
    avatar: 'field-yates-avatar.webp',
    bio: 'ESPN NFL Insider.',
    external: true,
  },
  'jeremy-fowler': {
    id: 'jeremy-fowler',
    name: 'Jeremy Fowler',
    handle: '@JFowlerESPN',
    avatar: 'jeremy-fowler-avatar.webp',
    bio: 'ESPN Senior NFL National Reporter.',
    external: true,
  },
  'dan-graziano': {
    id: 'dan-graziano',
    name: 'Dan Graziano',
    handle: '@DanGraziano',
    avatar: 'dan-graziano-avatar.webp',
    bio: 'ESPN Senior NFL National Reporter.',
    external: true,
  },
  'ben-solak': {
    id: 'ben-solak',
    name: 'Ben Solak',
    handle: '@BenSolak',
    avatar: 'ben-solak-avatar.webp',
    bio: 'ESPN NFL Analyst.',
    external: true,
  },
  'matt-miller': {
    id: 'matt-miller',
    name: 'Matt Miller',
    handle: '@MattMillerNFL',
    avatar: 'matt-miller-avatar.webp',
    bio: 'ESPN NFL Draft Analyst.',
    external: true,
  },
  'jordan-reid': {
    id: 'jordan-reid',
    name: 'Jordan Reid',
    handle: '@JReidNFL',
    avatar: 'jordan-reid-avatar.webp',
    bio: 'ESPN NFL Draft Analyst.',
    external: true,
  },
  'kalyn-kahler': {
    id: 'kalyn-kahler',
    name: 'Kalyn Kahler',
    handle: '@KalynKahler',
    avatar: 'kalyn-kahler-avatar.webp',
    bio: 'ESPN NFL Reporter.',
    external: true,
  },
  'lindsey-thiry': {
    id: 'lindsey-thiry',
    name: 'Lindsey Thiry',
    handle: '@LindseyThiry',
    avatar: 'lindsey-thiry-avatar.webp',
    bio: 'ESPN NFL Reporter.',
    external: true,
  },
  roger: {
    id: 'roger',
    name: 'Ask Roger',
    handle: '@askroger',
    avatar: 'commissioner-avatar.webp',
    bio: 'AI rules expert and deadline enforcer. He\'s read the constitution so you don\'t have to. His dates are probably right — check the calendar to be sure.',
  },
};

/** Resolve an authorId to its author config, defaulting to Claude */
export function getAuthor(authorId?: string): ScheftnerAuthor {
  return SCHEFTNER_AUTHORS[authorId ?? 'claude'] ?? SCHEFTNER_AUTHORS.claude;
}

/** Resolve avatar path for an author.
 * Internal authors (Claude, Roger) live in /assets/. ESPN contributors in /assets/scheftner/. */
export function getAuthorAvatar(author: ScheftnerAuthor): string {
  if (author.external) return `/assets/scheftner/${author.avatar}`;
  return `/assets/${author.avatar}`;
}

// ── Post Types ──

/** Post types — MVP ships 'transaction' only; others architected for Phase 2 */
export type ScheftnerPostType =
  | 'transaction'
  | 'article'
  | 'external'
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

/** Feed category for filtering */
export type ScheftnerCategory = 'transactions' | 'articles';

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
  /** Feed category for filtering (defaults to 'transactions') */
  category?: ScheftnerCategory;
  /** Visual/content tier */
  tier: PostTier;
  /** Short headline (~60 chars, for card display and widget) */
  headline: string;
  /** Post body — excerpt for articles, full text for transactions */
  body: string;
  /** Scheftner hot take / trade grade (breaking tier only) */
  analysis?: string;
  /** Full article content — array of HTML paragraph strings (articles only) */
  content?: string[];
  /** Featured image path relative to /assets/scheftner/ (articles only) */
  image?: string;
  /** Image alt text (articles only) */
  imageAlt?: string;
  /** Franchise IDs involved (for "my team" filtering) */
  franchiseIds: string[];
  /** Player IDs involved (for linking to player modals) */
  playerIds?: string[];
  /** Link to source page (transaction detail, article, etc.) */
  link?: string;
  /** Link CTA label */
  linkLabel?: string;
  /** Author ID — defaults to 'claude' for backward compatibility */
  authorId?: string;
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
  /** ESPN article timestamp watermark — only process newer articles */
  lastEspnTimestamp?: string;
  /** All posts, newest first */
  posts: ScheftnerPost[];
}

/** Fixed reaction emoji set — ❤️ is the primary "like" action */
export const SCHEFTNER_REACTIONS = ['❤️', '🔥', '💰', '💩', '🏆', '📉', '💯', '🤔', '😂', '📈', '💉'] as const;
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
