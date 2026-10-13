/**
 * Which of an owner's IR players would make MFL refuse their lineup.
 *
 * MFL blocks every lineup import while a team carries an IR violation — a
 * player on IR whose NFL designation no longer qualifies — and the owner only
 * found out by tapping Submit and getting "Failed — Retry" (2026-10-13: an AFL
 * owner's IR held a back listed Questionable). Set Lineup now names him on
 * load.
 *
 * The eligible designations are a league rule MFL does not export, so they
 * come from the registry (`irEligibleInjuryStatuses`); a league without one
 * gets no warning rather than a guessed one. The injury map is the synced
 * feed, so this is a warning to check, never a gate on submitting.
 */
import type { InjuryMap } from './mfl-injuries';

export interface IrRosterPlayer {
  id: string;
  name: string;
  rosterStatus: string;
}

export interface IrViolation {
  id: string;
  name: string;
  /** The designation that disqualifies him, or null when he has none (healthy). */
  injuryStatus: string | null;
}

export function findIrViolations(
  roster: readonly IrRosterPlayer[],
  injuries: InjuryMap,
  eligibleStatuses: readonly string[] | undefined,
): IrViolation[] {
  if (!eligibleStatuses?.length) return [];
  // An empty map is a missing feed, not a league with no injuries: reading it
  // as "everyone is healthy" would flag every IR player on every team.
  if (Object.keys(injuries).length === 0) return [];

  const eligible = new Set(eligibleStatuses.map((s) => s.toLowerCase()));
  const out: IrViolation[] = [];
  for (const p of roster) {
    if (p.rosterStatus !== 'INJURED_RESERVE') continue;
    const status = injuries[p.id]?.injuryStatus ?? null;
    if (status && eligible.has(status.toLowerCase())) continue;
    out.push({ id: p.id, name: p.name, injuryStatus: status });
  }
  return out;
}
