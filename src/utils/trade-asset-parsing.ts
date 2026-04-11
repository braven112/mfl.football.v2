/**
 * Shared utilities for parsing and formatting MFL trade asset strings.
 * Used by PendingTradeCard, TradeBuilder, and TradeConfirmationModal.
 */

import type { TradeBuilderTeam, DraftPickKey } from '../types/trade-builder';

export interface ParsedAssets {
  playerIds: string[];
  draftPicks: string[];
  blindBid: number | null;
}

/** Parse MFL asset string into player IDs, draft pick codes, and blind bid amount */
export function parseAssets(assetString: string): ParsedAssets {
  const playerIds: string[] = [];
  const draftPicks: string[] = [];
  let blindBid: number | null = null;

  if (!assetString) return { playerIds, draftPicks, blindBid };

  const parts = assetString.split(',').filter(Boolean);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('FP_') || trimmed.startsWith('DP_')) {
      draftPicks.push(trimmed);
    } else if (trimmed.startsWith('BB_')) {
      blindBid = parseFloat(trimmed.replace('BB_', ''));
    } else if (/^\d+$/.test(trimmed)) {
      playerIds.push(trimmed);
    }
  }
  return { playerIds, draftPicks, blindBid };
}

/** Format a draft pick code (FP_ or DP_) to human-readable form */
export function formatPickCode(code: string, allTeams: TradeBuilderTeam[]): string {
  if (code.startsWith('FP_')) {
    const parts = code.split('_');
    const franchise = parts[1];
    const year = parts[2];
    const round = parts[3];
    const team = allTeams.find(t => t.franchiseId === franchise);
    const via = team ? ` (via ${team.abbrev || team.nameShort})` : '';
    return `${year} Rd ${round}${via}`;
  }
  if (code.startsWith('DP_')) {
    // DP_ format: DP_{round-1}_{pick-1} (both zero-indexed)
    const parts = code.split('_');
    const round = parseInt(parts[1], 10) + 1;
    const pickInRound = parts[2] != null ? parseInt(parts[2], 10) + 1 : null;
    return pickInRound ? `Current Rd ${round}, Pick ${pickInRound}` : `Current Rd ${round}`;
  }
  return code;
}

/** Parse FP_ code into a DraftPickKey for loading into the trade builder */
export function parseFpCode(code: string): DraftPickKey | null {
  if (!code.startsWith('FP_')) return null;
  const segments = code.split('_');
  if (segments.length < 4) return null;
  return {
    originalPickFor: segments[1],
    year: segments[2],
    round: segments[3],
  };
}

/**
 * Parse DP_ code into a DraftPickKey using a reverse lookup map.
 * DP_ codes identify current-year draft picks by slot (DP_{round-1}_{pick-1}).
 * The reverse map is built from draftResults data at page load time.
 */
export function parseDpCode(
  code: string,
  reverseMap?: Record<string, { year: string; round: string; originalPickFor: string }>
): DraftPickKey | null {
  if (!code.startsWith('DP_')) return null;
  if (!reverseMap) return null;
  const entry = reverseMap[code];
  if (!entry) return null;
  return { year: entry.year, round: entry.round, originalPickFor: entry.originalPickFor };
}

/**
 * Build the MFL asset string from player IDs and draft picks.
 * Players are numeric IDs, future picks are FP_{franchise}_{year}_{round},
 * current-year picks are DP_{round-1}_{pick-1} (zero-indexed).
 *
 * @param dpMap - Optional map from "{year}-{round}-{originalPickFor}" to DP_ code.
 *   When a pick is found in this map, the DP_ code is used instead of FP_ format.
 *   This is required for current-year picks that MFL no longer tracks as "future".
 */
export function buildMflAssetString(
  playerIds: string[],
  draftPicks: DraftPickKey[],
  dpMap?: Record<string, string>
): string {
  const parts: string[] = [...playerIds];
  for (const pick of draftPicks) {
    const dpKey = `${pick.year}-${pick.round}-${pick.originalPickFor}`;
    const dpCode = dpMap?.[dpKey];
    if (dpCode) {
      parts.push(dpCode);
    } else {
      parts.push(`FP_${pick.originalPickFor}_${pick.year}_${pick.round}`);
    }
  }
  return parts.join(',');
}

/** Format a unix timestamp to relative time (e.g. "5m ago", "2h ago") */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
