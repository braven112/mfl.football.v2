/**
 * An eager `import.meta.glob` result, built at request time through the league
 * data loader instead of compiled into the server chunk.
 *
 * TheLeague's roster page fed ~5 MB of feeds (every current-era season's
 * players, salaries, rosters, transactions…) into its chunk through eager
 * globs, and a page body of 7k lines reads them as `{ [relativePath]: module }`.
 * This returns exactly that shape — same keys, same `{ default }` wrapping —
 * so the page's consumers stay untouched while the bytes leave the bundle
 * (src/utils/league-data.ts; docs/claude/rules/storage-and-build.md
 * § "League data lives in Blob").
 *
 * Server only: the loader reads node:fs in dev. Never import this from a
 * client script.
 */
import { posix } from 'node:path';
import { listLeagueData, loadLeagueData } from '../league-data';

export interface LoadedFeedGlobOptions {
  /**
   * Repo-relative directory of the file that used to own the glob
   * (`src/pages/theleague`). Keys are made relative to it, exactly as Vite
   * keyed the glob there.
   */
  relativeTo: string;
  /** Keep only the matched repo-relative paths this accepts (a year filter). */
  keep?: (repoPath: string) => boolean;
  /** Like the glob's `import: 'default'`: values are the data, not `{ default }`. */
  importDefault?: boolean;
}

/** The glob key Vite gave `repoPath` in a file under `relativeTo`. */
export function globKeyFor(repoPath: string, relativeTo: string): string {
  const rel = posix.relative(relativeTo, repoPath);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Load every file matching `pattern` (repo-relative, `*` = one path segment;
 * see `listLeagueData`) that `keep` accepts, in parallel, keyed like the eager
 * glob it replaces. A file the store lost is left out, as a glob would.
 */
export async function loadFeedGlob(
  pattern: string,
  { relativeTo, keep, importDefault = false }: LoadedFeedGlobOptions,
): Promise<Record<string, unknown>> {
  const paths = listLeagueData(pattern).filter((p) => (keep ? keep(p) : true));
  const values = await Promise.all(paths.map((p) => loadLeagueData(p)));
  const out: Record<string, unknown> = {};
  paths.forEach((p, i) => {
    const data = values[i];
    if (data === null || data === undefined) return;
    out[globKeyFor(p, relativeTo)] = importDefault ? data : { default: data };
  });
  return out;
}
