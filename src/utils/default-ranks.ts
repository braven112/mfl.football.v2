/**
 * The default "My Rank" board every owner gets (Brandon, 2026-11-22):
 * FantasySharks, every league, every page. Pure, so the API and the tests
 * share it.
 */

import type { MyRankList } from './my-ranks';

/** The built-in source id (data/ranking-sources/<year>.json) every owner sees. */
export const DEFAULT_RANK_SOURCE = 'sharks';

/** Tooltip label: the column reads "My Rank · FantasySharks". */
export const DEFAULT_RANK_LABEL = 'FantasySharks';

interface SnapshotSource {
  id?: string;
  players?: Array<{ id?: string; rank?: number }>;
}

/** Pull the default board out of a ranking-sources snapshot. Empty when it is missing. */
export function defaultRankList(snapshot: { sources?: SnapshotSource[] } | null | undefined): MyRankList {
  const source = snapshot?.sources?.find((s) => s?.id === DEFAULT_RANK_SOURCE);
  const ranks: Record<string, number> = {};
  for (const p of source?.players ?? []) {
    if (p?.id && typeof p.rank === 'number' && Number.isFinite(p.rank) && !(p.id in ranks)) {
      ranks[p.id] = p.rank;
    }
  }
  return { label: DEFAULT_RANK_LABEL, ranks };
}
