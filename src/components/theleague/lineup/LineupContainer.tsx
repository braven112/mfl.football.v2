/**
 * LineupContainer — root React component for Submit Lineup.
 * Manages swap state, undo stack, auto-optimize, and MFL API submission.
 *
 * Receives player data as JSON from the Astro page, hydrates with client:load.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { LineupSlot } from '../../../utils/lineup-validation';
import { validateLineup, assignStartersToSlots } from '../../../utils/lineup-validation';
import type { LineupPlayer, LineupChange, LineupUIState } from './lineup-utils';
import {
  getEligibleBenchForSlot,
  canSwapSlots,
  swapBenchToStarter,
  swapStarterToStarter,
  undoChange,
  autoOptimize,
  isPlayerLocked,
  calculateTotalProjected,
  hasChanges,
  countChanges,
  getStarterIds,
} from './lineup-utils';
import LineupRow from './LineupRow';
import LineupActionBar from './LineupActionBar';
import LineupWeekSelector from './LineupWeekSelector';
import './lineup.css';

/** Serializable player data from the Astro page */
interface SerializedPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  projectedPoints: number | string;
  opponent?: string;
  isHome?: boolean;
  spread?: string;
  overUnder?: string;
  avgRecent?: number | string;
  avgSeason?: number | string;
  kickoffTime?: number;
  isLocked?: boolean;
  injuryStatus?: string;
  byeWeek?: number;
  rosterStatus?: string; // 'ROSTER' | 'TAXI_SQUAD' | 'INJURED_RESERVE'
}

interface LineupContainerProps {
  /** JSON-stringified array of player objects on this team's roster */
  playersJson: string;
  /** JSON-stringified array of current starter IDs from MFL */
  starterIdsJson: string;
  /** Current NFL week */
  currentWeek: number;
  /** Max week for the season */
  maxWeek?: number;
  /** Whether the user is viewing their own team (enables editing) */
  isOwnTeam: boolean;
  /** MFL fallback URL for emergency lineup submission */
  mflFallbackUrl?: string;
  /** Team name for display */
  teamName?: string;
  /** Opponent team name */
  opponentName?: string;
}

/** Group starters by position section for display */
const SECTION_ORDER = [
  { key: 'QB', label: 'Quarterback', slotIds: ['QB1'] },
  { key: 'RB', label: 'Running Back', slotIds: ['RB1'] },
  { key: 'WR', label: 'Wide Receiver', slotIds: ['WR1'] },
  { key: 'TE', label: 'Tight End', slotIds: ['TE1'] },
  { key: 'FLEX', label: 'Flex (RB/WR/TE)', slotIds: ['FLEX1', 'FLEX2', 'FLEX3'] },
  { key: 'PK', label: 'Kicker', slotIds: ['PK1'] },
  { key: 'DEF', label: 'Defense', slotIds: ['DEF1'] },
];

function parsePlayer(raw: SerializedPlayer): LineupPlayer {
  const proj = typeof raw.projectedPoints === 'string'
    ? parseFloat(raw.projectedPoints) || 0
    : raw.projectedPoints || 0;
  const avgR = typeof raw.avgRecent === 'string'
    ? parseFloat(raw.avgRecent) || undefined
    : raw.avgRecent || undefined;
  const avgS = typeof raw.avgSeason === 'string'
    ? parseFloat(raw.avgSeason) || undefined
    : raw.avgSeason || undefined;

  return {
    id: raw.id,
    name: raw.name,
    position: raw.position === 'DEF' ? 'Def' : raw.position,
    nflTeam: raw.nflTeam,
    headshot: raw.headshot,
    projectedPoints: proj,
    opponent: raw.opponent,
    isHome: raw.isHome,
    spread: raw.spread,
    overUnder: raw.overUnder,
    avgRecent: avgR,
    avgSeason: avgS,
    kickoffTime: raw.kickoffTime,
    isLocked: raw.isLocked,
    injuryStatus: raw.injuryStatus,
    byeWeek: raw.byeWeek,
    rosterStatus: raw.rosterStatus || 'ROSTER',
  };
}

