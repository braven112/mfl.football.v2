/**
 * Read league data (feeds, derived files, src/data JSON) without bundling it
 * into the serverless function.
 *
 * The site is one Vercel function with a hard 250 MB limit, and every file a
 * page pulled in with a static `import` or an `import.meta.glob` was compiled
 * into it — so each new league cost 10-30 MB and the number of leagues was
 * capped. In production this reads the file from Vercel Blob, where the build
 * published it (scripts/publish-league-data.mjs); in dev and tests it reads the
 * committed file off disk. Paths are repo-relative, exactly as in git:
 * `data/afl-fantasy/mfl-feeds/2019/players.json`.
 *
 * Two ways to read:
 *
 *   - `await loadLeagueData(path)` — anywhere async (page frontmatter, API
 *     routes). Missing file → null.
 *   - `await preloadLeagueData(paths)` once per request, then
 *     `getLeagueData(path)` synchronously — for existing sync helpers
 *     (player-map and friends) that should not all turn async. A sync read of
 *     a path nobody preloaded THROWS, in dev too, so a missed preload fails on
 *     a laptop instead of only in production.
 *
 * Files are cached in memory for as long as the server instance stays warm,
 * so a busy page pays the fetch once, not per request.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  base: string;
  files: Record<string, string>;
}

const BLOB_PREFIX = 'league-data/';

// A glob, not a static import: the manifest exists only after the publish
// step has run, and an eager glob over a missing file is `{}` instead of a
// build failure (same pattern as owner-last-visit.json).
const manifestModules = import.meta.glob<Manifest>('../generated/league-data-manifest.json', {
  eager: true,
  import: 'default',
});
const builtManifest: Manifest | null = Object.values(manifestModules)[0] ?? null;

let manifestOverride: Manifest | null | undefined;

function activeManifest(): Manifest | null {
  if (manifestOverride !== undefined) return manifestOverride;
  if (import.meta.env.DEV) return null;
  // The CI measurement build writes a placeholder base and is never served.
  if (!builtManifest?.base?.startsWith('http')) return null;
  return builtManifest;
}

/** Parsed files, keyed by path. Holds the promise so concurrent reads share one fetch. */
const cache = new Map<string, Promise<unknown>>();
/** Settled values, for the sync reader. */
const settled = new Map<string, unknown>();

/** Raw bytes per settled file, for the memory budget. */
const sizes = new Map<string, number>();
let cachedBytes = 0;

/**
 * Raw JSON bytes kept in memory. Parsed objects run several times their raw
 * size, so this keeps the cache well inside the function's memory: every
 * season of every league's players.json is ~1.4 MB each.
 */
const MAX_CACHED_BYTES = 150 * 1024 * 1024;

function evictFor(bytes: number) {
  // Oldest first: Map iterates in insertion order.
  for (const key of sizes.keys()) {
    if (cachedBytes + bytes <= MAX_CACHED_BYTES) break;
    cachedBytes -= sizes.get(key) ?? 0;
    sizes.delete(key);
    cache.delete(key);
    settled.delete(key);
  }
}

function settle(key: string, value: unknown, bytes: number) {
  evictFor(bytes);
  sizes.set(key, bytes);
  cachedBytes += bytes;
  settled.set(key, value);
}

function normalize(path: string): string {
  return path.replace(/^\.?\//, '');
}

function readFromDisk(path: string): { value: unknown; bytes: number } {
  const abs = join(process.cwd(), path);
  if (!existsSync(abs)) return { value: null, bytes: 0 };
  const text = readFileSync(abs, 'utf8');
  return { value: JSON.parse(text), bytes: text.length };
}

async function readFromStore(manifest: Manifest, path: string): Promise<{ value: unknown; bytes: number }> {
  const hash = manifest.files[path];
  if (!hash) return { value: null, bytes: 0 };
  const url = `${manifest.base}${BLOB_PREFIX}${hash}.json`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return { value: JSON.parse(text), bytes: text.length };
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`[league-data] could not read ${path} from the store:`, lastError);
  throw new Error(`League data unavailable: ${path}`);
}

/** The parsed file, or null when it does not exist. */
export function loadLeagueData<T = unknown>(path: string): Promise<T | null> {
  const key = normalize(path);
  let p = cache.get(key);
  if (!p) {
    const manifest = activeManifest();
    p = (manifest ? readFromStore(manifest, key) : Promise.resolve().then(() => readFromDisk(key))).then(
      ({ value, bytes }) => {
        settle(key, value, bytes);
        return value;
      },
      (err) => {
        cache.delete(key); // let the next request retry
        throw err;
      },
    );
    cache.set(key, p);
  }
  return p as Promise<T | null>;
}

