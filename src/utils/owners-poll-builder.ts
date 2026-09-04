/**
 * Ballot-builder state transitions.
 *
 * Pure functions, extracted from the island so the interaction rules are
 * unit-testable without mounting React. Every one returns a NEW array — the
 * island holds the selection in state and must not mutate it in place.
 *
 * The interaction is tap-to-add-in-order rather than drag-to-sort a seeded
 * list, and that is a turnout decision, not a stylistic one: a pre-sorted list
 * anchors every ballot to whatever order the site chose, and dragging seven
 * rows on a phone is the chore that makes owners abandon the page. Tapping has
 * nothing to anchor to and is a sub-minute flow on mobile.
 */

/** Add a team to the end of the selection, or remove it if already picked. */
export function toggleTeam(selection: string[], franchiseId: string, slots: number): string[] {
  const idx = selection.indexOf(franchiseId);
  if (idx >= 0) {
    return selection.filter((id) => id !== franchiseId);
  }
  // Silently ignoring the tap past the limit is deliberate: the alternative
  // (dropping the last pick to make room) discards a choice the owner made on
  // purpose without telling them.
  if (selection.length >= slots) return selection;
  return [...selection, franchiseId];
}

/** Move a selected team one place up (-1) or down (+1). No-op at the ends. */
export function moveTeam(selection: string[], franchiseId: string, delta: -1 | 1): string[] {
  const idx = selection.indexOf(franchiseId);
  if (idx < 0) return selection;
  const target = idx + delta;
  if (target < 0 || target >= selection.length) return selection;
  const next = [...selection];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/** A ballot may only be submitted at exactly `slots` — see validateBallot. */
export function isComplete(selection: string[], slots: number): boolean {
  return selection.length === slots;
}

/** 1-indexed slot for a team, or null when unpicked. */
export function slotOf(selection: string[], franchiseId: string): number | null {
  const idx = selection.indexOf(franchiseId);
  return idx < 0 ? null : idx + 1;
}

/**
 * Normalize a server-supplied starting selection (a submitted ballot, or last
 * week's prefill) against the field currently on the page.
 *
 * Drops ids the page doesn't know and anything past `slots`, so a prefill that
 * has gone stale — a franchise left, the depth changed — opens as a shorter
 * ballot the owner can finish, rather than one that looks complete and is
 * rejected on submit.
 */
export function sanitizeSelection(
  ranking: readonly string[] | null | undefined,
  eligibleFranchiseIds: readonly string[],
  slots: number,
): string[] {
  if (!Array.isArray(ranking)) return [];
  const eligible = new Set(eligibleFranchiseIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranking) {
    if (typeof id !== 'string') continue;
    if (!eligible.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === slots) break;
  }
  return out;
}
