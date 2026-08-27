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
import '../../../styles/loading.css';
import RankingList from './RankingList';
import PositionFilter from './PositionFilter';
import SaveIndicator from './SaveIndicator';
import DraftListSync from './DraftListSync';
import type { SaveStatus } from './SaveIndicator';
import {
  buildCompositePlayerList,
  mergeWithOverrides,
} from '../../../utils/custom-rankings-seeding';
import { syncBuiltinImports, initFromServer } from '../../../utils/rankings-storage';
import {
  loadCustomRankings,
  saveCustomRankings,
} from '../../../utils/custom-rankings-storage';
import { detectTierBreaks } from '../../../utils/tier-detection';
import { getPlayerImageUrl } from '../../../constants/roster-constants';
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

interface VORPData {
  vorpPoints: number;
  vorpDollar: number;
}

interface Props {
  mflPlayersJson: string;
  franchiseId: string;
  vorpMapJson?: string;
  /**
   * Prefixed internal route to THIS league's Import Rankings page. Resolved by
   * the Astro page — this island can't know which league it's on, and a
   * hardcoded `/theleague/import-rankings` sends an AFL admin to the page that
   * feeds the other league's board.
   */
  importRankingsHref?: string;
  /**
   * Build-time snapshot of the built-in ranking sources, as JSON.
   *
   * The board reconciles it on mount for the same reason Import Rankings
   * does — but here it is load-bearing rather than a convenience: it is the
   * only thing that gives a first-time owner a board to push. Before this,
   * `syncBuiltinImports` ran on the Import Rankings page and nowhere else, so
   * an owner who came straight here had no composite, an empty board, and no
   * way to build a draft list at all.
   */
  builtinSnapshotJson?: string | null;
  /** Built-in source ids this league ticks on by default (registry-driven). */
  defaultSourceIds?: string[];
  /**
   * Player ids this franchise can actually draft, resolved on the server —
   * the league's draftPlayerPool intersected with players not rostered in
   * THIS owner's conference. Null means the feeds could not be trusted, and
   * the filter is hidden rather than shown hiding the wrong players.
   */
  availableIdsJson?: string | null;
  /** MFL's draftPlayerPool, for labelling the filter honestly. */
  draftPool?: string | null;
  /** True when availability was scoped per conference (the AFL). */
  availabilityPerConference?: boolean;
}

