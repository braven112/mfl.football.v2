/**
 * A league's current-era MFL feeds, shaped like the `import.meta.glob` results
 * the shared Free Agents page was written against, but read through the
 * league-data loader (src/utils/league-data.ts) instead of compiled into the
 * function.
 *
 * Never bundled, for two reasons: bundling every league's feeds is what ran the
 * function into Vercel's 250 MB cap, and the roster sync publishes these files
 * without a build, so a compiled-in copy would stay at whatever the last deploy
 * saw (docs/claude/rules/storage-and-build.md § "League data lives in Blob").
 */
import { listLeagueData, loadLeagueData } from './league-data';

/** First season of the current era — the floor the replaced globs (`20{2[5-9],…}`) used. */
export const CURRENT_ERA_FLOOR = 2025;

/** Every current-era season's copy of `file` for a league, as loader paths. */
export function currentEraFeedPaths(dataPath: string, file: string): string[] {
  return listLeagueData(`${dataPath.replace(/\/+$/, '')}/mfl-feeds/*/${file}`).filter(
    (p) => Number(p.split('/').at(-2)) >= CURRENT_ERA_FLOOR,
  );
}

/** Eager-glob-shaped `{ path: { default } }`: every listed file loaded now. */
export async function eagerFeedModules(dataPath: string, file: string): Promise<Record<string, { default: unknown }>> {
  const paths = currentEraFeedPaths(dataPath, file);
  return Object.fromEntries(
    await Promise.all(paths.map(async (p) => [p, { default: await loadLeagueData(p) }] as const)),
  );
}

/** Lazy-glob-shaped `{ path: () => Promise<{ default }> }`: only the file asked for is fetched. */
export function lazyFeedModules(dataPath: string, file: string): Record<string, () => Promise<{ default: unknown }>> {
  return Object.fromEntries(
    currentEraFeedPaths(dataPath, file).map((p) => [p, () => loadLeagueData(p).then((d) => ({ default: d }))]),
  );
}
