/**
 * Rankings Import Types
 *
 * Type definitions for the bookmarklet-based rankings import system.
 * All bookmarklets output the BookmarkletOutput format; the import page
 * parses it, fuzzy-matches to MFL players, and stores as StoredRankingImport.
 */

// ---------------------------------------------------------------------------
// Bookmarklet output (what gets copied to clipboard)
// ---------------------------------------------------------------------------

export type RankingSourceId =
  | 'fantasypros'
  | 'cbs'
  | 'sleeper'
  | 'fantasycalc'
  | 'espn'
  | 'keeptradecut'
  | 'dlf'
  | 'yahoo'
  | 'footballguys'
  // Built-in sources — fetched at build time, present for every owner without
  // an import. See scripts/fetch-ranking-sources.mjs.
  | 'mfl-adp'
  | 'sharks'
  | 'sleeper-adp'
  | 'espn-superflex'
  | 'custom';

export type RankingType = 'dynasty' | 'redraft' | 'adp' | 'overall';

export interface BookmarkletPlayer {
  rank: number;
  name: string;
  pos: string;   // QB, RB, WR, TE, K/PK, DEF/DST
  team?: string;  // NFL team abbreviation
  tier?: number;
}

/**
 * Standard JSON format that all bookmarklets output.
 * This is what gets pasted into the import textarea.
 */
export interface BookmarkletOutput {
  source: RankingSourceId;
  type: RankingType;
  exportedAt: string; // ISO 8601
  players: BookmarkletPlayer[];
  metadata?: {
    pageUrl?: string;
    totalPages?: number;
    currentPage?: number;
  };
}

// ---------------------------------------------------------------------------
// Stored rankings (what lives in localStorage after matching)
// ---------------------------------------------------------------------------

export interface StoredRankingEntry {
  rank: number;
  playerId: string | null;   // MFL player ID, null if unmatched
  playerName: string;         // Original name from source
  position: string;
  team: string;
  matched: boolean;
  confidence: number;         // 0-1, matching confidence
  tier?: number;
}

export interface StoredRankingImport {
  id: string;                  // UUID
  source: RankingSourceId;
  type: RankingType;
  importDate: string;          // ISO 8601
  rankings: StoredRankingEntry[];
  stats: {
    total: number;
    matched: number;
    unmatched: number;
    matchRate: number;         // percentage (0-100)
  };
  /**
   * True for the BUILT-IN sources the site supplies (MFL ADP, FantasySharks,
   * FantasyCalc, Sleeper, ESPN). They live in the same store as a user's own
   * imports so every consumer reads one list, but they are refreshed from the
   * build snapshot and cannot be deleted — unticking "My Rank" is the opt-out.
   */
  provided?: boolean;
  /** Snapshot stamp a provided import came from, used to detect staleness. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Site configuration (for rendering bookmarklet cards)
// ---------------------------------------------------------------------------

export interface BookmarkletSiteConfig {
  id: RankingSourceId;
  name: string;
  description: string;
  instructions: string;
  bookmarkletUri: string;      // javascript:... URI
  bookmarkletLabel: string;    // Drag label, e.g. "Export FantasyPros"
  requiresAuth: boolean;
  authNote?: string;           // e.g. "Requires DLF Premium subscription"
  defaultType: RankingType;
  difficulty: 'easy' | 'medium' | 'hard';
  links?: Array<{ url: string; label: string; type?: RankingType }>;  // Direct links to rankings pages
}

// ---------------------------------------------------------------------------
// MFL player (simplified for matching)
// ---------------------------------------------------------------------------

export interface MFLPlayerForMatching {
  id: string;
  name: string;
  position: string;
  team: string;
}

// ---------------------------------------------------------------------------
// Composite rank configuration (user-curated weighted subset)
// ---------------------------------------------------------------------------

/** A single import's inclusion in the composite rank with a weight multiplier. */
export interface CompositeImportConfig {
  importId: string;        // References StoredRankingImport.id
  /**
   * Relative influence in the weighted average. Any positive number.
   *
   * The UI presents these as PERCENTAGES, which works without converting
   * anything because the composite already divides by the total weight — a
   * source's real share is `weight / Σweight`. So weights that sum to 100 make
   * each number literally its percentage, and weights that don't still behave
   * sensibly (they're just normalized). That's what allows a deliberate
   * low-influence source, e.g. superflex at 5.
   *
   * Was `1 | 2 | 3`; existing stored values remain valid numbers.
   */
  weight: number;
}

/** Full composite rank configuration persisted in localStorage. */
export interface CompositeRankConfig {
  members: CompositeImportConfig[];
}

// ---------------------------------------------------------------------------
// Synced rankings payload (what gets stored in Redis per franchise)
// ---------------------------------------------------------------------------

/** Complete rankings state synced to Redis for cross-device access. */
export interface SyncedRankingsPayload {
  imports: StoredRankingImport[];
  compositeConfig: CompositeRankConfig | null;
  averagePosition: number;
  lastModified: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Built-in ranking sources (data/ranking-sources/<year>.json)
// ---------------------------------------------------------------------------

/** One built-in source as written by scripts/fetch-ranking-sources.mjs. */
export interface BuiltinRankingSource {
  id: string;
  label: string;
  type: RankingType;
  meta?: Record<string, unknown>;
  /** Already resolved to MFL player ids, ranked densely from 1. */
  players: { id: string; rank: number }[];
}

/** The whole snapshot file. */
export interface BuiltinRankingSnapshot {
  year: number;
  generatedAt: string;
  sources: BuiltinRankingSource[];
}
