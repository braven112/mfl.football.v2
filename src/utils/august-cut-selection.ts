/**
 * August Roster Cuts — pure cut-selection algorithm
 *
 * Computes exactly which players the August cutdown automation will cut for
 * one franchise. Pure and dependency-light by design: the same function is
 * called client-side (Cutdown Plan preview on /theleague/rosters), from the
 * autocut API layer, and from the deadline execution script
 * (scripts/apply-august-cuts.mjs) — so the preview and reality cannot drift.
 *
 * Rules (see docs/features/august-roster-cuts-automation-plan.md):
 *  1. Only `status === 'ROSTER'` players count toward the target and are
 *     cuttable. Taxi-squad and IR players are excluded from both the count
 *     and the cut pool.
 *  2. overage = active count − target. If ≤ 0, NO cuts — marked players are
 *     consumed only to reach the cap, never cut for their own sake.
 *  3. Marked players go first, in the owner's given order, skipping any that
 *     are no longer on the active roster (traded / already cut / taxi / IR).
 *  4. Remaining overage is filled newest-acquisition-first (acquisition
 *     timestamp descending). Players with no acquisition record are treated
 *     as oldest (cut last). Trades NEVER count as acquisitions — only
 *     ACQUISITION_TYPES (BBID_WAIVER / FREE_AGENT / AUCTION_WON).
 *  5. Never cut below target: the result always contains exactly `overage`
 *     players.
 */

import { TARGET_ACTIVE_COUNT } from './salary-calculations';
import { ACQUISITION_TYPES } from './contract-eligibility';

/** The MFL roster status that counts toward the active-roster limit. */
export const ACTIVE_ROSTER_STATUS = 'ROSTER';

/**
 * Minimal roster-player shape. `RosterPlayer` from types/contract-eligibility
 * (and the raw MFL rosters feed) satisfies this structurally, and node
 * scripts can build it from `{ id, status }` pairs without any imports.
 */
export interface AutoCutRosterPlayer {
  id: string;
  /** MFL roster status — only 'ROSTER' counts (not TAXI_SQUAD / INJURED_RESERVE). */
  status: string;
}

/**
 * Minimal acquisition-event shape. `TransactionRecord` (the output of
 * contract-eligibility's `parseTransactions`) satisfies this structurally;
 * raw MFL transaction feeds can be mapped with parseTransactions first, or a
 * script can build events directly. Events whose `type` is not in
 * ACQUISITION_TYPES (e.g. TRADE) are ignored — passing them is safe.
 */
export interface AutoCutAcquisition {
  /** MFL transaction type — only ACQUISITION_TYPES count; trades are ignored. */
  type: string;
  /** Unix seconds (number or numeric string, as MFL feeds provide). */
  timestamp: number | string;
  /** Player ids added by this transaction. */
  addedPlayerIds: string[];
  /**
   * Franchise that made the transaction. Optional: when both this and
   * `franchiseId` (input option) are set, non-matching events are ignored,
   * so a whole-league transactions feed can be passed as-is.
   */
  franchise?: string;
}

export type AutoCutReason = 'marked' | 'last-added';

export interface AutoCutSelection {
  playerId: string;
  reason: AutoCutReason;
  /**
   * Unix seconds of the newest qualifying (non-trade) acquisition for this
   * player, when one exists. Always present for 'last-added' picks that were
   * ordered by a record; absent for players with no acquisition record.
   */
  acquisitionTimestamp?: number;
}

export interface SelectAutoCutsInput {
  /** The franchise's full roster (any statuses — filtering happens inside). */
  activeRoster: AutoCutRosterPlayer[];
  /** Owner's marked-for-cut player ids, in cut-priority order. */
  markedPlayerIds?: string[];
  /** Acquisition events (whole-league feeds OK — see AutoCutAcquisition). */
  acquisitions?: AutoCutAcquisition[];
  /** Active-roster limit. Defaults to TARGET_ACTIVE_COUNT (22). */
  target?: number;
  /** When set, acquisition events carrying a `franchise` field must match. */
  franchiseId?: string;
}

