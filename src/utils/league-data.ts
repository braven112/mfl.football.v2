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
 *
 * Data syncs can move what is read WITHOUT a deploy: the live pointer
 * (src/config/league-data-live.mjs) swaps the sync's slice of the manifest for
 * a newer one. The middleware calls `refreshLeagueData()` once per request; it
 * checks the pointer at most once a minute per instance. Cache keys are the
 * files' content hashes, so moved data is simply a different key, and helpers
 * that memoize something built from league data clear it through
 * `onLeagueDataChange`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEAGUE_DATA_SCHEMA,
  LIVE_CHECK_INTERVAL_MS,
  LIVE_POINTER_KEY,
  composeFiles,
  parsePointer,
  pointerIsStale,
} from '../config/league-data-live.mjs';

interface Manifest {
  base: string;
  files: Record<string, string>;
  /** The data layout the deploy was built with (src/config/league-data-live.mjs). */
  schema?: number;
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

/** The deploy's own manifest, or null when files are read off disk. */
function deployManifest(): Manifest | null {
  if (manifestOverride !== undefined) return manifestOverride;
  if (import.meta.env.DEV) return null;
  // The CI measurement build writes a placeholder base and is never served.
  if (!builtManifest?.base?.startsWith('http')) return null;
  return builtManifest;
}

/**
 * The live pointer's view: the deploy's manifest with the sync-owned slice
 * swapped for the one a data sync published. Null while no usable pointer is
 * in effect, so the deploy serves its own data.
 */
let live: { overlay: string; manifest: Manifest } | null = null;

/** What every read goes through: the live view when there is one, else the deploy's. */
function activeManifest(): Manifest | null {
  const deploy = deployManifest();
  if (!deploy) return null;
  return live?.manifest ?? deploy;
}

/**
 * Which data the reads resolve against right now: files off disk, the deploy's
 * manifest alone, or that plus a live overlay. Changes exactly when
 * `onLeagueDataChange` listeners fire.
 */
export function leagueDataVersion(): string {
  if (!deployManifest()) return 'disk';
  return live ? `live:${live.overlay}` : 'deploy';
}

/**
 * Cache key for a path under the active manifest. Stored files are named by
 * content, so the key is the HASH: when the pointer moves a path to new
 * content, its key changes and the old value is simply no longer found —
 * nothing to invalidate. A path the manifest lacks keys on the version, so a
 * file a later pointer adds is not shadowed by an old miss.
 */
function cacheKey(path: string): string {
  const manifest = activeManifest();
  if (!manifest) return `disk:${path}`;
  const hash = manifest.files[path];
  return hash ? `h:${hash}` : `miss:${leagueDataVersion()}:${path}`;
}

/** Parsed files, keyed by cacheKey. Holds the promise so concurrent reads share one fetch. */
const cache = new Map<string, Promise<unknown>>();
/** Settled values, keyed by cacheKey, for the sync reader. */
const settled = new Map<string, unknown>();
/**
 * The last value settled for each PATH, whatever its version. A sync read in a
 * request whose preload ran just before the pointer moved finds its file under
 * the old key only; it gets that value (one version stale, for that request)
 * rather than an error.
 */
const lastByPath = new Map<string, unknown>();

/** Raw bytes per settled file, for the memory budget. */
const sizes = new Map<string, number>();
/** The path each settled key holds, so eviction can drop its by-path fallback. */
const pathOfKey = new Map<string, string>();
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
    // The by-path fallback must not outlive the budget either.
    const path = pathOfKey.get(key);
    if (path !== undefined && lastByPath.get(path) === settled.get(key)) lastByPath.delete(path);
    pathOfKey.delete(key);
    sizes.delete(key);
    cache.delete(key);
    settled.delete(key);
  }
}

