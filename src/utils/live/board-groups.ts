/**
 * Divisions on a league's live board — the picker Archie's needs.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * Archie's plays 99 matchups a week (99 franchises, two games each, nine
 * divisions), and a board that lists every one is a scroll nobody finishes.
 * The owner's call (2026-09-29): the viewer's own games first as everywhere,
 * then a chip row — My division (the default when signed in), All, and each
 * division. A division shows every game with a team FROM it, because about a
 * third of Archie's games cross divisions and hiding half of one would hide a
 * game its own division is playing.
 *
 * ── WHO GETS IT ────────────────────────────────────────────────────────────
 * Only a league whose config declares `structure: 'divisions'` — the package
 * leagues `suggest-league-branding.mjs` writes. TheLeague (16 teams, no
 * declared structure) and the AFL (`two-conference`) carry divisions in their
 * configs too, but their boards fit a screen and are left exactly as they
 * were; nothing on them renders differently because this file exists.
 *
 * Pure. The builder takes the teams it is given, so the client can import the
 * filter helpers without pulling any league config into its bundle.
 */
import type { LiveMatchup, LivePanelGroup } from '../../types/live';

/** The picker's value: a division id, or every game. */
export const ALL_GROUPS = 'all';

interface GroupSourceTeam {
  franchiseId?: string;
  division?: string;
  divisionId?: string;
}

/**
 * The league's divisions, in id order, or `undefined` when the board should
 * not offer a picker. `undefined` — never `[]` — so a league without one
 * serializes exactly as it did before.
 */
export function buildPanelGroups(
  structure: string | null,
  teams: readonly GroupSourceTeam[],
): LivePanelGroup[] | undefined {
  if (structure !== 'divisions') return undefined;

  const byId = new Map<string, LivePanelGroup>();
  for (const t of teams) {
    const fid = t?.franchiseId;
    const id = t?.divisionId ?? t?.division;
    if (!fid || !id) continue;
    let group = byId.get(id);
    if (!group) {
      group = { id, name: (t.division ?? id).trim(), franchiseIds: [] };
      byId.set(id, group);
    }
    group.franchiseIds.push(fid);
  }
  // One division is not a choice.
  if (byId.size < 2) return undefined;
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The division the viewer's franchise plays in, or null. */
export function viewerGroupId(
  groups: readonly LivePanelGroup[] | undefined,
  viewerFranchiseId: string | null | undefined,
): string | null {
  if (!groups || !viewerFranchiseId) return null;
  return groups.find((g) => g.franchiseIds.includes(viewerFranchiseId))?.id ?? null;
}

/**
 * The games to show for a pick: every game with at least one side from the
 * division. `ALL_GROUPS`, or an id this league does not have (a stale choice
 * after a re-alignment), shows everything rather than nothing.
 */
export function filterMatchupsByGroup(
  matchups: readonly LiveMatchup[],
  groups: readonly LivePanelGroup[] | undefined,
  groupId: string,
): LiveMatchup[] {
  if (!groups || groupId === ALL_GROUPS) return [...matchups];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [...matchups];
  const members = new Set(group.franchiseIds);
  return matchups.filter((m) => m.sides.some((s) => members.has(s.franchiseId)));
}

/**
 * A chip label. MFL names every Archie's division "<Legend> Division", and
 * nine chips each ending in the same word is width spent on nothing — the row
 * already says what it is.
 */
export function groupChipLabel(name: string): string {
  const short = name.replace(/\s+division\s*$/i, '').trim();
  return short || name;
}