export default function LineupContainer({
  playersJson,
  starterIdsJson,
  currentWeek,
  maxWeek,
  isOwnTeam,
  mflFallbackUrl,
  teamName,
  opponentName,
}: LineupContainerProps) {
  // Parse serialized data
  const allPlayers = useMemo<LineupPlayer[]>(() => {
    try {
      const raw: SerializedPlayer[] = JSON.parse(playersJson);
      return raw.map(parsePlayer);
    } catch {
      return [];
    }
  }, [playersJson]);

  const playerMap = useMemo(
    () => new Map(allPlayers.map((p) => [p.id, p])),
    [allPlayers],
  );

  const initialStarterIds = useMemo<string[]>(() => {
    try {
      return JSON.parse(starterIdsJson);
    } catch {
      return [];
    }
  }, [starterIdsJson]);

  // Build projection map for slot assignment
  const projectionMap = useMemo(
    () => new Map(allPlayers.map((p) => [p.id, p.projectedPoints])),
    [allPlayers],
  );

  // Initial slot assignment from MFL's current starters
  // If no starters provided, auto-optimize to show best projected lineup
  const initialSlots = useMemo(
    () =>
      initialStarterIds.length > 0
        ? assignStartersToSlots(initialStarterIds, allPlayers, projectionMap)
        : autoOptimize(allPlayers, currentWeek),
    [initialStarterIds, allPlayers, projectionMap, currentWeek],
  );

  // State
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [slots, setSlots] = useState<LineupSlot[]>(initialSlots);
  const [originalSlots] = useState<LineupSlot[]>(initialSlots);
  const [undoStack, setUndoStack] = useState<LineupChange[]>([]);
  const [uiState, setUIState] = useState<LineupUIState>({ mode: 'idle' });
  const [justSwapped, setJustSwapped] = useState<Set<string>>(new Set());
  const benchRef = useRef<HTMLDivElement>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  // Derived state
  const changeCount = countChanges(slots, originalSlots);
  const totalProjected = calculateTotalProjected(slots, playerMap);
  const isDirty = hasChanges(slots, originalSlots);

  // Validation
  const validation = useMemo(() => {
    const starterIds = getStarterIds(slots);
    return validateLineup(starterIds, allPlayers, selectedWeek);
  }, [slots, allPlayers, selectedWeek]);

  // Announce swap to screen readers
  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = message;
    }
  }, []);

  // beforeunload protection
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Clear justSwapped after animation
  useEffect(() => {
    if (justSwapped.size === 0) return;
    const timer = setTimeout(() => setJustSwapped(new Set()), 500);
    return () => clearTimeout(timer);
  }, [justSwapped]);

  // ─── Swap handlers ───

  const handleSwapClick = useCallback((slotId: string) => {
    setUIState((prev) => {
      if (prev.mode === 'selecting' && prev.sourceSlotId === slotId) {
        // Cancel: tapped same swap icon again
        return { mode: 'idle' };
      }

      if (prev.mode === 'selecting') {
        // Starter-to-starter swap attempt
        const sourceSlot = slots.find((s) => s.slotId === prev.sourceSlotId);
        const targetSlot = slots.find((s) => s.slotId === slotId);
        if (sourceSlot && targetSlot && canSwapSlots(sourceSlot, targetSlot, playerMap)) {
          const { slots: newSlots, change } = swapStarterToStarter(
            prev.sourceSlotId,
            slotId,
            slots,
          );
          setSlots(newSlots);
          setUndoStack((stack) => [...stack, change]);
          setJustSwapped(new Set([prev.sourceSlotId, slotId]));

          const sourcePlayer = sourceSlot.playerId ? playerMap.get(sourceSlot.playerId) : null;
          const targetPlayer = targetSlot.playerId ? playerMap.get(targetSlot.playerId) : null;
          announce(
            `Swapped ${sourcePlayer?.name || 'empty'} and ${targetPlayer?.name || 'empty'}`,
          );

          return { mode: 'idle' };
        }
      }

      // Start selecting: highlight this slot, show eligible bench
      return { mode: 'selecting', sourceSlotId: slotId };
    });

    // Auto-scroll to bench when selecting
    setTimeout(() => {
      if (benchRef.current) {
        benchRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  }, [slots, playerMap, announce]);

  const handleBenchPlayerClick = useCallback((playerId: string) => {
    if (uiState.mode !== 'selecting') return;

    const sourceSlotId = uiState.sourceSlotId;
    const sourceSlot = slots.find((s) => s.slotId === sourceSlotId);
    if (!sourceSlot) return;

    const benchPlayer = playerMap.get(playerId);
    if (!benchPlayer) return;

    // Verify eligibility
    const eligible = getEligibleBenchForSlot(sourceSlot, allPlayers, slots);
    if (!eligible.some((p) => p.id === playerId)) return;

    const { slots: newSlots, change } = swapBenchToStarter(playerId, sourceSlotId, slots);
    setSlots(newSlots);
    setUndoStack((stack) => [...stack, change]);
    setJustSwapped(new Set([sourceSlotId]));
    setUIState({ mode: 'idle' });

    const previousPlayer = sourceSlot.playerId ? playerMap.get(sourceSlot.playerId) : null;
    announce(
      `Swapped ${previousPlayer?.name || 'empty'} out, ${benchPlayer.name} in at ${sourceSlot.label}`,
    );
  }, [uiState, slots, allPlayers, playerMap, announce]);

  // ─── Undo ───

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastChange = undoStack[undoStack.length - 1];
    const newSlots = undoChange(lastChange, slots);
    setSlots(newSlots);
    setUndoStack((stack) => stack.slice(0, -1));
    announce('Undo: reverted last change');
  }, [undoStack, slots, announce]);

  // ─── Auto-Optimize ───

  const handleOptimize = useCallback(() => {
    const optimizedSlots = autoOptimize(allPlayers, selectedWeek);
    // Track all changes for undo (just reset the stack — optimize is all-or-nothing)
    setSlots(optimizedSlots);
    setUndoStack([]);
    announce('Lineup auto-optimized with highest projected starters');
  }, [allPlayers, selectedWeek, announce]);

  // ─── Cancel selection ───

  const handleCancelSelection = useCallback(() => {
    setUIState({ mode: 'idle' });
  }, []);

  // Escape key cancels selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiState.mode === 'selecting') {
        setUIState({ mode: 'idle' });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [uiState.mode]);

  // ─── Submit ───

  const handleSubmit = useCallback(async () => {
    // Double-validate before submission
    const starterIds = getStarterIds(slots);
    const result = validateLineup(starterIds, allPlayers, selectedWeek);
    if (!result.valid) {
      setUIState({ mode: 'error', message: result.errors[0], retryCount: 0 });
      return;
    }

    setUIState({ mode: 'submitting' });

    try {
      const response = await fetch('/api/set-lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starters: starterIds, week: selectedWeek }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUIState({ mode: 'success' });
        setUndoStack([]);
        announce('Lineup submitted successfully');

        // Auto-dismiss success after 2s
        setTimeout(() => {
          setUIState({ mode: 'idle' });
        }, 2000);
      } else {
        const retryCount = uiState.mode === 'error' ? uiState.retryCount + 1 : 1;
        setUIState({
          mode: 'error',
          message: data.error || 'Failed to set lineup',
          retryCount,
        });
      }
    } catch {
      const retryCount = uiState.mode === 'error' ? uiState.retryCount + 1 : 1;
      setUIState({
        mode: 'error',
        message: 'Network error — check your connection and try again',
        retryCount,
      });
    }
  }, [slots, allPlayers, selectedWeek, uiState, announce]);

  const handleRetry = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  // ─── Bench players ───

  const starterIds = useMemo(() => new Set(slots.map((s) => s.playerId).filter(Boolean)), [slots]);

  const benchPlayers = useMemo(
    () =>
      allPlayers
        .filter(
          (p) =>
            !starterIds.has(p.id) &&
            p.rosterStatus !== 'TAXI_SQUAD' &&
            p.rosterStatus !== 'INJURED_RESERVE',
        )
        .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    [allPlayers, starterIds],
  );

  // When selecting, determine which bench players are eligible for the selected slot
  const eligibleBenchIds = useMemo(() => {
    if (uiState.mode !== 'selecting') return new Set<string>();
    const sourceSlot = slots.find((s) => s.slotId === uiState.sourceSlotId);
    if (!sourceSlot) return new Set<string>();
    const eligible = getEligibleBenchForSlot(sourceSlot, allPlayers, slots);
    return new Set(eligible.map((p) => p.id));
  }, [uiState, slots, allPlayers]);

  // Read-only mode (other team or no auth)
  const readOnly = !isOwnTeam;

  return (
    <div className="lineup-container">
      {/* Header */}
      <div className="lineup-header">
        <div className="lineup-header__left">
          <LineupWeekSelector
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            maxWeek={maxWeek}
            onChange={setSelectedWeek}
            disabled={uiState.mode === 'submitting'}
          />
          {opponentName && (
            <span className="lineup-header__opponent">vs {opponentName}</span>
          )}
        </div>
        <div className="lineup-header__right">
          <span className="lineup-header__label">LINEUP</span>
          <span className="lineup-header__total">{totalProjected.toFixed(1)}</span>
        </div>
      </div>

      {/* Optimize button */}
      {!readOnly && (
        <div className="lineup-optimize-row">
          <button
            className="lineup-optimize-btn"
            onClick={handleOptimize}
            disabled={uiState.mode === 'submitting'}
            aria-label="Auto-optimize lineup with highest projections"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Optimize
          </button>
          {undoStack.length > 0 && (
            <button
              className="lineup-optimize-btn lineup-optimize-btn--undo"
              onClick={handleUndo}
              aria-label="Undo last change"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
              </svg>
              Undo
            </button>
          )}
        </div>
      )}

      {/* Validation warnings */}
      {validation.warnings.length > 0 && (
        <div className="lineup-validation-warning" role="alert">
          {validation.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* Starter sections */}
      <div role="list" aria-label="Starting lineup">
        {SECTION_ORDER.map((section) => (
          <div key={section.key} className="lineup-section">
            <div className="lineup-section-title">{section.label}</div>
            {section.slotIds.map((slotId) => {
              const slot = slots.find((s) => s.slotId === slotId);
              if (!slot) return null;
              const player = slot.playerId ? playerMap.get(slot.playerId) || null : null;
              const isSelected =
                uiState.mode === 'selecting' && uiState.sourceSlotId === slotId;
              const isEligibleTarget =
                uiState.mode === 'selecting' &&
                uiState.sourceSlotId !== slotId &&
                !!slot.playerId &&
                canSwapSlots(
                  slots.find((s) => s.slotId === uiState.sourceSlotId)!,
                  slot,
                  playerMap,
                );
              const isDimmed =
                uiState.mode === 'selecting' && !isSelected && !isEligibleTarget;
              const isChanged = slot.playerId !== originalSlots.find((s) => s.slotId === slotId)?.playerId;

              return (
                <LineupRow
                  key={slotId}
                  player={player}
                  slotId={slotId}
                  slotLabel={slot.label}
                  isStarter={true}
                  isSelected={isSelected}
                  isEligibleTarget={isEligibleTarget}
                  isDimmed={isDimmed}
                  isChanged={isChanged}
                  justSwapped={justSwapped.has(slotId)}
                  readOnly={readOnly}
                  onSwapClick={handleSwapClick}
                  onBenchPlayerClick={handleBenchPlayerClick}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Bench */}
      <div ref={benchRef} className="lineup-section">
        <div className="lineup-section-title">Bench</div>
        <div role="list" aria-label="Bench players">
          {benchPlayers.map((player) => {
            const isEligible = eligibleBenchIds.has(player.id);
            const isDimmed = uiState.mode === 'selecting' && !isEligible;

            return (
              <LineupRow
                key={player.id}
                player={player}
                slotId={`bench-${player.id}`}
                slotLabel={player.position}
                isStarter={false}
                isSelected={false}
                isEligibleTarget={isEligible}
                isDimmed={isDimmed}
                isChanged={false}
                justSwapped={false}
                readOnly={readOnly}
                onSwapClick={handleSwapClick}
                onBenchPlayerClick={handleBenchPlayerClick}
              />
            );
          })}
          {benchPlayers.length === 0 && (
            <div className="lineup-row lineup-row--empty" role="listitem">
              <span className="lineup-empty-label">No bench players</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      {!readOnly && (
        <LineupActionBar
          uiState={uiState}
          changeCount={changeCount}
          onUndo={handleUndo}
          onCancelSelection={handleCancelSelection}
          onSubmit={handleSubmit}
          onRetry={handleRetry}
          mflFallbackUrl={mflFallbackUrl}
        />
      )}

      {/* Screen reader live region */}
      <div
        ref={liveRegionRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    </div>
  );
}
