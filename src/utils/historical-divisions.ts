/**
 * Per-season division alignment, read from that season's own MFL `league.json`.
 *
 * WHY THIS EXISTS
 *
 * `resolveConfigForYear` (src/utils/team-names.ts) resolves a franchise's
 * historical name, icon, banner and conference — but NOT its division. Every
 * standings surface groups on `getTeamConfig(...).division`, which is TODAY's
 * alignment, so an archived season was rendered with the current division map
 * regardless of how the league was actually organized that year.
 *
 * For TheLeague that silently mis-grouped every season from 2007 to 2016, and
 * showed the wrong winner in 21 of 76 division-seasons. Concretely:
 *
 *   - 2007-2010 ran Pacific / Midwest / Central / Atlantic — division names that
 *     do not exist today at all.
 *   - 2011-2016 realigned repeatedly; up to 9 of 16 franchises sat in a
 *     different division than they do now.
 *   - From 2017 on the grouping happens to match today's, so those seasons were
 *     already correct.
 *
 * Separately, MFL's archives name the fourth division "Eastern" from 2012 on
 * while the league displays it as "East". That is handled by `divisionAliases`
 * in the league config rather than by adopting MFL's spelling — see
 * `aliasDivisionName`.
 *
 * The sharpest symptom: `/theleague/standings?year=2015` credited the Central
 * title to a different franchise than `/theleague/franchises/[id]` did, because
 * the two disagreed about who was even in the Central.
 *
 * MFL's `league.json` is the source of truth here, same as its standings row
 * order is for rankings — it carries the real per-season mapping in
 * `league.divisions.division[] = { id, name }` and
 * `league.franchises.franchise[] = { id, division }`.
 *
 * FAIL-SAFE BY DESIGN: every parse failure returns null / leaves the config
 * untouched. A missing or malformed feed degrades to today's alignment (the old
 * behavior) rather than throwing or emitting an empty standings table.
 */

type FranchiseLike = { id?: string; division?: string | number };
type DivisionLike = { id?: string | number; name?: string };

export type HistoricalDivisions = {
  /** Division names for that season, ordered by MFL division id. */
  divisions: string[];
  /** franchiseId -> that season's division NAME. */
  byFranchiseId: Record<string, string>;
};

/**
 * MFL name -> display name, e.g. `{ Eastern: 'East' }`. Lives in the league's
 * config (`divisionAliases`) so the pages and the franchise-history script
 * apply the same one. Keys starting with `_` are ignored so the JSON can carry
 * a `_comment`.
 */
export type DivisionAliases = Record<string, string>;

const toArray = <T,>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

/** Resolve one MFL division name to its display name. */
export function aliasDivisionName(name: string, aliases?: DivisionAliases | null): string {
  if (!aliases) return name;
  const mapped = aliases[name];
  return typeof mapped === 'string' && !name.startsWith('_') ? mapped : name;
}

/**
 * Pull the per-season division map out of a raw MFL `league.json` payload.
 * Returns null when the feed is absent, errored, or missing either half of the
 * mapping — callers should fall back to the config's current alignment.
 */
export function parseHistoricalDivisions(
  leagueFeed: unknown,
  aliases?: DivisionAliases | null
): HistoricalDivisions | null {
  const feed = leagueFeed as { league?: Record<string, any>; error?: unknown } | undefined;
  if (!feed || feed.error || !feed.league) return null;

  const divisionEntries = toArray<DivisionLike>(feed.league.divisions?.division)
    .filter(d => d?.id != null && typeof d.name === 'string' && d.name.trim() !== '')
    .map(d => ({ id: String(d.id), name: aliasDivisionName(String(d.name).trim(), aliases) }));
  if (!divisionEntries.length) return null;

  const nameById = new Map(divisionEntries.map(d => [d.id, d.name]));

  const byFranchiseId: Record<string, string> = {};
  for (const franchise of toArray<FranchiseLike>(feed.league.franchises?.franchise)) {
    if (!franchise?.id || franchise.division == null) continue;
    const name = nameById.get(String(franchise.division));
    if (name) byFranchiseId[franchise.id] = name;
  }
  if (!Object.keys(byFranchiseId).length) return null;

  // Order by MFL's division id — that's the order MFL itself presents them in,
  // and it keeps the rendered column order stable across a realignment.
  const divisions = [...divisionEntries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(d => d.name);

  return { divisions, byFranchiseId };
}

/**
 * Rewrite a league config's division alignment to match a given season.
 *
 * Compose this AFTER `resolveConfigForYear`, which handles names/icons:
 *
 *   const config = applyHistoricalDivisions(
 *     resolveConfigForYear(leagueConfig, year),
 *     leagueFeeds[`.../${year}/league.json`]
 *   );
 *
 * A franchise the feed doesn't mention keeps its configured division, so a
 * partial feed degrades per-team instead of dropping anyone from the table.
 */
export function applyHistoricalDivisions<
  T extends {
    teams: Array<Record<string, any>>;
    divisions?: string[];
    divisionAliases?: DivisionAliases;
  },
>(config: T, leagueFeed: unknown): T {
  // Aliases come off the config itself, so callers can't forget to pass them
  // and drift from what the franchise-history script writes.
  const resolved = parseHistoricalDivisions(leagueFeed, config.divisionAliases);
  if (!resolved) return config;

  const teams = config.teams.map(team => {
    const division = resolved.byFranchiseId[team.franchiseId];
    return division ? { ...team, division } : team;
  });

  // Only surface divisions that actually have a team in them this season —
  // getDivisionStandings filters on membership anyway, but keeping the list
  // tight avoids advertising an empty division in any consumer that renders
  // `config.divisions` directly.
  const populated = new Set(teams.map(t => t.division));
  const divisions = resolved.divisions.filter(d => populated.has(d));

  return {
    ...config,
    teams,
    divisions: divisions.length ? divisions : config.divisions,
  };
}
