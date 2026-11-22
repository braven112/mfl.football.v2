/**
 * Rankings Lookup — Shared Rankings API
 *
 * The one "My Rank" column every rankings surface reads (my-ranks-client.ts).
 * Works in both vanilla JS <script> blocks and React components.
 *
 * Usage pattern:
 *   import { buildRankingLookup, onRankingsChanged } from '../utils/rankings-lookup';
 *
 *   let lookup = buildRankingLookup();
 *   // lookup.columns → column metadata for <th> rendering
 *   // lookup.byImport.get(importId)?.get(playerId) → rank number
 *
 *   const unsubscribe = onRankingsChanged(() => {
 *     lookup = buildRankingLookup();
 *     rerender();
 *   });
 *
 * See docs/claude/insights/features/rankings-integration.md for full integration guide.
 */

import type {
  RankingSourceId,
  RankingType,
  StoredRankingImport,
} from '../types/rankings-import';
import { myRankList } from './my-ranks-client';
import type { MyRankKind } from './my-ranks';

/** Synthetic importId used for the computed average rank column. */
export const AVERAGE_IMPORT_ID = '__average__';

/** Synthetic importId used for the user-curated composite rank column. */
export const COMPOSITE_IMPORT_ID = '__composite__';

// ---------------------------------------------------------------------------
// Labels & display constants
// ---------------------------------------------------------------------------

/** Full display names for each ranking source */
export const SOURCE_LABELS: Record<RankingSourceId, string> = {
  fantasypros: 'FantasyPros',
  cbs: 'CBS Sports',
  sleeper: 'Sleeper',
  fantasycalc: 'FantasyCalc',
  espn: 'ESPN',
  keeptradecut: 'KeepTradeCut',
  dlf: 'DLF',
  yahoo: 'Yahoo',
  footballguys: 'FootballGuys',
  'mfl-adp': 'MFL ADP',
  sharks: 'FantasySharks',
  // Built-in variants are distinct sources, not the same source twice: the
  // Sleeper built-in is build-time matched (the old one-click card was not),
  // and superflex is a different board from ESPN's PPR ranks.
  'sleeper-adp': 'Sleeper',
  'espn-superflex': 'ESPN Superflex',
  custom: 'Custom',
};

/** Short abbreviations for column headers (≤5 chars) */
export const SOURCE_ABBREVS: Record<RankingSourceId, string> = {
  'mfl-adp': 'MFL',
  sharks: 'Shrks',
  'sleeper-adp': 'Sleep',
  'espn-superflex': 'ESPNS',
  fantasypros: 'FPros',
  cbs: 'CBS',
  sleeper: 'Sleep',
  fantasycalc: 'FCalc',
  espn: 'ESPN',
  keeptradecut: 'KTC',
  dlf: 'DLF',
  yahoo: 'Yahoo',
  footballguys: 'FBG',
  custom: 'Cust',
};

/** Short labels for ranking type */
export const TYPE_LABELS: Record<RankingType, string> = {
  dynasty: 'Dyn',
  redraft: 'Rdf',
  adp: 'ADP',
  overall: 'All',
};

/**
 * Format a short column header for a ranking import.
 * Dynasty is the assumed default — just the source abbreviation (e.g. "FBG").
 * Redraft is marked with ® (e.g. "FBG ®").
 * Other types append a short label (e.g. "FBG ADP").
 */
export function formatColumnHeader(imp: StoredRankingImport): string {
  const abbrev = SOURCE_ABBREVS[imp.source] || imp.source;
  if (imp.type === 'dynasty') return abbrev;
  if (imp.type === 'redraft') return `${abbrev} ®`;
  const type = TYPE_LABELS[imp.type] || imp.type;
  return `${abbrev} ${type}`;
}

/** Long labels for ranking type, used by {@link formatFullName}. */
const FULL_TYPE_LABELS: Record<RankingType, string> = {
  dynasty: 'Dynasty',
  redraft: 'Redraft',
  adp: 'ADP',
  overall: 'Overall',
};