/** Load several files at once so later `getLeagueData` calls can read them synchronously. */
export async function preloadLeagueData(paths: Iterable<string>): Promise<void> {
  await Promise.all([...paths].map((p) => loadLeagueData(p)));
}

/** Synchronous read of a file that was loaded or preloaded earlier. Throws if it was not. */
export function getLeagueData<T = unknown>(path: string): T | null {
  const key = normalize(path);
  if (!settled.has(key)) {
    throw new Error(
      `getLeagueData('${key}') before it was loaded — await preloadLeagueData([...]) first (src/utils/league-data.ts).`,
    );
  }
  return settled.get(key) as T | null;
}

/** `data/<league>/mfl-feeds/<year>/<file>` — one committed MFL feed, as a loader path. */
export function leagueFeedPath(dataPath: string, year: number | string, file: string): string {
  return `${normalize(dataPath).replace(/\/+$/, '')}/mfl-feeds/${year}/${file}`;
}

/** Whether `path` has been loaded (or preloaded) and is still in memory. */
export function isLeagueDataLoaded(path: string): boolean {
  return settled.has(normalize(path));
}

const warnedUnloaded = new Set<string>();

/**
 * The forgiving sync read, for long-standing sync helpers whose callers are
 * not all able to preload yet (a page that renders a historical season, a
 * component nobody has converted). The preloaded value when there is one;
 * otherwise the file read off disk — which works in dev and for any file
 * still shipped inside the function, and comes back null for a file
 * FUNCTION_EXCLUDED has moved out — and a warning, once per path, naming the
 * preload that was missed. Never throws, so a missed preload degrades one
 * table instead of 500ing the page.
 *
 * A helper that caches what it builds must not cache a result read this way
 * while `isLeagueDataLoaded(path)` is false: the request that DOES preload
 * would otherwise keep being served the miss.
 */
export function readLeagueDataSync<T = unknown>(path: string): T | null {
  const key = normalize(path);
  if (settled.has(key)) return settled.get(key) as T | null;
  if (!warnedUnloaded.has(key) && import.meta.env.MODE !== 'test') {
    warnedUnloaded.add(key);
    console.warn(
      `[league-data] ${key} read synchronously before it was preloaded — falling back to disk. ` +
        'Await the helper’s preload (or preloadLeagueData) first; an excluded file reads back null in production.',
    );
  }
  try {
    const { value, bytes } = readFromDisk(key);
    // A file that WAS on disk is the real thing: keep it, so the next sync
    // read is a lookup rather than another parse. A miss stays unsettled so
    // a later preload can still fill it.
    if (value !== null) {
      settle(key, value, bytes);
      cache.set(key, Promise.resolve(value));
    }
    return value as T | null;
  } catch {
    return null;
  }
}

/** Whether a file exists, without reading it. */
export function hasLeagueData(path: string): boolean {
  const key = normalize(path);
  const manifest = activeManifest();
  if (manifest) return key in manifest.files;
  return existsSync(join(process.cwd(), key));
}

/**
 * Every existing path matching `pattern`, where `*` stands for exactly one
 * path segment — `data/afl-fantasy/mfl-feeds/*\/players.json` lists one file
 * per season. Sorted. The replacement for the keys of an `import.meta.glob`.
 */
export function listLeagueData(pattern: string): string[] {
  const parts = normalize(pattern).split('/');
  const re = new RegExp(
    `^${parts.map((s) => s.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/')}$`,
  );
  const manifest = activeManifest();
  if (manifest) return Object.keys(manifest.files).filter((f) => re.test(f)).sort();

  // Disk: expand one segment at a time so a pattern never walks all of data/.
  let found = [''];
  for (const seg of parts) {
    const next: string[] = [];
    for (const dir of found) {
      if (!seg.includes('*')) {
        next.push(dir ? `${dir}/${seg}` : seg);
        continue;
      }
      const abs = join(process.cwd(), dir);
      if (!existsSync(abs)) continue;
      const segRe = new RegExp(`^${seg.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      for (const name of readdirSync(abs)) if (segRe.test(name)) next.push(dir ? `${dir}/${name}` : name);
    }
    found = next;
  }
  return found.filter((f) => existsSync(join(process.cwd(), f))).sort();
}

/** Tests only: pretend a manifest was (or was not) built, and drop the cache. */
export function __setLeagueDataManifestForTests(manifest: Manifest | null | undefined): void {
  manifestOverride = manifest;
  cache.clear();
  settled.clear();
  sizes.clear();
  cachedBytes = 0;
}
