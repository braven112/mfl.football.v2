/**
 * Lineup Utilities
 * Auto-optimize, undo stack, eligibility checks, and swap logic
 * for the Submit Lineup React components.
 */

import {
  type LineupSlot,
  type ValidatablePlayer,
  FLEX_POSITIONS,
  createSlotDefinitions,
  isEligibleForSlot,
} from '../../../utils/lineup-validation';

// Re-export for convenience
export { createSlotDefinitions, isEligibleForSlot };
export type { LineupSlot, ValidatablePlayer };

/** Extended player data for the lineup UI */
export interface LineupPlayer extends ValidatablePlayer {
  name: string;
  nflTeam: string;
  headshot?: string;
  projectedPoints: number;
  opponent?: string;
  isHome?: boolean;
  spread?: string;
  overUnder?: string;
  avgRecent?: number;
  avgSeason?: number;
  kickoffTime?: number; // Unix timestamp
  isLocked?: boolean; // Game has started
}

/** A single undo-able change */
export interface LineupChange {
  type: 'swap';
  /** Slot that lost its player (or gained a new one) */
  slotId: string;
  /** Player removed from the slot (null if slot was empty) */
  previousPlayerId: string | null;
  /** Player placed into the slot */
  newPlayerId: string | null;
  /** If the swap displaced a player to bench or another slot */
  displaced?: {
    slotId: string;
    previousPlayerId: string | null;
    newPlayerId: string | null;
  };
  timestamp: number;
}

/** State machine for the lineup UI */
export type LineupUIState =
  | { mode: 'idle' }
  | { mode: 'selecting'; sourceSlotId: string }
  | { mode: 'submitting' }
  | { mode: 'success' }
  | { mode: 'error'; message: string; retryCount: number };

/**
 * Get bench players eligible for a given slot.
 */
export function getEligibleBenchForSlot(
  slot: LineupSlot,
  allPlayers: LineupPlayer[],
  currentSlots: LineupSlot[],
): LineupPlayer[] {
  const starterIds = new Set(
    currentSlots.map((s) => s.playerId).filter(Boolean),
  );
  return allPlayers
    .filter(
      (p) =>
        !starterIds.has(p.id) &&
        isEligibleForSlot(p.position, slot) &&
        p.rosterStatus !== 'TAXI_SQUAD' &&
        p.rosterStatus !== 'INJURED_RESERVE',
    )
    .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0));
}

/**
 * Get all starter slots a bench player could fill.
 */
export function getEligibleSlotsForPlayer(
  player: LineupPlayer,
  slots: LineupSlot[],
): LineupSlot[] {
  return slots.filter((slot) => isEligibleForSlot(player.position, slot));
}

/**
 * Check if two slots can swap players (both positions must be valid in both slots).
 */
export function canSwapSlots(
  slotA: LineupSlot,
  slotB: LineupSlot,
  players: Map<string, LineupPlayer>,
): boolean {
  const playerA = slotA.playerId ? players.get(slotA.playerId) : null;
  const playerB = slotB.playerId ? players.get(slotB.playerId) : null;

  // Both slots need valid players
  if (!playerA || !playerB) return false;

  // Player A must be eligible for slot B and vice versa
  return (
    isEligibleForSlot(playerA.position, slotB) &&
    isEligibleForSlot(playerB.position, slotA)
  );
}

/**
 * Execute a swap: move a bench player into a starter slot.
 * Returns new slots array and the undo change record.
 */
export function swapBenchToStarter(
  benchPlayerId: string,
  targetSlotId: string,
  currentSlots: LineupSlot[],
): { slots: LineupSlot[]; change: LineupChange } {
  const newSlots = currentSlots.map((s) => ({ ...s }));
  const targetSlot = newSlots.find((s) => s.slotId === targetSlotId);
  if (!targetSlot) throw new Error(`Slot ${targetSlotId} not found`);

  const previousPlayerId = targetSlot.playerId;
  targetSlot.playerId = benchPlayerId;

  return {
    slots: newSlots,
    change: {
      type: 'swap',
      slotId: targetSlotId,
      previousPlayerId,
      newPlayerId: benchPlayerId,
      timestamp: Date.now(),
    },
  };
}

/**
 * Execute a swap between two starter slots.
 * Returns new slots array and the undo change record.
 */
export function swapStarterToStarter(
  slotIdA: string,
  slotIdB: string,
  currentSlots: LineupSlot[],
): { slots: LineupSlot[]; change: LineupChange } {
  const newSlots = currentSlots.map((s) => ({ ...s }));
  const slotA = newSlots.find((s) => s.slotId === slotIdA);
  const slotB = newSlots.find((s) => s.slotId === slotIdB);
  if (!slotA || !slotB) throw new Error('Slot not found');

  const prevA = slotA.playerId;
  const prevB = slotB.playerId;
  slotA.playerId = prevB;
  slotB.playerId = prevA;

  return {
    slots: newSlots,
    change: {
      type: 'swap',
      slotId: slotIdA,
      previousPlayerId: prevA,
      newPlayerId: prevB,
      displaced: {
        slotId: slotIdB,
        previousPlayerId: prevB,
        newPlayerId: prevA,
      },
      timestamp: Date.now(),
    },
  };
}

