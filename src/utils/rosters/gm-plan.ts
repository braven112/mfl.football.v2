/**
 * The GM office plan: an owner's simulated contract moves, saved to their
 * account and filed in one Review & submit.
 *
 * The Rosters GM view already SIMULATES every move (`contractActions` in
 * `theleague/rosters.astro`). This module is the part that turns a
 * simulation into something real, and it owns three decisions:
 *
 * 1. WHICH simulated moves an owner can submit — their own team's tags,
 *    veteran extensions, rookie extensions, 1st-round options and cuts.
 *    A simulated trade, or any move on another club's player, stays a
 *    simulation.
 * 2. WHAT each one does on submit, in words the review panel prints. Every
 *    move files through `/api/contracts/declare` or `/api/cut-player`:
 *    rookie extensions and 1st-round options are written to MFL by the
 *    30-minute contracts job (apply-pending-contracts); a veteran extension is written straight to MFL (the declare
 *    route's own veteran path, with its own yearly slot); a tag is QUEUED,
 *    only Feb 1 to Feb 14, and written on Feb 15 (franchise-tag-window.mjs;
 *    outside the window it stays in the plan unfiled); a cut releases the
 *    player in MFL at once.
 * 3. THE ORDER they are filed in. Contract paperwork first, then the
 *    veteran extension, cuts last: each step is harder to take back than the
 *    one before, so a failure stops the run before the next kind lands.
 *
 * Saving is the plan's other half. A saved move is the action object the page
 * already builds, kept per owner in Redis (`/api/gm-plan`). On the way back it
 * is accepted only while the player is still on that roster at the same
 * salary and years — a plan made against an old contract would otherwise
 * re-price itself silently.
 *
 * Pure: no DOM, no fetch. `tests/gm-plan.test.ts` pins it.
 */

import { isFranchiseTagOpen } from '../franchise-tag-window.mjs';

/** Move types an owner can file from the plan. */
export const SUBMITTABLE_TYPES = ['franchise', 'extension', 'rookie-extension', 'team-option', 'cut'] as const;
export type SubmittableType = (typeof SUBMITTABLE_TYPES)[number];

/** Types the plan saves: everything submittable plus a simulated trade, which is kept but never filed. */
export const SAVED_TYPES = [...SUBMITTABLE_TYPES, 'trade'] as const;

/** The most moves one plan may hold — a whole roster, with room to spare. */
export const MAX_PLAN_MOVES = 60;

export function isSubmittableType(type: unknown): type is SubmittableType {
  return typeof type === 'string' && (SUBMITTABLE_TYPES as readonly string[]).includes(type);
}

/** The fields of a simulated action this module reads. */
export interface PlanAction {
  type?: string;
  playerId?: string | number;
  playerName?: string;
  playerPosition?: string;
  franchiseId?: string;
  originalSalary?: number;
  originalYears?: number;
  newSalary?: number;
  newYears?: number;
  originalContractInfo?: string;
  ufaYearIndex?: number;
  currentPenalty?: number;
  futurePenalty?: number;
  totalPenalty?: number;
  [key: string]: unknown;
}

/** The owner's own moves that Submit files: contract paperwork, then the veteran extension, cuts last. */
export function submittableMoves<T extends PlanAction>(
  actions: Record<string, T>,
  ownFranchiseId: string | null | undefined,
  now: Date = new Date(),
): T[] {
  if (!ownFranchiseId) return [];
  // A tag outside Feb 1-14 is kept in the plan but not filed.
  const tagOpen = isFranchiseTagOpen(now);
  const own = Object.values(actions).filter(
    (a) =>
      isSubmittableType(a.type) &&
      String(a.franchiseId ?? '') === String(ownFranchiseId) &&
      (a.type !== 'franchise' || tagOpen),
  );
  const rank = (a: T) => (a.type === 'cut' ? 2 : a.type === 'extension' ? 1 : 0);
  return [0, 1, 2].flatMap((r) => own.filter((a) => rank(a) === r));
}

/** The declaration `type` /api/contracts/declare files a move as. */
export function declarationTypeFor(type: string): string | null {
  switch (type) {
    case 'franchise':
      return 'franchise-tag';
    case 'extension':
      return 'veteran-extension';
    case 'rookie-extension':
      return 'rookie-extension';
    case 'team-option':
      return 'team-option';
    default:
      return null;
  }
}

/**
 * What a move does when the owner submits, as the review panel prints it.
 * `tone` lets the panel mark the one that cannot be undone.
 */
