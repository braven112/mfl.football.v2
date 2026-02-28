/**
 * Custom Rankings Seeding
 *
 * Bridges the localStorage-based composite "My Rank" rankings
 * to the custom rankings feature. Extracts sorted player IDs,
 * computes a hash for staleness detection, and merges overrides
 * when the composite config changes.
 */

import { buildRankingLookup, COMPOSITE_IMPORT_ID } from './rankings-lookup';
import { getCompositeConfig } from './rankings-storage';
import type { CustomRankingsState } from '../types/custom-rankings';

export interface CompositePlayerList {
  /** Player IDs sorted by composite rank (ascending) */
  playerIds: string[];
  /** Map of playerId → composite rank number */
  compositeMap: Map<string, number>;
  /** Deterministic hash for staleness detection */
  hash: string;
}

/**
 * Compute a deterministic hash from the composite config.
 * Changes when members are added/removed, weights change, or player count changes.
 */
export function computeCompositeHash(playerCount: number): string {
  const config = getCompositeConfig();
  if (!config) return 'no-composite';

  // Sort members deterministically by importId
  const sorted = [...config.members]
    .sort((a, b) => a.importId.localeCompare(b.importId))
    .map((m) => `${m.importId}:${m.weight}`)
    .join(',');

  return `${sorted}|${playerCount}`;
}

/**
 * Build the composite player list from localStorage imports.
 * Returns null if no composite exists (fewer than 2 members selected).
 */
export function buildCompositePlayerList(): CompositePlayerList | null {
  const lookup = buildRankingLookup();
  const compositeMap = lookup.byImport.get(COMPOSITE_IMPORT_ID);

  if (!compositeMap || compositeMap.size === 0) {
    return null;
  }

  // Sort player IDs by composite rank (ascending)
  const entries = Array.from(compositeMap.entries());
  entries.sort((a, b) => a[1] - b[1]);
  const playerIds = entries.map(([id]) => id);

  const hash = computeCompositeHash(compositeMap.size);

  return { playerIds, compositeMap, hash };
}

/**
 * Merge saved overrides into a new composite order.
 *
 * When the composite hash is stale (imports changed), this function:
 * 1. Starts with the fresh composite order
 * 2. For each override player, preserves their relative position
 *    among other overridden players
 * 3. Returns a merged list that respects both the new composite
 *    and the user's manual adjustments
 */
export function mergeWithOverrides(
  newCompositeIds: string[],
  savedState: CustomRankingsState,
): { rankings: string[]; overrides: string[] } {
  const savedOverrides = new Set(savedState.overrides);
  const savedOrder = savedState.rankings;

  // If no overrides, just use the new composite order
  if (savedOverrides.size === 0) {
    return { rankings: newCompositeIds, overrides: [] };
  }

  const newCompositeSet = new Set(newCompositeIds);

  // Filter out overrides for players that no longer exist in composite
  const validOverrides = savedState.overrides.filter((id) =>
    newCompositeSet.has(id),
  );
  const validOverrideSet = new Set(validOverrides);

  // Start with the new composite order, minus overridden players
  const baseList = newCompositeIds.filter((id) => !validOverrideSet.has(id));

  // Get the overridden players in their saved order
  const overriddenInOrder = savedOrder.filter(
    (id) => validOverrideSet.has(id) && newCompositeSet.has(id),
  );

  // For each overridden player, find where they should be inserted.
  // Strategy: find the player that was directly before them in saved order
  // and insert after that player in the new list.
  const result = [...baseList];

  for (const overrideId of overriddenInOrder) {
    const savedIdx = savedOrder.indexOf(overrideId);

    // Find the nearest non-override neighbor above in saved order
    let insertAfter = -1;
    for (let i = savedIdx - 1; i >= 0; i--) {
      const neighborId = savedOrder[i];
      const neighborIdx = result.indexOf(neighborId);
      if (neighborIdx !== -1) {
        insertAfter = neighborIdx;
        break;
      }
    }

    // Insert after the found neighbor (or at the beginning if none found)
    result.splice(insertAfter + 1, 0, overrideId);
  }

  return { rankings: result, overrides: validOverrides };
}