function settle(key: string, path: string, value: unknown, bytes: number) {
  evictFor(bytes);
  sizes.set(key, bytes);
  pathOfKey.set(key, path);
  cachedBytes += bytes;
  settled.set(key, value);
  lastByPath.set(path, value);
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

async function readBlob(base: string, hash: string, label: string): Promise<{ value: unknown; bytes: number }> {
  const url = `${base}${BLOB_PREFIX}${hash}.json`;
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
  console.error(`[league-data] could not read ${label} from the store:`, lastError);
  throw new Error(`League data unavailable: ${label}`);
}

async function readFromStore(manifest: Manifest, path: string): Promise<{ value: unknown; bytes: number }> {
  const hash = manifest.files[path];
  if (!hash) return { value: null, bytes: 0 };
  return readBlob(manifest.base, hash, path);
}

/** The parsed file, or null when it does not exist. */
export function loadLeagueData<T = unknown>(path: string): Promise<T | null> {
  const file = normalize(path);
  const key = cacheKey(file);
  let p = cache.get(key);
  if (!p) {
    const manifest = activeManifest();
    p = (manifest ? readFromStore(manifest, file) : Promise.resolve().then(() => readFromDisk(file))).then(
      ({ value, bytes }) => {
        settle(key, file, value, bytes);
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
  const file = normalize(path);
  const key = cacheKey(file);
  if (settled.has(key)) return settled.get(key) as T | null;
  if (lastByPath.has(file)) return lastByPath.get(file) as T | null;
  throw new Error(
    `getLeagueData('${file}') before it was loaded — await preloadLeagueData([...]) first (src/utils/league-data.ts).`,
  );
}

/** `data/<league>/mfl-feeds/<year>/<file>` — one committed MFL feed, as a loader path. */
export function leagueFeedPath(dataPath: string, year: number | string, file: string): string {
  return `${normalize(dataPath).replace(/\/+$/, '')}/mfl-feeds/${year}/${file}`;
}

/** Whether `path` has been loaded (or preloaded) at its current version and is still in memory. */
export function isLeagueDataLoaded(path: string): boolean {
  return settled.has(cacheKey(normalize(path)));
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
  const file = normalize(path);
  const key = cacheKey(file);
  if (settled.has(key)) return settled.get(key) as T | null;
  if (lastByPath.has(file)) return lastByPath.get(file) as T | null;
  if (!warnedUnloaded.has(file) && import.meta.env.MODE !== 'test') {
    warnedUnloaded.add(file);
    console.warn(
      `[league-data] ${file} read synchronously before it was preloaded — falling back to disk. ` +
        'Await the helper’s preload (or preloadLeagueData) first; an excluded file reads back null in production.',
    );
  }
  try {
    const { value, bytes } = readFromDisk(file);
    // A file that WAS on disk is the real thing: keep it, so the next sync
    // read is a lookup rather than another parse. A miss stays unsettled so
    // a later preload can still fill it. Under a live pointer the disk copy
    // is the deploy's, not the sync's, so it is returned but never cached.
    if (value !== null && !live) {
      settle(key, file, value, bytes);
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

// ── The live pointer ────────────────────────────────────────────────────────

type PointerReader = () => Promise<unknown>;

async function readPointerFromRedis(): Promise<unknown> {
  const { getRedis } = await import('./redis-client');
  const redis = await getRedis();
  if (!redis) return null;
  return redis.get(LIVE_POINTER_KEY);
}

let pointerReader: PointerReader = readPointerFromRedis;
let lastCheckedAt = -Infinity;
let refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Run `fn` whenever the live pointer moves (or stops applying). For helpers
 * that memoize something BUILT from league data — a player index, a parsed
 * feed — for the life of the instance: without this they keep serving the
 * data from before the sync. tests/league-data-live.test.ts fails on a module
 * that holds such a cache and does not register.
 */
export function onLeagueDataChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setLive(next: { overlay: string; manifest: Manifest } | null) {
  if ((live?.overlay ?? null) === (next?.overlay ?? null)) return;
  live = next;
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error('[league-data] a change listener failed:', err);
    }
  }
}

async function checkPointer(now: number): Promise<void> {
  const deploy = deployManifest();
  if (!deploy) return;
  let raw: unknown;
  try {
    raw = await pointerReader();
  } catch (err) {
    // Redis down: keep whatever view we have. A stale pointer is still data a
    // sync published; dropping to the deploy's copy would go further back.
    console.error('[league-data] could not read the live pointer:', err);
    return;
  }
  const pointer = parsePointer(raw);
  if (!pointer) return setLive(null);
  // No sync has confirmed it in a day and a half: the syncs stopped
  // publishing, so the deploy's own (git) data is the fresher copy.
  if (pointerIsStale(pointer, now)) return setLive(null);
  const builtSchema = deploy.schema ?? LEAGUE_DATA_SCHEMA;
  if (pointer.schema !== LEAGUE_DATA_SCHEMA || builtSchema !== LEAGUE_DATA_SCHEMA) {
    // Code and data disagree on layout: serve the deploy's own data.
    return setLive(null);
  }
  if (live?.overlay === pointer.overlay) return;
  try {
    const { value } = await readBlob(deploy.base, pointer.overlay, `live overlay ${pointer.overlay}`);
    const files = (value as { files?: Record<string, string> } | null)?.files;
    if (!files || typeof files !== 'object') throw new Error('overlay has no file map');
    setLive({
      overlay: pointer.overlay,
      manifest: {
        base: deploy.base,
        schema: LEAGUE_DATA_SCHEMA,
        // A branch deploy keeps the files its branch added (composeFiles).
        files: composeFiles(deploy.files, files, pointer.patterns, {
          keepBranchFiles: Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== 'production',
        }),
      },
    });
  } catch (err) {
    // Keep the current view; the next check retries.
    console.error('[league-data] could not apply the live pointer:', err);
  }
}

/**
 * Check the live pointer if this instance has not in the last minute. Called
 * once per request from the middleware, before anything preloads. Never
 * throws, and concurrent requests share one check.
 */
export async function refreshLeagueData(now: number = Date.now()): Promise<void> {
  if (!deployManifest()) return;
  if (refreshing) return refreshing;
  if (now - lastCheckedAt < LIVE_CHECK_INTERVAL_MS) return;
  lastCheckedAt = now;
  refreshing = checkPointer(now).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Tests only: pretend a manifest was (or was not) built, and drop the cache. */
export function __setLeagueDataManifestForTests(manifest: Manifest | null | undefined): void {
  manifestOverride = manifest;
  live = null;
  lastCheckedAt = -Infinity;
  cache.clear();
  settled.clear();
  lastByPath.clear();
  pathOfKey.clear();
  sizes.clear();
  cachedBytes = 0;
}

/** Tests only: where the live pointer is read from (null restores Redis). */
export function __setLeaguePointerReaderForTests(reader: PointerReader | null): void {
  pointerReader = reader ?? readPointerFromRedis;
  lastCheckedAt = -Infinity;
}
