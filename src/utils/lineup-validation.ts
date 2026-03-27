/**
 * Lineup Validation — shared between client and server
 *
 * Validates that a set of starter player IDs satisfies TheLeague's
 * position requirements: QB(1), RB(1+), WR(1+), TE(1+), PK(1), DEF(1)
 * with exactly 9 total starters and 6 flex slots (RB/WR/TE).
 */

/** Position requirements for TheLeague */
export const STARTER_COUNT = 9;
export const FIXED_POSITIONS = ['QB', 'PK', 'Def'] as const;
export const FLEX_POSITIONS = ['RB', 'WR', 'TE'] as const;
export const FLEX_SLOT_COUNT = 6; // 6 of the 9 slots are RB/WR/TE flex

/** Slot definitions for the UI */
export interface LineupSlot {
  slotId: string;
  label: string;
  eligiblePositions: readonly string[];
  playerId: string | null;
}

/** Result of validation */
export interface LineupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Player info needed for validation */
export interface ValidatablePlayer {
  id: string;
  position: string;
  name?: string;
  injuryStatus?: string;
  byeWeek?: number;
  rosterStatus?: string; // 'ROSTER' | 'TAXI_SQUAD' | 'INJURED_RESERVE'
}

/**
 * Create the 9 starter slot definitions used by TheLeague.
 * Named minimums: QB1, RB1, WR1, TE1, FLEX×3, PK1, DEF1
 */
export function createSlotDefinitions(): LineupSlot[] {
  return [
    { slotId: 'QB1', label: 'QB', eligiblePositions: ['QB'], playerId: null },
    { slotId: 'RB1', label: 'RB', eligiblePositions: ['RB'], playerId: null },
    { slotId: 'WR1', label: 'WR', eligiblePositions: ['WR'], playerId: null },
    { slotId: 'TE1', label: 'TE', eligiblePositions: ['TE'], playerId: null },
    { slotId: 'FLEX1', label: 'FLEX', eligiblePositions: FLEX_POSITIONS, playerId: null },
    { slotId: 'FLEX2', label: 'FLEX', eligiblePositions: FLEX_POSITIONS, playerId: null },
    { slotId: 'FLEX3', label: 'FLEX', eligiblePositions: FLEX_POSITIONS, playerId: null },
    { slotId: 'PK1', label: 'PK', eligiblePositions: ['PK'], playerId: null },
    { slotId: 'DEF1', label: 'DEF', eligiblePositions: ['Def'], playerId: null },
  ];
}

/**
 * Validate that a set of starter IDs forms a legal lineup.
 *
 * @param starterIds - Array of MFL player IDs to start
 * @param rosterPlayers - All players on the user's active roster with position info
 * @param currentWeek - Current week number (for bye week warnings)
 */
