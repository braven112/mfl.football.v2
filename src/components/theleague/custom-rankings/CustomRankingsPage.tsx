/**
 * CustomRankingsPage — main orchestrator for custom rankings.
 *
 * Handles:
 * - Loading composite data from localStorage
 * - Loading/saving state from Vercel KV via /api/cr
 * - Enriching player IDs with MFL player data
 * - Drag-and-drop reordering with override tracking
 * - Position filtering
 * - Debounced auto-save
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import RankingList from './RankingList';
import PositionFilter from './PositionFilter';
import SaveIndicator from './SaveIndicator';
import type { SaveStatus } from './SaveIndicator';
import {
  buildCompositePlayerList,
  mergeWithOverrides,
} from '../../../utils/custom-rankings-seeding';
import {
  loadCustomRankings,
  saveCustomRankings,
} from '../../../utils/custom-rankings-storage';
import { detectTierBreaks } from '../../../utils/tier-detection';
import type {
  CustomRankingsState,
  RankedPlayer,
  PositionFilter as PositionFilterType,
  TierBreak,
  MFLPlayerBasic,
} from '../../../types/custom-rankings';

interface MFLPlayerWithEspn extends MFLPlayerBasic {
  espnId: string | null;
}

interface Props {
  mflPlayersJson: string;
  franchiseId: string;
}

const DEFAULT_HEADSHOT =
  'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

function getHeadshotUrl(playerId: string, espnId: string | null): string {
  if (espnId) {
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnId}.png&w=96&h=70&cb=1`;
  }
  return `https://www49.myfantasyleague.com/player_photos_big_2014/${playerId}_thumb.jpg`;
}

export default function CustomRankingsPage({ mflPlayersJson, franchiseId }: Props) {
  const mflPlayers: MFLPlayerWithEspn[] = useMemo(
    () => JSON.parse(mflPlayersJson),
    [mflPlayersJson],
  );

  // Build lookup maps once
  const playerById = useMemo(() => {
    const map = new Map<string, MFLPlayerWithEspn>();
    for (const p of mflPlayers) {
      map.set(p.id, p);
    }
    return map;
  }, [mflPlayers]);

  const [rankings, setRankings] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [tiers, setTiers] = useState<TierBreak[]>([]);
  const [compositeHash, setCompositeHash] = useState('');
  const [compositeMap, setCompositeMap] = useState<Map<string, number>>(new Map());
  const [positionFilter, setPositionFilter] = useState<PositionFilterType>('ALL');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSaved, setLastSaved] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<CustomRankingsState | null>(null);

  // --- Load data on mount ---
  useEffect(() => {
    async function initialize() {
      // 1. Build composite from localStorage
      const composite = buildCompositePlayerList();
      if (!composite) {
        setIsEmpty(true);
        setLoading(false);
        return;
      }

      setCompositeMap(composite.compositeMap);
      setCompositeHash(composite.hash);

      // 2. Load saved state from KV
      const saved = await loadCustomRankings();

      if (saved && saved.sourceCompositeHash === composite.hash) {
        // Hash matches — use saved state directly
        setRankings(saved.rankings);
        setOverrides(new Set(saved.overrides));
        setTiers(saved.tiers);
        setLastSaved(saved.lastModified);
      } else if (saved && saved.sourceCompositeHash !== composite.hash) {
        // Stale — merge overrides into new composite
        const merged = mergeWithOverrides(composite.playerIds, saved);
        setRankings(merged.rankings);
        setOverrides(new Set(merged.overrides));
        // Re-detect tiers from fresh composite, preserve manual tiers
        const autoTiers = detectTierBreaks(merged.rankings, composite.compositeMap);
        const manualTiers = saved.tiers.filter((t) => t.source === 'manual');
        setTiers([...autoTiers, ...manualTiers]);
        setSaveStatus('unsaved');
      } else {
        // No saved state — seed from composite
        setRankings(composite.playerIds);
        const autoTiers = detectTierBreaks(composite.playerIds, composite.compositeMap);
        setTiers(autoTiers);
        setSaveStatus('unsaved');
      }

      setLoading(false);
    }

    initialize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Debounced auto-save ---
  const scheduleSave = useCallback(
    (state: CustomRankingsState) => {
      pendingStateRef.current = state;
      setSaveStatus('unsaved');

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const stateToSave = pendingStateRef.current;
        if (!stateToSave) return;

        setSaveStatus('saving');
        const success = await saveCustomRankings(stateToSave);
        if (success) {
          setSaveStatus('saved');
          setLastSaved(stateToSave.lastModified);
        } else {
          setSaveStatus('error');
        }
      }, 500);
    },
    [],
  );

  // Build the state object for saving
  const buildState = useCallback(
    (
      newRankings: string[],
      newOverrides: Set<string>,
      newTiers: TierBreak[],
    ): CustomRankingsState => ({
      version: 1,
      lastModified: new Date().toISOString(),
      sourceCompositeHash: compositeHash,
      rankings: newRankings,
      overrides: Array.from(newOverrides),
      tiers: newTiers,
    }),
    [compositeHash],
  );

  // --- Handlers ---
  const handleReorder = useCallback(
    (oldIndex: number, newIndex: number) => {
      // Map filtered indices back to overall rankings if position filter is active
      const filteredPlayers = getFilteredPlayers(rankings, positionFilter, playerById);
      const movedId = filteredPlayers[oldIndex]?.id;
      if (!movedId) return;

      const actualOldIndex = rankings.indexOf(movedId);
      const targetId = filteredPlayers[newIndex]?.id;
      if (!targetId) return;
      const actualNewIndex = rankings.indexOf(targetId);

      if (actualOldIndex === -1 || actualNewIndex === -1) return;

      const newRankings = arrayMove(rankings, actualOldIndex, actualNewIndex);
      const newOverrides = new Set(overrides);
      newOverrides.add(movedId);

      setRankings(newRankings);
      setOverrides(newOverrides);
      scheduleSave(buildState(newRankings, newOverrides, tiers));
    },
    [rankings, overrides, tiers, positionFilter, playerById, scheduleSave, buildState],
  );

  const handleRemoveTier = useCallback(
    (afterPlayerId: string) => {
      const newTiers = tiers.filter((t) => t.afterPlayerId !== afterPlayerId);
      setTiers(newTiers);
      scheduleSave(buildState(rankings, overrides, newTiers));
    },
    [tiers, rankings, overrides, scheduleSave, buildState],
  );

  const handleRenameTier = useCallback(
    (afterPlayerId: string, newLabel: string) => {
      const newTiers = tiers.map((t) =>
        t.afterPlayerId === afterPlayerId ? { ...t, label: newLabel } : t,
      );
      setTiers(newTiers);
      scheduleSave(buildState(rankings, overrides, newTiers));
    },
    [tiers, rankings, overrides, scheduleSave, buildState],
  );

  const handleAddTier = useCallback(() => {
    // Add a tier break after the last visible player
    const filtered = getFilteredPlayers(rankings, positionFilter, playerById);
    if (filtered.length < 2) return;

    const midpoint = Math.floor(filtered.length / 2);
    const afterId = filtered[midpoint - 1]?.id;
    if (!afterId) return;

    // Don't add duplicate
    if (tiers.some((t) => t.afterPlayerId === afterId)) return;

    const newTiers = [...tiers, { afterPlayerId: afterId, source: 'manual' as const }];
    setTiers(newTiers);
    scheduleSave(buildState(rankings, overrides, newTiers));
  }, [tiers, rankings, overrides, positionFilter, playerById, scheduleSave, buildState]);

  const handleReset = useCallback(() => {
    if (!confirm('Reset all rankings to composite order? This cannot be undone.')) return;

    const composite = buildCompositePlayerList();
    if (!composite) return;

    const autoTiers = detectTierBreaks(composite.playerIds, composite.compositeMap);
    setRankings(composite.playerIds);
    setOverrides(new Set());
    setTiers(autoTiers);
    setCompositeMap(composite.compositeMap);
    scheduleSave(buildState(composite.playerIds, new Set(), autoTiers));
  }, [scheduleSave, buildState]);

  // --- Enriched player list ---
  const filteredPlayers = useMemo(
    () => getFilteredPlayers(rankings, positionFilter, playerById),
    [rankings, positionFilter, playerById],
  );

  const enrichedPlayers: RankedPlayer[] = useMemo(
    () =>
      filteredPlayers.map((p, index) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        nflTeam: p.team,
        headshot: getHeadshotUrl(p.id, p.espnId ?? null),
        compositeRank: compositeMap.get(p.id) ?? null,
        customRank: index + 1,
        isOverride: overrides.has(p.id),
      })),
    [filteredPlayers, compositeMap, overrides],
  );

  // Filter tiers to only show those visible in current position filter
  const visibleTiers = useMemo(() => {
    const visibleIds = new Set(filteredPlayers.map((p) => p.id));
    return tiers.filter((t) => visibleIds.has(t.afterPlayerId));
  }, [tiers, filteredPlayers]);

  // --- Position counts ---
  const positionCounts = useMemo(() => {
    const counts: Record<PositionFilterType, number> = {
      ALL: rankings.length,
      QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0,
    };
    for (const id of rankings) {
      const p = playerById.get(id);
      if (p) {
        const pos = p.position as PositionFilterType;
        if (pos in counts) counts[pos]++;
      }
    }
    return counts;
  }, [rankings, playerById]);

  // --- Render ---
  if (loading) {
    return (
      <div className="cr-page">
        <div className="cr-page__loading">Loading rankings...</div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="cr-page">
        <div className="cr-page__header">
          <h1 className="cr-page__title">Custom Rankings</h1>
        </div>
        <div className="cr-page__empty">
          <p>No composite rankings found.</p>
          <p>
            <a href="/theleague/import-rankings">Import rankings</a> and select
            at least 2 sources for "My Rank" to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-page">
      <div className="cr-page__header">
        <div className="cr-page__header-top">
          <h1 className="cr-page__title">Custom Rankings</h1>
          <div className="cr-page__actions">
            <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
            <button
              className="cr-btn cr-btn--sm"
              onClick={handleAddTier}
              type="button"
            >
              + Add Tier
            </button>
            <button
              className="cr-btn cr-btn--sm cr-btn--danger"
              onClick={handleReset}
              type="button"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="cr-page__subtitle">
          {overrides.size} override{overrides.size !== 1 ? 's' : ''} ·{' '}
          {rankings.length} players
        </p>
      </div>

      <PositionFilter
        active={positionFilter}
        counts={positionCounts}
        onChange={setPositionFilter}
      />

      <RankingList
        players={enrichedPlayers}
        tiers={visibleTiers}
        onReorder={handleReorder}
        onRemoveTier={handleRemoveTier}
        onRenameTier={handleRenameTier}
      />
    </div>
  );
}

// --- Helpers ---

function getFilteredPlayers(
  rankings: string[],
  filter: PositionFilterType,
  playerById: Map<string, MFLPlayerWithEspn>,
): MFLPlayerWithEspn[] {
  const result: MFLPlayerWithEspn[] = [];
  for (const id of rankings) {
    const player = playerById.get(id);
    if (!player) continue;
    if (filter === 'ALL' || player.position === filter) {
      result.push(player);
    }
  }
  return result;
}
