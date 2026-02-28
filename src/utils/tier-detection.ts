/**
 * Tier Detection
 *
 * Auto-detects tier breaks from rank gaps in the composite data.
 * Also supports importing tiers from sources that provide them (e.g., KTC).
 */

import type { TierBreak } from '../types/custom-rankings';

/**
 * Auto-detect tier breaks based on gaps between adjacent composite ranks.
 *
 * Algorithm:
 * 1. Calculate the gap between each adjacent pair of players
 * 2. Find the median gap
 * 3. Insert a tier break where the gap exceeds THRESHOLD * median AND gap > MIN_GAP
 */
export function detectTierBreaks(
  rankedPlayerIds: string[],
  compositeRanks: Map<string, number>,
  threshold: number = 2.5,
  minGap: number = 2,
): TierBreak[] {
  if (rankedPlayerIds.length < 3) return [];

  // Calculate gaps between adjacent players
  const gaps: number[] = [0]; // First element has no gap
  for (let i = 1; i < rankedPlayerIds.length; i++) {
    const prevRank = compositeRanks.get(rankedPlayerIds[i - 1]) ?? 0;
    const currRank = compositeRanks.get(rankedPlayerIds[i]) ?? 0;
    gaps.push(currRank - prevRank);
  }

  // Calculate median gap (excluding first element which is 0)
  const sortedGaps = gaps.slice(1).sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

  // If median gap is 0 (all same rank), no tiers can be detected
  if (medianGap <= 0) return [];

  const tierBreaks: TierBreak[] = [];
  for (let i = 1; i < gaps.length; i++) {
    if (gaps[i] > medianGap * threshold && gaps[i] > minGap) {
      tierBreaks.push({
        afterPlayerId: rankedPlayerIds[i - 1],
        source: 'auto',
      });
    }
  }

  return tierBreaks;
}

/**
 * Extract tier breaks from imported ranking sources that provide tier data.
 * Tiers are detected by watching for changes in the tier number between
 * adjacent players in the ranked list.
 */
export function extractImportedTiers(
  rankedPlayerIds: string[],
  playerTiers: Map<string, number>,
): TierBreak[] {
  if (rankedPlayerIds.length < 2) return [];

  const tierBreaks: TierBreak[] = [];

  for (let i = 1; i < rankedPlayerIds.length; i++) {
    const prevTier = playerTiers.get(rankedPlayerIds[i - 1]);
    const currTier = playerTiers.get(rankedPlayerIds[i]);

    if (prevTier != null && currTier != null && currTier !== prevTier) {
      tierBreaks.push({
        afterPlayerId: rankedPlayerIds[i - 1],
        label: `Tier ${currTier}`,
        source: 'imported',
      });
    }
  }

  return tierBreaks;
}

/**
 * Merge multiple tier break sources, preferring imported over auto-detected.
 * If an imported tier and auto tier share the same afterPlayerId, the imported one wins.
 */
export function mergeTierBreaks(
  autoTiers: TierBreak[],
  importedTiers: TierBreak[],
  manualTiers: TierBreak[] = [],
): TierBreak[] {
  const byPlayer = new Map<string, TierBreak>();

  // Auto-detected tiers first (lowest priority)
  for (const tier of autoTiers) {
    byPlayer.set(tier.afterPlayerId, tier);
  }

  // Imported tiers override auto
  for (const tier of importedTiers) {
    byPlayer.set(tier.afterPlayerId, tier);
  }

  // Manual tiers override everything
  for (const tier of manualTiers) {
    byPlayer.set(tier.afterPlayerId, tier);
  }

  return Array.from(byPlayer.values());
}
