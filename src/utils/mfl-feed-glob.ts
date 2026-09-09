/**
 * Reading ONE season out of a lazy `import.meta.glob` over the MFL feeds.
 *
 * Every multi-season page hits the same two problems. A static import
 * specifier cannot be a runtime variable, so the glob has to be built in the
 * route; and a cron-generated feed must not be a static import at all,
 * because the build hard-fails until the workflow has run once — for every
 * league, not just the one being waited on (docs/claude/rules/storage-and-build.md).
 *
 * LAZY, NOT EAGER, and that is the point: the glob's KEYS answer "which
 * seasons exist" for free at build time while only the season being viewed is
 * ever read. TheLeague's 20 seasons of transactions are ~2.6 MB and the AFL's
 * draftResults are 1.2 MB across 24 years — eager-globbing either puts all of
 * it in the serverless chunk to render one page.
 *
 * Extracted from `draft-results-feeds.ts`, which still re-exports the two
 * names its callers already use.
 */

/** What Vite hands back for a lazy glob. */
export type LazyFeedGlob = Record<string, () => Promise<unknown>>;

/** The season a feed path belongs to, or null if the path is not one. */
export function seasonOf(path: string): number | null {
  const m = path.match(/mfl-feeds\/(\d{4})\//);
  return m ? parseInt(m[1], 10) : null;
}

/** Every season the glob matched, ascending. */
export function seasonsFromGlob(feeds: LazyFeedGlob): number[] {
  return Object.keys(feeds)
    .map(seasonOf)
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
}

/** A module may be the JSON itself or a `{ default }` wrapper. */
export function unwrapFeedModule(mod: unknown): unknown {
  return mod && typeof mod === 'object' && 'default' in (mod as Record<string, unknown>)
    ? (mod as { default: unknown }).default
    : mod;
}

/**
 * Read one season's feed, or null.
 *
 * Never throws: a season the glob does not carry, or a feed that fails to
 * parse, is "no data for that year" — which the page renders as an empty
 * state. A 500 here would take out the whole page for one bad archive file.
 */
export async function loadSeasonFeed(feeds: LazyFeedGlob, year: number): Promise<unknown | null> {
  const key = Object.keys(feeds).find((p) => seasonOf(p) === year);
  if (!key) return null;
  try {
    return unwrapFeedModule(await feeds[key]());
  } catch {
    return null;
  }
}

/**
 * Pick the season to open on: the requested one when it exists, else the
 * newest the glob carries.
 *
 * `year` arriving as anything at all is normal — it is a URL param — so an
 * unparseable or unavailable value falls back rather than 404s.
 */
export function resolveSeason(
  requested: string | null | undefined,
  availableYears: number[],
  preferred?: number
): number | null {
  if (availableYears.length === 0) return null;
  const asked = Number(requested);
  if (Number.isInteger(asked) && availableYears.includes(asked)) return asked;
  if (preferred && availableYears.includes(preferred)) return preferred;
  return Math.max(...availableYears);
}
