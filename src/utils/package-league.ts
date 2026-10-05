/**
 * Pure view-model helpers for the package-league pages (the first is
 * archies — docs/plans/league-chat-and-persona.md). No I/O: every function
 * takes the raw MFL feed the route already loaded, so each is unit-tested
 * against fixtures rather than against a live league.
 *
 * STANDINGS ARE NEVER RE-SORTED. MFL's `leagueStandings` order already applies
 * the league's tiebreakers, including ones this site cannot reproduce
 * (docs/claude/rules/standings-brackets-draft-order.md). Grouping by division
 * is a stable FILTER over that order — a team's place inside its division is
 * its position in MFL's list, full stop.
 */

export interface PackageTeam {
  franchiseId: string;
  name: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
  divisionId?: string;
  icon?: string;
  colorPrimary?: string;
}

export interface PackageDivision {
  id: string;
  name: string;
}

export interface StandingRow {
  /** 1-based place inside the division, in MFL's order. */
  place: number;
  franchiseId: string;
  name: string;
  icon?: string;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  victoryPoints: number | null;
  pointsFor: number;
}

export interface DivisionStandings {
  division: PackageDivision;
  rows: StandingRow[];
}

function arrayOf<T>(v: T | T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** MFL's standings rows, in MFL's order. */
export function standingsRows(feed: unknown): Record<string, unknown>[] {
  const f = feed as { leagueStandings?: { franchise?: unknown } } | null;
  return arrayOf(f?.leagueStandings?.franchise as Record<string, unknown> | Record<string, unknown>[]);
}

/**
 * Standings grouped by division, divisions in config order, rows in MFL order.
 *
 * A team the standings feed lists but the config does not know still shows,
 * under its MFL name — an owner must never vanish from the table because the
 * branding file lags a franchise change. A team with no division lands in a
 * trailing "Unassigned" group rather than being dropped.
 */
export function groupStandingsByDivision(
  feed: unknown,
  teams: PackageTeam[],
  divisions: PackageDivision[],
): DivisionStandings[] {
  const byId = new Map(teams.map((t) => [t.franchiseId, t]));
  const groups = new Map<string, StandingRow[]>();
  const order = [...divisions];

  for (const raw of standingsRows(feed)) {
    const id = String(raw.id ?? '');
    if (!id) continue;
    const team = byId.get(id);
    const divId = team?.divisionId ?? '';
    if (!groups.has(divId)) groups.set(divId, []);
    const rows = groups.get(divId)!;
    const wins = num(raw.h2hw);
    const losses = num(raw.h2hl);
    const ties = num(raw.h2ht);
    rows.push({
      place: rows.length + 1,
      franchiseId: id,
      name: team?.name ?? String(raw.fname ?? `Team ${id}`),
      icon: team?.icon,
      record: ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
      wins,
      losses,
      ties,
      victoryPoints: raw.vp == null || raw.vp === '' ? null : num(raw.vp),
      pointsFor: num(raw.pf),
    });
  }

  const out: DivisionStandings[] = [];
  for (const division of order) {
    const rows = groups.get(division.id);
    if (rows?.length) out.push({ division, rows });
    groups.delete(division.id);
  }
  const leftovers = [...groups.values()].flat();
  if (leftovers.length) {
    out.push({
      division: { id: '', name: 'Unassigned' },
      rows: leftovers.map((r, i) => ({ ...r, place: i + 1 })),
    });
  }
  return out;
}

/** Each division's leader, for the homepage snapshot. */
export function divisionLeaders(groups: DivisionStandings[]): Array<{ division: PackageDivision; leader: StandingRow }> {
  return groups.filter((g) => g.rows.length > 0).map((g) => ({ division: g.division, leader: g.rows[0] }));
}

/** Player ids on one franchise's roster, in feed order, with MFL status. */
export function rosterPlayerIds(feed: unknown, franchiseId: string): Array<{ id: string; status: string }> {
  const f = feed as { rosters?: { franchise?: unknown } } | null;
  const franchise = arrayOf(f?.rosters?.franchise as Record<string, unknown> | Record<string, unknown>[]).find(
    (r) => String(r.id) === franchiseId,
  );
  return arrayOf(franchise?.player as Record<string, unknown> | Record<string, unknown>[])
    .map((p) => ({ id: String(p.id ?? ''), status: String(p.status ?? 'ROSTER') }))
    .filter((p) => p.id);
}