// ESPN headshots are preferred; getPlayerImageUrl() (roster-constants.ts)
// supplies the MFL fallback — it's the canonical URL builder pinned to the
// DEFAULT league's registry host, carrying the "www44 was never verified to
// serve photos" rationale in one place instead of a second hand-rolled copy.
function getHeadshotUrl(playerId: string, espnId: string | null): string {
  if (espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return getPlayerImageUrl(playerId);
}

export default function CustomRankingsPage({
  mflPlayersJson,
  franchiseId,
  vorpMapJson,
  importRankingsHref = '/theleague/import-rankings',
  builtinSnapshotJson = null,
  defaultSourceIds = [],
  availableIdsJson = null,
  draftPool = null,
  availabilityPerConference = false,
}: Props) {
  const mflPlayers: MFLPlayerWithEspn[] = useMemo(
    () => JSON.parse(mflPlayersJson),
    [mflPlayersJson],
  );

  const vorpMap: Record<string, VORPData> = useMemo(
    () => (vorpMapJson ? JSON.parse(vorpMapJson) : {}),
    [vorpMapJson],
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
  const [isEditing, setIsEditing] = useState(false);
  const [showVorp, setShowVorp] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);

  const availableIds = useMemo(() => {
    if (!availableIdsJson) return null;
    try {
      return new Set<string>(JSON.parse(availableIdsJson));
    } catch {
      return null;
    }
  }, [availableIdsJson]);

  // Rookie-only leagues say "Rookies"; an all-comers pool says "Available".
  const availableLabel = draftPool === 'Rookie' ? 'Rookies only' : 'Available only';

  /**
   * The pool the RENDERED list is currently built from, or null for the whole
   * board. Every caller of getFilteredPlayers must pass this same value: the
   * drag and tier-move handlers map a position in the visible list back onto
   * `rankings`, so a handler filtering differently than the list moves the
   * wrong player.
   */
  const activePool = availableOnly ? availableIds : null;
  const hasVorp = Object.keys(vorpMap).length > 0;

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<CustomRankingsState | null>(null);

  // --- Load data on mount ---
  useEffect(() => {
    async function initialize() {
      // 0. Reconcile the built-in ranking sources into this browser's store,
      //    then pull the owner's own imports from the server. Both are no-ops
      //    when nothing changed. This has to happen BEFORE the composite is
      //    read or a first-time owner gets `isEmpty` and a dead end.
      try {
        const snapshot = builtinSnapshotJson ? JSON.parse(builtinSnapshotJson) : null;
        const meta = new Map(
          mflPlayers.map((p) => [p.id, { name: p.name, position: p.position, team: p.team }]),
        );
        syncBuiltinImports(snapshot, defaultSourceIds, meta);
      } catch {
        // A bad snapshot must not take the board down — the owner may still
        // have their own imports, or a list on MFL to pull.
      }
      try {
        await initFromServer();
      } catch {
        /* server sync is best-effort; localStorage still stands */
      }

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

  // Cleanup pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

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
      const filteredPlayers = getFilteredPlayers(rankings, positionFilter, playerById, activePool);
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
    [rankings, overrides, tiers, positionFilter, playerById, activePool, scheduleSave, buildState],
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

  const handleMoveTier = useCallback(
    (afterPlayerId: string, direction: 'up' | 'down') => {
      const filtered = getFilteredPlayers(rankings, positionFilter, playerById, activePool);
      const currentIdx = filtered.findIndex((p) => p.id === afterPlayerId);
      if (currentIdx === -1) return;

      const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
      if (targetIdx < 0 || targetIdx >= filtered.length - 1) return;

      const newAfterId = filtered[targetIdx].id;
      // Don't move if a tier already exists at the target
      if (tiers.some((t) => t.afterPlayerId === newAfterId)) return;

      const newTiers = tiers.map((t) =>
        t.afterPlayerId === afterPlayerId ? { ...t, afterPlayerId: newAfterId } : t,
      );
      setTiers(newTiers);
      scheduleSave(buildState(rankings, overrides, newTiers));
    },
    [tiers, rankings, overrides, positionFilter, playerById, activePool, scheduleSave, buildState],
  );

  const handleAddTierAfter = useCallback(
    (afterPlayerId: string) => {
      // Don't add if a tier already exists after this player
      if (tiers.some((t) => t.afterPlayerId === afterPlayerId)) return;

      const newTiers = [...tiers, { afterPlayerId, source: 'manual' as const }];
      setTiers(newTiers);
      scheduleSave(buildState(rankings, overrides, newTiers));
    },
    [tiers, rankings, overrides, scheduleSave, buildState],
  );

  // --- MFL My Draft List sync ---
  // MFL is the source of truth for the draft list, so a pull REPLACES the
  // board rather than merging into it. Overrides are cleared with it: an
  // "override" means "I moved this off the composite," and after a pull every
  // position came from MFL, so keeping the old flags would mark the wrong
  // rows. Tiers are kept only where their anchor player survived the pull.
  const resolvePlayerName = useCallback(
    (id: string) => playerById.get(id)?.name ?? null,
    [playerById],
  );

  const handleDraftListPulled = useCallback(
    (playerIds: string[]) => {
      const keptTiers = tiers.filter((t) => playerIds.includes(t.afterPlayerId));
      setRankings(playerIds);
      setOverrides(new Set());
      setTiers(keptTiers);
      scheduleSave(buildState(playerIds, new Set(), keptTiers));
    },
    [tiers, scheduleSave, buildState],
  );

  // Two-tap rather than window.confirm: mobile privacy browsers suppress
  // native dialogs, which makes a suppressed confirm read as a cancel and the
  // button look broken. That silently killed the MFL push — see DraftListSync.
  const handleReset = useCallback(() => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);

    const composite = buildCompositePlayerList();
    if (!composite) return;

    const autoTiers = detectTierBreaks(composite.playerIds, composite.compositeMap);
    setRankings(composite.playerIds);
    setOverrides(new Set());
    setTiers(autoTiers);
    setCompositeMap(composite.compositeMap);
    scheduleSave(buildState(composite.playerIds, new Set(), autoTiers));
  }, [resetArmed, scheduleSave, buildState]);

  // --- Enriched player list ---
  const filteredPlayers = useMemo(
    () => getFilteredPlayers(rankings, positionFilter, playerById, activePool),
    [rankings, positionFilter, playerById, activePool],
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
        vorpPoints: showVorp ? (vorpMap[p.id]?.vorpPoints ?? null) : null,
      })),
    [filteredPlayers, compositeMap, overrides, showVorp, vorpMap],
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
    // Counted against the SAME availability filter the list uses — chips
    // reading the full board while the list shows a subset is just a lie.
    const pool = activePool;
    let total = 0;
    for (const id of rankings) {
      const p = playerById.get(id);
      if (!p) continue;
      if (pool && !pool.has(id)) continue;
      total++;
      const pos = p.position as PositionFilterType;
      if (pos in counts) counts[pos]++;
    }
    counts.ALL = total;
    return counts;
  }, [rankings, playerById, activePool]);

  // --- Render ---
  if (loading) {
    return (
      <div className="cr-page">
        <div
          className="loading-skeleton-group"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading rankings"
        >
          <span className="loading-skeleton loading-skeleton--title" />
          <span className="loading-skeleton" style={{ ['--skeleton-height' as any]: '3rem' }} />
          <span className="loading-skeleton" style={{ ['--skeleton-height' as any]: '3rem' }} />
          <span className="loading-skeleton" style={{ ['--skeleton-height' as any]: '3rem' }} />
          <span className="loading-skeleton" style={{ ['--skeleton-height' as any]: '3rem' }} />
          <span className="loading-skeleton" style={{ ['--skeleton-height' as any]: '3rem' }} />
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="cr-page">
        <div className="cr-page__header">
          <h1 className="cr-page__title">My Draft List</h1>
        </div>
        <div className="cr-page__empty">
          <p>No composite rankings found.</p>
          <p>
            <a href={importRankingsHref}>Import rankings</a> and select
            at least 2 sources for "My Rank" to get started — or pull the draft
            list you already have on MFL and start from that.
          </p>
        </div>
        {/* Reachable with no composite ON PURPOSE: an owner who just wants
            their MFL board back should not have to build a composite first.
            Pulling seeds `rankings` directly, which clears this state. */}
        <DraftListSync
          rankings={rankings}
          resolveName={resolvePlayerName}
          onPulled={handleDraftListPulled}
          availableIds={availableIds}
          draftPool={draftPool}
        />
      </div>
    );
  }

  return (
    <div className="cr-page">
      <div className="cr-page__header">
        <div className="cr-page__header-top">
          <h1 className="cr-page__title">My Draft List</h1>
          <div className="cr-page__actions">
            <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
            <button
              className={`cr-btn cr-btn--sm${isEditing ? ' cr-btn--active' : ''}`}
              onClick={() => { setIsEditing((v) => !v); setResetArmed(false); }}
              type="button"
            >
              {isEditing ? 'Done' : 'Edit'}
            </button>
            {availableIds && (
              <button
                className={`cr-btn cr-btn--sm${availableOnly ? ' cr-btn--active' : ''}`}
                onClick={() => setAvailableOnly((v) => !v)}
                type="button"
                aria-pressed={availableOnly}
                title={
                  availabilityPerConference
                    ? 'Players you can draft — not rostered in your conference'
                    : 'Players you can draft — not on any roster'
                }
              >
                {availableLabel}
              </button>
            )}
            {hasVorp && (
              <button
                className={`cr-btn cr-btn--sm${showVorp ? ' cr-btn--active' : ''}`}
                onClick={() => setShowVorp((v) => !v)}
                type="button"
              >
                VORP
              </button>
            )}
            {isEditing && (
              <button
                className="cr-btn cr-btn--sm cr-btn--danger"
                onClick={handleReset}
                type="button"
              >
                {resetArmed ? 'Tap again to reset' : 'Reset'}
              </button>
            )}
          </div>
        </div>
        <p className="cr-page__subtitle">
          {overrides.size} override{overrides.size !== 1 ? 's' : ''} ·{' '}
          {rankings.length} players ·{' '}
          <a href={importRankingsHref} className="cr-page__link">
            Import Rankings
          </a>
        </p>
      </div>

      <DraftListSync
        rankings={rankings}
        resolveName={resolvePlayerName}
        onPulled={handleDraftListPulled}
        availableIds={availableIds}
        draftPool={draftPool}
      />

      <PositionFilter
        active={positionFilter}
        counts={positionCounts}
        onChange={setPositionFilter}
      />

      <RankingList
        players={enrichedPlayers}
        tiers={visibleTiers}
        isEditing={isEditing}
        onReorder={handleReorder}
        onRemoveTier={handleRemoveTier}
        onRenameTier={handleRenameTier}
        onMoveTier={handleMoveTier}
        onAddTierAfter={handleAddTierAfter}
      />
    </div>
  );
}

// --- Helpers ---

function getFilteredPlayers(
  rankings: string[],
  filter: PositionFilterType,
  playerById: Map<string, MFLPlayerWithEspn>,
  /** When non-null, keep only ids in this set (the draftable pool). */
  availableIds: Set<string> | null,
): MFLPlayerWithEspn[] {
  const result: MFLPlayerWithEspn[] = [];
  for (const id of rankings) {
    const player = playerById.get(id);
    if (!player) continue;
    if (availableIds && !availableIds.has(id)) continue;
    if (filter === 'ALL' || player.position === filter) {
      result.push(player);
    }
  }
  return result;
}
