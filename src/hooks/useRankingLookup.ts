/**
 * useRankingLookup — React hook for client-side ranking lookups.
 *
 * Builds a RankingLookup from localStorage imports on mount,
 * and subscribes to ranking changes (same-tab + cross-tab).
 * Gated by `enabled` to avoid unnecessary work for non-admin users.
 */

import { useState, useEffect } from 'react';
import {
  buildRankingLookup,
  onRankingsChanged,
  type RankingLookup,
} from '../utils/rankings-lookup';

export function useRankingLookup(enabled: boolean): RankingLookup | null {
  const [lookup, setLookup] = useState<RankingLookup | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLookup(buildRankingLookup());
    return onRankingsChanged(() => {
      setLookup(buildRankingLookup());
    });
  }, [enabled]);

  return lookup;
}