export function submitOutcome(
  type: string,
  now: Date = new Date(),
): { text: string; tone: 'final' | 'pending' | 'none' } {
  switch (type) {
    case 'cut':
      return { text: 'Released in MFL when you submit. This can’t be undone.', tone: 'final' };
    case 'extension':
      return { text: 'Written to MFL when you submit.', tone: 'final' };
    case 'franchise':
      // Constitution: tags are declared Feb 1 to Feb 14 at 8:45pm PT and
      // written on Feb 15 (franchise-tag-window.mjs). Outside the window the
      // tag is not filed; it stays in the plan.
      return isFranchiseTagOpen(now)
        ? { text: 'Queued when you submit. Written to MFL on Feb 15 as a 1-year contract.', tone: 'pending' }
        : { text: 'Tags can be submitted Feb 1 to Feb 14. It stays in your plan until then.', tone: 'none' };
    case 'rookie-extension':
    case 'team-option':
      // apply-pending-contracts writes every pending declaration to MFL on
      // its 30-minute cadence; no commissioner step (Brandon, 2026-11-15).
      return { text: 'Written to MFL within 30 minutes of submitting.', tone: 'pending' };
    case 'trade':
      return { text: 'Stays a simulation. Trades go through the Trade Builder.', tone: 'none' };
    default:
      return { text: 'Stays a simulation.', tone: 'none' };
  }
}

/** Short label for the review panel and the plan bar's tallies. */
export const PLAN_MOVE_LABELS: Record<string, string> = {
  franchise: 'Franchise tag',
  extension: 'Veteran extension',
  'rookie-extension': 'Rookie extension',
  'team-option': '1st-round option',
  cut: 'Cut',
  trade: 'Simulated trade',
};

// ── Saving ────────────────────────────────────────────────────────────────

const NUMERIC_FIELDS = [
  'originalSalary',
  'originalYears',
  'newSalary',
  'newYears',
  'ufaYearIndex',
  'currentPenalty',
  'futurePenalty',
  'totalPenalty',
] as const;

/**
 * One saved move, reduced to the fields the page reads back. Anything else
 * in the request body is dropped, so the store can never hold more than a
 * plan. Returns null for a move that is not a plan move.
 */
export function sanitizeSavedMove(raw: unknown, franchiseId: string): PlanAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r.type === 'string' ? r.type : '';
  if (!(SAVED_TYPES as readonly string[]).includes(type)) return null;
  const playerId = String(r.playerId ?? '');
  if (!/^\d{1,8}$/.test(playerId)) return null;
  const out: PlanAction = {
    type,
    playerId,
    playerName: typeof r.playerName === 'string' ? r.playerName.slice(0, 80) : '',
    playerPosition: typeof r.playerPosition === 'string' ? r.playerPosition.slice(0, 8) : '',
    originalContractInfo:
      typeof r.originalContractInfo === 'string' && /^[A-Z]{0,3}$/.test(r.originalContractInfo) ? r.originalContractInfo : '',
    // Always the session's franchise, never the body's: a plan is the owner's own.
    franchiseId,
  };
  for (const key of NUMERIC_FIELDS) {
    const n = Number(r[key]);
    if (r[key] !== undefined && r[key] !== null && Number.isFinite(n)) out[key] = n;
  }
  if (type === 'trade') out.removed = true;
  return out;
}

export function sanitizeSavedPlan(raw: unknown, franchiseId: string): PlanAction[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const moves: PlanAction[] = [];
  for (const item of raw) {
    const move = sanitizeSavedMove(item, franchiseId);
    if (!move || seen.has(String(move.playerId))) continue;
    seen.add(String(move.playerId));
    moves.push(move);
    if (moves.length >= MAX_PLAN_MOVES) break;
  }
  return moves;
}

/** The moves of a page's `contractActions` that belong in the owner's saved plan. */
export function planToSave<T extends PlanAction>(
  actions: Record<string, T>,
  ownFranchiseId: string | null | undefined,
): T[] {
  if (!ownFranchiseId) return [];
  return Object.values(actions).filter(
    (a) =>
      (SAVED_TYPES as readonly string[]).includes(String(a.type)) &&
      String(a.franchiseId ?? '') === String(ownFranchiseId),
  );
}

/** A roster row as the restore check reads it. */
export interface PlanRosterRow {
  id?: string | number;
  salary?: number | string;
  contractYears?: number | string;
}

/**
 * The saved moves that still apply: the player is still on the owner's
 * roster, at the salary and years the move was priced against. Anything else
 * is dropped rather than re-priced, and counted so the page can say so.
 */
export function restorablePlan(
  saved: readonly PlanAction[],
  roster: readonly PlanRosterRow[],
): { moves: PlanAction[]; dropped: number } {
  const byId = new Map(roster.map((row) => [String(row.id ?? ''), row]));
  const moves: PlanAction[] = [];
  let dropped = 0;
  for (const move of saved) {
    const row = byId.get(String(move.playerId));
    const sameContract =
      row &&
      Math.round(Number(row.salary)) === Math.round(Number(move.originalSalary)) &&
      Number(row.contractYears) === Number(move.originalYears);
    if (sameContract) moves.push(move);
    else dropped += 1;
  }
  return { moves, dropped };
}

/** The Redis key for one owner's plan. Scoped by league: both leagues have a franchise 0001. */
export function gmPlanKey(leagueSlug: string, franchiseId: string): string {
  return `gm-plan:${leagueSlug}:${franchiseId}`;
}
