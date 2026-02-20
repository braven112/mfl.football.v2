/**
 * Rankings Lookup — Shared Rankings API
 *
 * Reusable utility for consuming imported player rankings across any page.
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
import { getAllImports } from './rankings-storage';

// ---------------------------------------------------------------------------
// Labels & display constants
// ---------------------------------------------------------------------------

/** Full display names for each ranking source */
export const SOURCE_LABELS: Record<RankingSourceId, string> = {
  fantasypros: 'FantasyPros',
  cbs: 'CBS Sports',
  sleeper: 'Sleeper',
  nfl: 'NFL.com',
  keeptradecut: 'KeepTradeCut',
  dlf: 'DLF',
  yahoo: 'Yahoo',
  espn: 'ESPN',
  footballguys: 'FootballGuys',
  custom: 'Custom',
};

/** Short abbreviations for column headers (≤5 chars) */
export const SOURCE_ABBREVS: Record<RankingSourceId, string> = {
  fantasypros: 'FPros',
  cbs: 'CBS',
  sleeper: 'Sleep',
  nfl: 'NFL',
  keeptradecut: 'KTC',
  dlf: 'DLF',
  yahoo: 'Yahoo',
  espn: 'ESPN',
  footballguys: 'FBG',
  custom: 'Cust',
};

/** Short labels for ranking type */
export const TYPE_LABELS: Record<RankingType, string> = {
  dynasty: 'Dyn',
  redraft: 'Rdf',
  overall: 'All',
};

/**
 * Format a short column header for a ranking import.
 * e.g. "FBG Dyn", "KTC Rdf", "FPros All"
 */
export function formatColumnHeader(imp: StoredRankingImport): string {
  const abbrev = SOURCE_ABBREVS[imp.source] || imp.source;
  const type = TYPE_LABELS[imp.type] || imp.type;
  return `${abbrev} ${type}`;
}

/**
 * Format a full display name for a ranking import.
 * e.g. "FootballGuys Dynasty", "KeepTradeCut Redraft"
 */
export function formatFullName(imp: StoredRankingImport): string {
  const label = SOURCE_LABELS[imp.source] || imp.source;
  const typeLabel: Record<RankingType, string> = {
    dynasty: 'Dynasty',
    redraft: 'Redraft',
    overall: 'Overall',
  };
  return `${label} ${typeLabel[imp.type] || imp.type}`;
}

// ---------------------------------------------------------------------------
// Lookup map
// ---------------------------------------------------------------------------

export interface RankingColumn {
  importId: string;
  source: RankingSourceId;
  type: RankingType;
  header: string;       // Short header like "FBG Dyn"
  fullName: string;     // Full name like "FootballGuys Dynasty"
  playerCount: number;
  importDate: string;
}

export interface RankingLookup {
  /** Map<playerId, rank> for each import, keyed by import ID */
  byImport: Map<string, Map<string, number>>;
  /** Column metadata in display order (sorted by source name, then type) */
  columns: RankingColumn[];
}

/**
 * Build a RankingLookup from stored imports.
 *
 * If no imports array is passed, reads from localStorage via getAllImports().
 * Pre-builds Map<playerId, rank> for each import for O(1) lookups.
 * Only includes matched players (those with non-null playerId).
 */
export function buildRankingLookup(imports?: StoredRankingImport[]): RankingLookup {
  const allImports = imports ?? getAllImports();

  const byImport = new Map<string, Map<string, number>>();
  const columns: RankingColumn[] = [];

  for (const imp of allImports) {
    const playerMap = new Map<string, number>();

    for (const entry of imp.rankings) {
      if (entry.matched && entry.playerId) {
        playerMap.set(entry.playerId, entry.rank);
      }
    }

    byImport.set(imp.id, playerMap);

    columns.push({
      importId: imp.id,
      source: imp.source,
      type: imp.type,
      header: formatColumnHeader(imp),
      fullName: formatFullName(imp),
      playerCount: playerMap.size,
      importDate: imp.importDate,
    });
  }

  // Sort columns: by source name alphabetically, then by type (dynasty → overall → redraft)
  const typeOrder: Record<string, number> = { dynasty: 0, overall: 1, redraft: 2 };
  columns.sort((a, b) => {
    const sourceCompare = a.source.localeCompare(b.source);
    if (sourceCompare !== 0) return sourceCompare;
    return (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
  });

  return { byImport, columns };
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
 * Subscribe to ranking changes (same-tab and cross-tab).
 *
 * Listens for:
 * - 'rankingsUpdated' CustomEvent (dispatched by rankings-storage.ts on save/delete)
 * - 'storage' event (cross-tab localStorage changes)
 *
 * Returns an unsubscribe function for cleanup.
 */
export function onRankingsChanged(callback: () => void): () => void {
  const handleCustomEvent = () => callback();

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === 'rankings.imports') {
      callback();
    }
  };

  window.addEventListener('rankingsUpdated', handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener('rankingsUpdated', handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}