/**
 * Format a full display name for a ranking import.
 * e.g. "FootballGuys Dynasty", "KeepTradeCut Redraft"
 *
 * A source label may already carry the type ('MFL ADP' reads wrong as just
 * 'MFL' in the standalone spots that print SOURCE_LABELS on its own), so drop
 * the suffix when it would only repeat the label's last word — otherwise the
 * My Rank editor lists "MFL ADP ADP".
 */
export function formatFullName(imp: StoredRankingImport): string {
  const label = SOURCE_LABELS[imp.source] || imp.source;
  const type = FULL_TYPE_LABELS[imp.type] || imp.type;
  if (label.toLowerCase().endsWith(` ${type.toLowerCase()}`)) return label;
  return `${label} ${type}`;
}

// ---------------------------------------------------------------------------
// Lookup map
// ---------------------------------------------------------------------------

export interface RankingColumn {
  importId: string;
  source: RankingSourceId;
  type: RankingType;
  header: string;       // Short header like "FBG" or "Avg"
  fullName: string;     // Full name like "FootballGuys Dynasty"
  playerCount: number;
  importDate: string;
  /** True only for the synthetic average rank column */
  isAverage?: boolean;
  /** True only for the synthetic "My Rank" composite column */
  isComposite?: boolean;
  /** True for the site owner's own list (my-ranks.ts) standing in as My Rank */
  isOwnerList?: boolean;
  /** True for imports that are members of the active composite */
  isCompositeMember?: boolean;
  /** True for the last (rightmost) composite member — used for border styling */
  isLastCompositeMember?: boolean;
}

export interface RankingLookup {
  /** Map<playerId, rank> for each import, keyed by import ID */
  byImport: Map<string, Map<string, number>>;
  /** Column metadata in user-defined display order (controlled by drag-and-drop) */
  columns: RankingColumn[];
}

export interface RankingLookupOptions {
  /**
   * Which of the site owner's lists this surface wants (src/utils/my-ranks.ts):
   * Set Lineup asks for `week`, contract pages for `contract`, and so on.
   * Every other viewer gets the one default board whatever the kind.
   */
  kind?: MyRankKind;
}

/**
 * The "My Rank" lookup for this viewer: one column, keyed by
 * COMPOSITE_IMPORT_ID because every surface that reads My Rank (trade
 * builder, keeper sort, contract pages) asks for it by that id.
 *
 * Owners get FantasySharks everywhere; the site owner gets his own list for
 * the page's kind (Brandon, 2026-11-22). Empty while it loads, or off the
 * league pages, and the `rankingsUpdated` event announces its arrival.
 */
export function buildRankingLookup(options: RankingLookupOptions = {}): RankingLookup {
  const list = myRankList(options.kind ?? 'season');
  if (!list || list === 'loading') return { byImport: new Map(), columns: [] };
  const map = new Map(Object.entries(list.ranks));
  if (map.size === 0) return { byImport: new Map(), columns: [] };
  return {
    byImport: new Map([[COMPOSITE_IMPORT_ID, map]]),
    columns: [
      {
        importId: COMPOSITE_IMPORT_ID,
        source: 'custom',
        type: 'overall',
        header: 'My Rank',
        fullName: `My Rank · ${list.label}`,
        playerCount: map.size,
        importDate: '',
        isComposite: true,
        isOwnerList: true,
      },
    ],
  };
}

/**
 * Get a player's rank from a specific import.
 * Returns null if the player is not ranked in that import.
 */
export function getPlayerRank(
  lookup: RankingLookup,
  playerId: string,
  importId: string,
): number | null {
  return lookup.byImport.get(importId)?.get(playerId) ?? null;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

/**
 * Subscribe to ranking changes: the `rankingsUpdated` event my-ranks-client
 * fires when a list arrives (or the owner's Blend slider moves).
 * Returns an unsubscribe function for cleanup.
 */
export function onRankingsChanged(callback: () => void): () => void {
  const handle = () => callback();
  window.addEventListener('rankingsUpdated', handle);
  return () => window.removeEventListener('rankingsUpdated', handle);
}
