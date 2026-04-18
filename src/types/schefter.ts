// ── Schefter Report Types ──

// ── Author System ──

/** A news feed author/contributor */
export interface SchefterAuthor {
  id: string;
  name: string;
  handle: string;
  /** Avatar filename — resolved to /assets/schefter/{avatar} or /assets/{avatar} */
  avatar: string;
  bio: string;
  /** True for external sources (ESPN, etc.) — posts link out instead of showing inline */
  external?: boolean;
}

/** Known authors — keyed by authorId */
export const SCHEFTER_AUTHORS: Record<string, SchefterAuthor> = {
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
  'nfl-wire': {
    id: 'nfl-wire',
    name: 'NFL Wire',
    handle: '@NFLWire',
    avatar: 'nfl-wire-avatar.webp',
    bio: 'The latest from around the league. Free agency moves, transactions, and everything that moves the needle.',
    external: true,
  },
  'nfl-draft': {
    id: 'nfl-draft',
    name: 'NFL Draft',
    handle: '@NFLDraft',
    avatar: 'nfl-draft-avatar.webp',
    bio: 'Draft intel, big boards, scouting reports, and prospect news. The offseason\'s most important feed.',
    external: true,
  },
  'doc-rivers': {
    id: 'doc-rivers',
    name: 'Doc Rivers',
    handle: '@DocRivers',
    avatar: 'doc-rivers-avatar.webp',
    bio: 'League medical correspondent. If your guy tweaked something in practice, I already know about it. Fantasy-relevant injury intel, no sugarcoating.',
  },
  'vegas-vic': {
    id: 'vegas-vic',
    name: 'Vegas Vic',
    handle: '@VegasVic',
    avatar: 'vegas-vic-avatar.webp',
    bio: 'Weekly lines, spreads, and over/unders for every NFL matchup. Not financial advice. Okay, maybe a little.',
  },
  'nfl-insider': {
    id: 'nfl-insider',
    name: 'NFL Insider',
    handle: '@NFLInsider',
    avatar: 'nfl-insider-avatar.webp',
    bio: 'Injury reports, betting lines, and the intel that moves lineups. If it affects your start/sit decision, it\'s here.',
    external: true,
  },
};

/** Resolve an authorId to its author config, defaulting to Claude */
export function getAuthor(authorId?: string): SchefterAuthor {
  return SCHEFTER_AUTHORS[authorId ?? 'claude'] ?? SCHEFTER_AUTHORS.claude;
}

/** Resolve avatar path for an author.
 * Internal authors (Claude, Roger) live in /assets/. ESPN contributors in /assets/schefter/. */
export function getAuthorAvatar(author: SchefterAuthor): string {
  if (author.external) return `/assets/schefter/${author.avatar}`;
  return `/assets/${author.avatar}`;
}

// ── Post Types ──

/** Post types — MVP ships 'transaction' only; others architected for Phase 2 */
export type SchefterPostType =
  | 'transaction'
  | 'article'
  | 'external'
  | 'milestone'
  | 'power-ranking'
  | 'matchup-preview'
  | 'board'
  | 'ask-roger'
  | 'injury'
  | 'odds'
  | 'groupme';

/** MFL transaction sub-types we care about */
export type TransactionSubType =
  | 'TRADE'
  | 'AUCTION_WON'
  | 'FREE_AGENT'
  | 'BBID_WAIVER';

/** Visual treatment and content depth */
export type PostTier = 'breaking' | 'standard' | 'minor';

/** Feed category for filtering */
export type SchefterCategory = 'transactions' | 'articles';

/** A single auction grade entry (enriched by deterministic data + AI commentary) */
export interface AuctionGrade {
  /** Franchise ID */
  franchiseId: string;
  /** Letter grade: A+ through F */
  grade: string;
  /** Punchy 5-8 word summary */
  headline: string;
  /** 2-3 sentence HTML explanation */
  body: string;
  /** Deterministic fields (enriched post-generation) */
  teamName?: string;
  abbrev?: string;
  color?: string;
  auctionSpend?: number;
  auctionSpendDisplay?: string;
  playerCount?: number;
  holesBefore?: string[];
  holesRemaining?: string[];
  holesFilled?: string[];
  postCapSpace?: number;
  postCapSpaceDisplay?: string;
  pickups?: Array<{ name: string; position: string; salary: string }>;
}

/** A single Schefter feed post */
export interface SchefterPost {
  /** Unique ID: sf_{timestamp}_{hash} */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Post classification */
  type: SchefterPostType;
  /** Transaction sub-type (only when type === 'transaction') */
  transactionSubType?: TransactionSubType;
  /** Feed category for filtering (defaults to 'transactions') */
  category?: SchefterCategory;
  /** Visual/content tier */
  tier: PostTier;
  /** Short headline (~60 chars, for card display and widget) */
  headline: string;
  /** Post body — excerpt for articles, full text for transactions */
  body: string;
  /** Schefter hot take / trade grade (breaking tier only) */
  analysis?: string;
  /** Full article content — array of HTML paragraph strings (articles only) */
  content?: string[];
  /** Intro paragraphs for grade-card articles (rendered before grades) */
  intro?: string[];
  /** Auction grade entries (grade-card articles only) */
  grades?: AuctionGrade[];
  /** Featured image path relative to /assets/schefter/ (articles only) */
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
  /** MFL pending-trade offer ID (rumor posts only) */
  offerId?: string;
  /** Stable trade dedup key — sorted franchise pair + sorted asset IDs.
   *  Lets a completed TRADE post supersede an earlier trade-pending rumor. */
  tradeSignature?: string | null;
  /** League slug for multi-league support */
  league: 'theleague' | 'afl';
}

/** The full feed file structure */
export interface SchefterFeed {
  /** ISO timestamp of last agent scan */
  lastScanTimestamp: string;
  /** MFL transaction timestamp watermark — only process newer transactions */
  lastProcessedMflTimestamp: string;
  /** ESPN article timestamp watermark — only process newer articles */
  lastEspnTimestamp?: string;
  /** NFL Wire news timestamp watermark — only process newer articles */
  lastNflWireTimestamp?: string;
  /** Injury snapshot — playerId → last known status, for change detection */
  lastInjurySnapshot?: Record<string, string>;
  /** Last NFL week we posted opening odds for */
  lastOddsWeek?: number;
  /** All posts, newest first */
  posts: SchefterPost[];
}

/** Fixed reaction emoji set — ❤️ is the primary "like" action */
export const SCHEFTER_REACTIONS = ['❤️', '🔥', '💰', '💩', '🏆', '📉', '💯', '🤔', '😂', '📈', '💉'] as const;
export type SchefterReaction = (typeof SCHEFTER_REACTIONS)[number];

/** Emoji → array of franchiseIds who reacted */
export interface SchefterReactionMap {
  [emoji: string]: string[];
}

/** API response for reactions on a single post */
export interface SchefterReactionResponse {
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
