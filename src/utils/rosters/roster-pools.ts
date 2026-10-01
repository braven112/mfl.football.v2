/**
 * Player pools for the shared rosters page (src/components/shared/rosters/).
 *
 * A "pool" is the unit a club competes in and draws players from. The AFL has
 * two conferences, each its own player pool; a single-table league such as
 * Archie's (`playerLimitUnit: DIVISION`) makes each DIVISION its own pool. The
 * page ranks the header standing inside the club's pool ("2nd of 12", "3rd of
 * 11") and orders the team switcher around the viewer's own pool — so one rule
 * decides which of the two a league uses, here, rather than a league name
 * check in the page.
 *
 * The same split as `buildPoolStructure` (src/utils/afl-conference-rosters.mjs),
 * which reads MFL's own league export; this one reads the team config the page
 * is handed, which is what the header already renders from.
 */

export interface PoolConference {
  name: string;
  code: string;
  divisions?: string[];
}

export interface PoolDivision {
  id: string;
  name: string;
}

export interface PoolTeam {
  franchiseId: string;
  division: string;
  divisionId?: string;
  conference?: string;
}

export interface RosterPools {
  /** True when the league has two or more conferences — they are the pools. */
  usesConferences: boolean;
  /** The pools, in display order, in the `{ name, code }` shape `summarizeStandings` takes. */
  pools: Array<{ name: string; code: string }>;
  /** The pool code a club belongs to ('' when it has none). */
  poolOf: (team: PoolTeam | null | undefined) => string;
}

export function rosterPools(
  conferences: PoolConference[] | null | undefined,
  divisions: PoolDivision[] | null | undefined,
): RosterPools {
  const confs = Array.isArray(conferences) ? conferences : [];
  const divs = Array.isArray(divisions) ? divisions : [];
  const usesConferences = confs.length > 1;
  return {
    usesConferences,
    pools: usesConferences
      ? confs.map((c) => ({ name: c.name, code: c.code }))
      : divs.map((d) => ({ name: d.name, code: d.id })),
    poolOf: (team) => String((usesConferences ? team?.conference : team?.divisionId) ?? ''),
  };
}

/**
 * The nameplate's kicker: "American League · North" where conferences are the
 * pools, the division alone where the division IS the pool.
 */
export function teamPoolLabel(team: PoolTeam, conferences: PoolConference[] | null | undefined): string {
  const confs = Array.isArray(conferences) ? conferences : [];
  if (confs.length > 1) {
    const name = confs.find((c) => c.code === String(team.conference ?? ''))?.name;
    return name ? `${name} · ${team.division}` : team.division;
  }
  return team.division;
}

/**
 * A single-table league's division names for the switcher, the VIEWER's own
 * division first (never the viewed club's — an order that followed the club
 * on screen would reshuffle the row under the cursor on every switch). The
 * rest keep their config order. Null viewer → config order unchanged.
 */
export function viewerFirstDivisionNames(
  divisions: PoolDivision[] | null | undefined,
  viewerDivisionId: string | null | undefined,
): string[] {
  const divs = Array.isArray(divisions) ? divisions : [];
  return [
    ...divs.filter((d) => d.id === viewerDivisionId),
    ...divs.filter((d) => d.id !== viewerDivisionId),
  ].map((d) => d.name);
}
