/**
 * August Roster Cuts — typed wrapper around the pure cut-selection core.
 *
 * The implementation lives in ./august-cut-selection-core.mjs (the repo's
 * established leagues-data.mjs pattern) so the deadline execution script
 * (scripts/apply-august-cuts.mjs) and this app util share ONE algorithm —
 * the Cutdown Plan preview on /theleague/rosters, the autocut API layer,
 * and the deadline job cannot drift.
 *
 * This file adds the TypeScript types and binds the canonical constants
 * (TARGET_ACTIVE_COUNT from salary-calculations.ts, ACQUISITION_TYPES from
 * contract-eligibility.ts) as the defaults. The core carries mirror copies
 * of both constants for script use; tests/august-cutdown-date.test.ts locks
 * the mirrors to these canonical values.
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
import { selectAutoCuts as selectAutoCutsCore } from './august-cut-selection-core.mjs';

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
 * Select which players the August cutdown automation cuts for one franchise.
 * Pure — no I/O, no clock, deterministic for a given input. Delegates to the
 * shared core with the canonical .ts constants bound as defaults.
 */
export function selectAutoCuts(input: SelectAutoCutsInput): SelectAutoCutsResult {
  return selectAutoCutsCore({
    target: TARGET_ACTIVE_COUNT,
    acquisitionTypes: ACQUISITION_TYPES,
    ...input,
  }) as SelectAutoCutsResult;
}
