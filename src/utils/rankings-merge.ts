export interface RankingEntry {
  rank: number;
  playerId: string;
  playerName?: string;
}

/**
 * Merge two ranking sources with weights.
 * Falls back to the lower (better) rank if one source is missing.
 */
export function mergeRanks(
  sourceA: RankingEntry[],
  sourceB: RankingEntry[],
  weightA: number = 0.5,
  weightB: number = 0.5
): Map<string, number> {
  const mapA = new Map<string, number>();
  sourceA.forEach((r) => mapA.set(r.playerId, r.rank));

  const mapB = new Map<string, number>();
  sourceB.forEach((r) => mapB.set(r.playerId, r.rank));

  const allIds = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const result = new Map<string, number>();

  allIds.forEach((id) => {
    const a = mapA.get(id);
    const b = mapB.get(id);
    if (a !== undefined && b !== undefined) {
      const merged = a * weightA + b * weightB;
      result.set(id, merged);
    } else if (a !== undefined) {
      result.set(id, a);
    } else if (b !== undefined) {
      result.set(id, b);
    }
  });

  return result;
}
