/**
 * Everything wrong with a lineup, in the order an owner should fix it — the
 * list Set Lineup's problems sheet shows.
 *
 * Two kinds, and the sheet treats them differently:
 *   - BLOCKING: MFL will refuse the lineup outright. Today that is an IR
 *     violation, which blocks every submit until the player leaves IR (owner
 *     report, 2026-10-13). The sheet opens on its own for these.
 *   - WARNING: the lineup will save but scores worse than it could — an empty
 *     slot, a starter on bye, a starter ruled out. These wait behind a badge.
 *
 * Pure, so the page recomputes it from the live slots after every swap: a
 * starter problem disappears the moment the owner benches him.
 */
import type { IrViolation } from './lineup-ir-violations';

export type LineupProblemKind = 'ir-violation' | 'empty-slot' | 'bye' | 'out';

export interface LineupProblem {
  kind: LineupProblemKind;
  severity: 'blocking' | 'warning';
  /** Starter problems: which slot to reopen. */
  slotIndex?: number;
  playerId?: string;
  title: string;
  detail: string;
}

export interface ProblemSlot {
  position: string;
  playerId: string | null;
  /** A slot whose game has kicked off can't change, so it isn't a fixable problem. */
  locked: boolean;
}

export interface ProblemPlayer {
  id: string;
  name: string;
  isBye: boolean;
  gameLocked: boolean;
  injury: { injuryStatus: string } | null;
}

export interface FindLineupProblemsInput {
  slots: readonly ProblemSlot[];
  players: ReadonlyMap<string, ProblemPlayer>;
  week: number;
  irViolations?: readonly IrViolation[];
  /** The league's IR-eligible designations, for the IR explanation. */
  irEligibleStatuses?: readonly string[];
}

/** Designations that mean the player will not play this week. */
const OUT_STATUSES = new Set(['out', 'ir', 'suspended']);

function joinOr(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

export function findLineupProblems(input: FindLineupProblemsInput): LineupProblem[] {
  const out: LineupProblem[] = [];

  for (const v of input.irViolations ?? []) {
    const listed = v.injuryStatus ? `listed ${v.injuryStatus}` : 'not on the injury report';
    const rule = input.irEligibleStatuses?.length
      ? `IR is only for players listed ${joinOr(input.irEligibleStatuses)}`
      : 'he no longer qualifies for IR';
    out.push({
      kind: 'ir-violation',
      severity: 'blocking',
      playerId: v.id,
      title: `${v.name} can’t stay on IR`,
      detail: `He’s ${listed}, and ${rule}. MFL won’t save any lineup until he’s activated or released.`,
    });
  }

  input.slots.forEach((slot, slotIndex) => {
    if (slot.locked) return;
    if (!slot.playerId) {
      out.push({
        kind: 'empty-slot',
        severity: 'warning',
        slotIndex,
        title: `Your ${slot.position} slot is empty`,
        detail: 'Every slot needs a player before the lineup can be submitted.',
      });
      return;
    }
    const p = input.players.get(slot.playerId);
    if (!p || p.gameLocked) return;
    if (p.isBye) {
      out.push({
        kind: 'bye',
        severity: 'warning',
        slotIndex,
        playerId: p.id,
        title: `${p.name} is on bye`,
        detail: `He doesn’t play in Week ${input.week}, so your ${slot.position} slot scores nothing.`,
      });
      return;
    }
    const status = p.injury?.injuryStatus;
    if (status && OUT_STATUSES.has(status.toLowerCase())) {
      out.push({
        kind: 'out',
        severity: 'warning',
        slotIndex,
        playerId: p.id,
        title: `${p.name} is ruled ${status === 'IR' ? 'out (IR)' : status}`,
        detail: `He won’t play in Week ${input.week}, so your ${slot.position} slot scores nothing.`,
      });
    }
  });

  return out;
}

export function hasBlockingProblem(problems: readonly LineupProblem[]): boolean {
  return problems.some((p) => p.severity === 'blocking');
}