export function validateLineup(
  starterIds: string[],
  rosterPlayers: ValidatablePlayer[],
  currentWeek?: number,
): LineupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build lookup map
  const playerMap = new Map<string, ValidatablePlayer>();
  for (const p of rosterPlayers) {
    playerMap.set(p.id, p);
  }

  // --- Hard errors (prevent submission) ---

  // Exact count
  if (starterIds.length !== STARTER_COUNT) {
    errors.push(`Lineup requires exactly ${STARTER_COUNT} starters, got ${starterIds.length}`);
  }

  // No duplicates
  const uniqueIds = new Set(starterIds);
  if (uniqueIds.size !== starterIds.length) {
    errors.push('Duplicate player IDs in lineup');
  }

  // All players must be on active roster
  const starters: ValidatablePlayer[] = [];
  for (const id of starterIds) {
    const player = playerMap.get(id);
    if (!player) {
      errors.push(`Player ${id} is not on your roster`);
      continue;
    }
    if (player.rosterStatus && player.rosterStatus !== 'ROSTER') {
      errors.push(
        `${player.name || id} is on ${player.rosterStatus === 'TAXI_SQUAD' ? 'taxi squad' : 'IR'} and cannot start`,
      );
      continue;
    }
    starters.push(player);
  }

  // Position distribution
  const positionCounts: Record<string, number> = {};
  for (const p of starters) {
    positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
  }

  // Must have exactly 1 QB
  if ((positionCounts['QB'] || 0) !== 1) {
    errors.push(`Lineup requires exactly 1 QB, got ${positionCounts['QB'] || 0}`);
  }

  // Must have exactly 1 PK
  if ((positionCounts['PK'] || 0) !== 1) {
    errors.push(`Lineup requires exactly 1 PK, got ${positionCounts['PK'] || 0}`);
  }

  // Must have exactly 1 DEF (MFL uses "Def")
  if ((positionCounts['Def'] || 0) !== 1) {
    errors.push(`Lineup requires exactly 1 DEF, got ${positionCounts['Def'] || 0}`);
  }

  // Remaining 6 must be RB/WR/TE with at least 1 of each
  const rbCount = positionCounts['RB'] || 0;
  const wrCount = positionCounts['WR'] || 0;
  const teCount = positionCounts['TE'] || 0;
  const flexTotal = rbCount + wrCount + teCount;

  if (flexTotal !== FLEX_SLOT_COUNT) {
    errors.push(
      `Lineup requires ${FLEX_SLOT_COUNT} RB/WR/TE starters, got ${flexTotal}`,
    );
  }

  if (rbCount < 1) errors.push('Lineup requires at least 1 RB');
  if (wrCount < 1) errors.push('Lineup requires at least 1 WR');
  if (teCount < 1) errors.push('Lineup requires at least 1 TE');

  // No non-skill positions in the lineup (safety check)
  for (const p of starters) {
    const validPositions = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];
    if (!validPositions.includes(p.position)) {
      errors.push(`${p.name || p.id} has invalid position "${p.position}"`);
    }
  }

  // --- Soft warnings (allow submission but warn user) ---

  for (const p of starters) {
    // Injury warnings
    if (p.injuryStatus === 'Out' || p.injuryStatus === 'IR') {
      warnings.push(`${p.name || p.id} is listed as ${p.injuryStatus}`);
    } else if (p.injuryStatus === 'Doubtful') {
      warnings.push(`${p.name || p.id} is listed as Doubtful`);
    }

    // BYE week warnings
    if (currentWeek && p.byeWeek === currentWeek) {
      warnings.push(`${p.name || p.id} is on BYE this week`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a player is eligible for a given slot.
 */
export function isEligibleForSlot(
  playerPosition: string,
  slot: LineupSlot,
): boolean {
  return slot.eligiblePositions.includes(playerPosition);
}

/**
 * Get all slots a player could fill based on their position.
 */
export function getEligibleSlots(
  playerPosition: string,
  slots: LineupSlot[],
): LineupSlot[] {
  return slots.filter((slot) => isEligibleForSlot(playerPosition, slot));
}

/**
 * Auto-assign starters to slots based on position.
 * Returns a new slots array with playerIds filled in.
 *
 * Algorithm (deterministic):
 * 1. Fill fixed positions first (QB, PK, DEF)
 * 2. Fill named minimums (RB1, WR1, TE1) with highest-projected at each position
 * 3. Fill FLEX slots with remaining highest-projected RB/WR/TE
 */
export function assignStartersToSlots(
  starterIds: string[],
  players: ValidatablePlayer[],
  projections?: Map<string, number>,
): LineupSlot[] {
  const slots = createSlotDefinitions();
  const playerMap = new Map<string, ValidatablePlayer>();
  for (const p of players) {
    playerMap.set(p.id, p);
  }

  // Sort starters by projected points (highest first) for optimal slot assignment
  const sortedStarters = [...starterIds].sort((a, b) => {
    const projA = projections?.get(a) || 0;
    const projB = projections?.get(b) || 0;
    return projB - projA;
  });

  const assigned = new Set<string>();

  // Phase 1: Fill fixed-position slots (QB1, PK1, DEF1)
  for (const slot of slots) {
    if (slot.eligiblePositions.length === 1 && !FLEX_POSITIONS.includes(slot.eligiblePositions[0] as any)) {
      // This is a fixed slot (QB, PK, DEF)
      const match = sortedStarters.find(
        (id) => !assigned.has(id) && playerMap.get(id)?.position === slot.eligiblePositions[0],
      );
      if (match) {
        slot.playerId = match;
        assigned.add(match);
      }
    }
  }

  // Phase 2: Fill named minimum slots (RB1, WR1, TE1)
  for (const slot of slots) {
    if (slot.eligiblePositions.length === 1 && FLEX_POSITIONS.includes(slot.eligiblePositions[0] as any)) {
      const match = sortedStarters.find(
        (id) => !assigned.has(id) && playerMap.get(id)?.position === slot.eligiblePositions[0],
      );
      if (match) {
        slot.playerId = match;
        assigned.add(match);
      }
    }
  }

  // Phase 3: Fill FLEX slots with remaining RB/WR/TE
  for (const slot of slots) {
    if (slot.slotId.startsWith('FLEX') && !slot.playerId) {
      const match = sortedStarters.find(
        (id) =>
          !assigned.has(id) &&
          FLEX_POSITIONS.includes(playerMap.get(id)?.position as any),
      );
      if (match) {
        slot.playerId = match;
        assigned.add(match);
      }
    }
  }

  return slots;
}