/**
 * Undo a single change. Returns new slots array.
 */
export function undoChange(
  change: LineupChange,
  currentSlots: LineupSlot[],
): LineupSlot[] {
  const newSlots = currentSlots.map((s) => ({ ...s }));

  // Reverse the primary slot change
  const slot = newSlots.find((s) => s.slotId === change.slotId);
  if (slot) {
    slot.playerId = change.previousPlayerId;
  }

  // Reverse the displaced slot change (if starter-to-starter swap)
  if (change.displaced) {
    const displacedSlot = newSlots.find(
      (s) => s.slotId === change.displaced!.slotId,
    );
    if (displacedSlot) {
      displacedSlot.playerId = change.displaced.previousPlayerId;
    }
  }

  return newSlots;
}

/**
 * Auto-optimize: fill slots with highest-projected players.
 *
 * Algorithm (deterministic):
 * 1. Sort all active roster players by projected points (descending)
 * 2. Skip BYE and OUT players
 * 3. Fill QB1, PK1, DEF1 with highest-projected at each position
 * 4. Fill RB1, WR1, TE1 with highest-projected at each position
 * 5. Fill FLEX1-3 with next highest-projected RB/WR/TE remaining
 */
export function autoOptimize(
  allPlayers: LineupPlayer[],
  currentWeek?: number,
): LineupSlot[] {
  const slots = createSlotDefinitions();

  // Filter to active, non-BYE, non-OUT players
  const eligible = allPlayers
    .filter(
      (p) =>
        p.rosterStatus !== 'TAXI_SQUAD' &&
        p.rosterStatus !== 'INJURED_RESERVE' &&
        p.injuryStatus !== 'Out' &&
        p.injuryStatus !== 'IR' &&
        !(currentWeek && p.byeWeek === currentWeek),
    )
    .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0));

  const assigned = new Set<string>();

  // Phase 1: Fixed positions (QB, PK, DEF)
  for (const slot of slots) {
    if (
      slot.eligiblePositions.length === 1 &&
      !FLEX_POSITIONS.includes(slot.eligiblePositions[0] as any)
    ) {
      const match = eligible.find(
        (p) =>
          !assigned.has(p.id) &&
          p.position === slot.eligiblePositions[0],
      );
      if (match) {
        slot.playerId = match.id;
        assigned.add(match.id);
      }
    }
  }

  // Phase 2: Named minimums (RB1, WR1, TE1)
  for (const slot of slots) {
    if (
      slot.eligiblePositions.length === 1 &&
      FLEX_POSITIONS.includes(slot.eligiblePositions[0] as any)
    ) {
      const match = eligible.find(
        (p) =>
          !assigned.has(p.id) &&
          p.position === slot.eligiblePositions[0],
      );
      if (match) {
        slot.playerId = match.id;
        assigned.add(match.id);
      }
    }
  }

  // Phase 3: FLEX slots — best remaining RB/WR/TE
  for (const slot of slots) {
    if (slot.slotId.startsWith('FLEX') && !slot.playerId) {
      const match = eligible.find(
        (p) =>
          !assigned.has(p.id) &&
          FLEX_POSITIONS.includes(p.position as any),
      );
      if (match) {
        slot.playerId = match.id;
        assigned.add(match.id);
      }
    }
  }

  return slots;
}

/**
 * Check if a player's game has started (locked for lineup changes).
 */
export function isPlayerLocked(player: LineupPlayer): boolean {
  if (player.isLocked) return true;
  if (!player.kickoffTime) return false;
  return Date.now() >= player.kickoffTime * 1000;
}

/**
 * Calculate total projected points for the current lineup.
 */
export function calculateTotalProjected(
  slots: LineupSlot[],
  players: Map<string, LineupPlayer>,
): number {
  return slots.reduce((total, slot) => {
    if (!slot.playerId) return total;
    const player = players.get(slot.playerId);
    return total + (player?.projectedPoints || 0);
  }, 0);
}

/**
 * Determine if the lineup has changed from the original.
 */
export function hasChanges(
  currentSlots: LineupSlot[],
  originalSlots: LineupSlot[],
): boolean {
  return currentSlots.some((slot, i) => slot.playerId !== originalSlots[i].playerId);
}

/**
 * Count the number of slot changes from original.
 */
export function countChanges(
  currentSlots: LineupSlot[],
  originalSlots: LineupSlot[],
): number {
  return currentSlots.filter(
    (slot, i) => slot.playerId !== originalSlots[i].playerId,
  ).length;
}

/**
 * Extract the list of starter player IDs from slots (for API submission).
 */
export function getStarterIds(slots: LineupSlot[]): string[] {
  return slots
    .map((s) => s.playerId)
    .filter((id): id is string => id !== null);
}
