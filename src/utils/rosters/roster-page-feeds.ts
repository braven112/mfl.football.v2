/**
 * Feed lookup for the shared rosters page (src/components/shared/rosters/).
 *
 * The page is rendered by more than one league, and a static import specifier
 * cannot be a runtime variable, so each league's thin route owns its LITERAL
 * `import.meta.glob(...)` calls and hands the eager results down. Globbing
 * every league's feeds inside the shared component would bundle every
 * league's seasons into every render.
 *
 * The component then asks for "this year's rosters.json" by SUFFIX, so it
 * never spells a league's data path — the route's glob already decided that.
 */

/** An eager `import.meta.glob` result: path → module (or default export). */
export type EagerFeedGlob = Record<string, unknown>;

/** Unwrap a module's `default` export when the glob was not `import: 'default'`. */
export function moduleData(mod: unknown): any {
  return mod && typeof mod === 'object' && 'default' in (mod as object)
    ? (mod as { default: unknown }).default
    : mod;
}

/**
 * The feed file for one year, or undefined. Matches `/<year>/<file>` at the
 * END of the glob key, so `2025/rosters.json` never matches `12025/...` and
 * `rosters.json` never matches `old-rosters.json`.
 */
export function feedForYear(glob: EagerFeedGlob | null | undefined, year: number, file: string): any {
  if (!glob) return undefined;
  const suffix = `/${year}/${file}`;
  for (const [path, mod] of Object.entries(glob)) {
    if (path.endsWith(suffix)) return moduleData(mod);
  }
  return undefined;
}

/**
 * Years whose rosters.json carries real franchises, newest first. An empty or
 * errored placeholder (a league year MFL has not created yet) is skipped, so
 * the year picker never offers a season with nothing in it.
 */
export function rosterYears(rostersGlob: EagerFeedGlob): number[] {
  return Object.entries(rostersGlob)
    .map(([path, mod]) => {
      const match = path.match(/\/(\d{4})\/rosters\.json$/);
      if (!match) return null;
      return moduleData(mod)?.rosters?.franchise ? parseInt(match[1], 10) : null;
    })
    .filter((year): year is number => year !== null)
    .sort((a, b) => b - a);
}

/** `?year=` when it names an available year, else the newest, else the fallback. */
export function resolveRosterYear(
  requested: string | null | undefined,
  availableYears: number[],
  fallbackYear: number,
): number {
  const parsed = requested ? parseInt(requested, 10) : NaN;
  return !isNaN(parsed) && availableYears.includes(parsed)
    ? parsed
    : (availableYears[0] ?? fallbackYear);
}

/** Whether a year has both the rosters and the players the page needs. */
export function rosterYearIsRenderable(
  rostersGlob: EagerFeedGlob,
  playersGlob: EagerFeedGlob,
  year: number,
): boolean {
  return (
    !!feedForYear(rostersGlob, year, 'rosters.json')?.rosters?.franchise &&
    !!feedForYear(playersGlob, year, 'players.json')?.players?.player
  );
}
