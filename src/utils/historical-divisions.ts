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

import { aliasDivisionName, isUsableDivisionName } from './division-aliases.mjs';

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
 * apply the same one.
 */
export type DivisionAliases = Record<string, string>;

// Re-exported from the shared .mjs so this module stays the single import site
// for page code. The implementation lives there because
// scripts/compute-franchise-history.mjs needs the identical function and cannot
// import a .ts — see division-aliases.mjs for why that matters.
export { aliasDivisionName, isUsableDivisionName };

const toArray = <T,>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

/**
 * Pull the per-season division map out of a raw MFL `league.json` payload.
 * Returns null when the feed is absent, errored, or missing either half of the
 * mapping — callers should fall back to the config's current alignment.
 */
export function parseHistoricalDivisions(
  leagueFeed: unknown,
  aliases?: DivisionAliases | null
): HistoricalDivisions | null {
  // Unwrap a Vite glob namespace. `import.meta.glob(..., { eager: true })`
  // hands back the module, and whether the JSON's keys survive as named exports
  // depends on Vite's json.stringify setting — under `'auto'` (today) they do,
  // so `feed.league` resolves either way. If that ever flips, reading the
  // namespace directly would find no `league`, return null, and silently revert
  // the page to today's alignment with no error anywhere. Cheap to be explicit.
  const raw = leagueFeed as Record<string, any> | undefined;
  const feed = (raw && typeof raw === 'object' && 'default' in raw ? raw.default : raw) as
    | { league?: Record<string, any>; error?: unknown }
    | undefined;
  if (!feed || feed.error || !feed.league) return null;

  const divisionEntries = toArray<DivisionLike>(feed.league.divisions?.division)
    .filter(d => d?.id != null && isUsableDivisionName(d.name))
    .map(d => ({ id: String(d.id), name: aliasDivisionName(d.name, aliases) }));
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
  // Numeric-first so unpadded ids don't sort 1, 10, 2. Both leagues zero-pad
  // today ("00".."05"), but the AFL port is planned and MFL is not obliged to.
  const ordered = [...divisionEntries].sort(
    (a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)
  );

  // Dedupe by NAME. getDivisionStandings maps over config.divisions, so a
  // repeated name renders that division twice, each block holding the union of
  // both divisions' teams. Committed data is clean, but league.json is
  // refetched by roster-sync and this is one commissioner typo away.
  const divisions = [...new Set(ordered.map(d => d.name))];

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
  const resolved = parseHistoricalDivisions(leagueFeed, config?.divisionAliases);
  // Guard the one input that would throw rather than degrade — the module
  // header promises this never breaks a page, and TypeScript can't help when
  // an .astro passes an `any`-shaped config.
  if (!resolved || !Array.isArray(config?.teams)) return config;

  const teams = config.teams.map(team => {
    const division = resolved.byFranchiseId[team.franchiseId];
    return division ? { ...team, division } : team;
  });

  // Only surface divisions that actually have a team in them this season —
  // getDivisionStandings filters on membership anyway, but keeping the list
  // tight avoids advertising an empty division in any consumer that renders
  // `config.divisions` directly.
  const populated = new Set(teams.map(t => t.division).filter(Boolean));
  const fromFeed = resolved.divisions.filter(d => populated.has(d));

  // Any division still populated but NOT named by the feed — i.e. held by a
  // franchise the feed omitted, which kept its configured division above.
  // `getDivisionStandings` treats `config.divisions` as the authoritative
  // order and filters out anything missing from it, so leaving these off would
  // drop those teams from the table entirely — exactly the vanishing act the
  // per-team fallback exists to prevent. Feed order first, stragglers after.
  const leftovers = [...populated].filter(d => !fromFeed.includes(d));
  const divisions = [...fromFeed, ...leftovers];

  return {
    ...config,
    teams,
    divisions: divisions.length ? divisions : config.divisions,
  };
}
