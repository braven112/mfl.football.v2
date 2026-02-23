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
  weight: 1 | 2 | 3;      // Multiplier for weighted average
}

/** Full composite rank configuration persisted in localStorage. */
export interface CompositeRankConfig {
  members: CompositeImportConfig[];
}