export interface SelectAutoCutsResult {
  /** Players to cut, in execution order. Length is exactly `overage` (or 0). */
  cuts: AutoCutSelection[];
  /** Count of status==='ROSTER' players considered. */
  activeCount: number;
  /** activeCount − target (may be ≤ 0, in which case cuts is empty). */
  overage: number;
  /** The target actually used. */
  target: number;
}

/**
 * Build a map of playerId → newest qualifying acquisition timestamp.
 * Order-independent: takes the max timestamp per player, so callers don't
 * need to pre-sort their transactions feed.
 */
function buildAcquisitionIndex(
  acquisitions: AutoCutAcquisition[],
  franchiseId?: string,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const event of acquisitions) {
    // Trades (and anything else outside ACQUISITION_TYPES) never count.
    if (!ACQUISITION_TYPES.includes(event.type)) continue;
    if (franchiseId && event.franchise !== undefined && event.franchise !== franchiseId) continue;

    const ts = typeof event.timestamp === 'number'
      ? event.timestamp
      : parseInt(event.timestamp, 10);
    if (!Number.isFinite(ts)) continue;

    for (const playerId of event.addedPlayerIds ?? []) {
      const existing = index.get(playerId);
      if (existing === undefined || ts > existing) index.set(playerId, ts);
    }
  }
  return index;
}

/**
 * Select which players the August cutdown automation cuts for one franchise.
 * Pure — no I/O, no clock, deterministic for a given input.
 */
export function selectAutoCuts({
  activeRoster,
  markedPlayerIds = [],
  acquisitions = [],
  target = TARGET_ACTIVE_COUNT,
  franchiseId,
}: SelectAutoCutsInput): SelectAutoCutsResult {
  const activePlayers = activeRoster.filter(p => p.status === ACTIVE_ROSTER_STATUS);
  const activeCount = activePlayers.length;
  const overage = activeCount - target;

  if (overage <= 0) {
    return { cuts: [], activeCount, overage, target };
  }

  const acquisitionIndex = buildAcquisitionIndex(acquisitions, franchiseId);
  const activeIds = new Set(activePlayers.map(p => p.id));
  const cuts: AutoCutSelection[] = [];
  const selected = new Set<string>();

  // Phase 1: marked players, in owner order, skipping departed / non-active
  // players and duplicates. Consume at most `overage`.
  for (const playerId of markedPlayerIds) {
    if (cuts.length >= overage) break;
    if (!activeIds.has(playerId) || selected.has(playerId)) continue;

    const acquisitionTimestamp = acquisitionIndex.get(playerId);
    cuts.push({
      playerId,
      reason: 'marked',
      ...(acquisitionTimestamp !== undefined ? { acquisitionTimestamp } : {}),
    });
    selected.add(playerId);
  }

  // Phase 2: fill the remainder newest-acquisition-first. Players with no
  // acquisition record sort last (oldest / safest). Sort is stable, so
  // ties (and the whole no-record group) keep roster order — deterministic.
  if (cuts.length < overage) {
    const fallbackPool = activePlayers
      .filter(p => !selected.has(p.id))
      .sort((a, b) => {
        const tsA = acquisitionIndex.get(a.id) ?? Number.NEGATIVE_INFINITY;
        const tsB = acquisitionIndex.get(b.id) ?? Number.NEGATIVE_INFINITY;
        return tsB - tsA;
      });

    for (const player of fallbackPool) {
      if (cuts.length >= overage) break;
      const acquisitionTimestamp = acquisitionIndex.get(player.id);
      cuts.push({
        playerId: player.id,
        reason: 'last-added',
        ...(acquisitionTimestamp !== undefined ? { acquisitionTimestamp } : {}),
      });
      selected.add(player.id);
    }
  }

  // Invariant: exactly `overage` cuts — never below target. The fallback
  // pool always covers the remainder (marked ⊆ active), but clamp anyway.
  return { cuts: cuts.slice(0, overage), activeCount, overage, target };
}
