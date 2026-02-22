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
import { getAllImports, getAveragePosition } from './rankings-storage';

/** Synthetic importId used for the computed average rank column. */
export const AVERAGE_IMPORT_ID = '__average__';

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
  custom: 'Custom',
};

/** Short abbreviations for column headers (≤5 chars) */
export const SOURCE_ABBREVS: Record<RankingSourceId, string> = {
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

/**
 * Format a full display name for a ranking import.
 * e.g. "FootballGuys Dynasty", "KeepTradeCut Redraft"
 */
export function formatFullName(imp: StoredRankingImport): string {
  const label = SOURCE_LABELS[imp.source] || imp.source;
  const typeLabel: Record<RankingType, string> = {
    dynasty: 'Dynasty',
    redraft: 'Redraft',
    adp: 'ADP',
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
  header: string;       // Short header like "FBG" or "Avg"
  fullName: string;     // Full name like "FootballGuys Dynasty"
  playerCount: number;
  importDate: string;
  /** True only for the synthetic average rank column */
  isAverage?: boolean;
}

export interface RankingLookup {
  /** Map<playerId, rank> for each import, keyed by import ID */
  byImport: Map<string, Map<string, number>>;
  /** Column metadata in user-defined display order (controlled by drag-and-drop) */
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

  // Column order matches the user-defined array order from localStorage
  // (controlled by drag-and-drop in ManageImportsSection)

  // Compute average rank column when 2+ imports exist
  if (allImports.length >= 2) {
    const averageMap = new Map<string, number>();

    // Collect all unique player IDs across all imports
    const allPlayerIds = new Set<string>();
    for (const [, playerMap] of byImport) {
      for (const playerId of playerMap.keys()) {
        allPlayerIds.add(playerId);
      }
    }

    // For each player, average only the imports where they appear
    for (const playerId of allPlayerIds) {
      let sum = 0;
      let count = 0;
      for (const [, playerMap] of byImport) {
        const rank = playerMap.get(playerId);
        if (rank != null) {
          sum += rank;
          count++;
        }
      }
      if (count > 0) {
        averageMap.set(playerId, Math.round(sum / count));
      }
    }

    byImport.set(AVERAGE_IMPORT_ID, averageMap);

    // Insert the average column at the user-configured position
    const avgColumn: RankingColumn = {
      importId: AVERAGE_IMPORT_ID,
      source: 'custom',
      type: 'overall',
      header: 'Avg',
      fullName: 'Average Rank',
      playerCount: averageMap.size,
      importDate: new Date().toISOString(),
      isAverage: true,
    };

    const storedPosition = getAveragePosition();
    // Clamp to valid range [0, columns.length]
    const insertAt = Math.max(0, Math.min(storedPosition, columns.length));
    columns.splice(insertAt, 0, avgColumn);
  }

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
