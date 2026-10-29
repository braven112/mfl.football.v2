/**
 * League data that lives in Vercel Blob instead of inside the serverless function.
 *
 * The whole site is ONE Vercel function with a hard 250 MB limit, and about
 * three quarters of it was league data (docs/claude/rules/storage-and-build.md
 * § "The function size budget"). Every league added 10-30 MB, so the number of
 * leagues the site could host was capped by the function. This module is the
 * build half of the fix; `src/utils/league-data.ts` is the request half.
 *
 * How the halves meet:
 *   1. `scripts/publish-league-data.mjs` (after prebuild) hashes every file
 *      under STORE_ROOTS, uploads the ones Blob does not have yet — named by
 *      content, so an unchanged file is never uploaded twice — and writes
 *      MANIFEST_PATH: `{ base, files: { 'data/…/players.json': '<hash>' } }`.
 *   2. The manifest is bundled into the function; `loadLeagueData(path)`
 *      fetches `${base}${BLOB_PREFIX}<hash>.json` and keeps it in memory.
 *   3. Files matching FUNCTION_EXCLUDED are left out of the function. A
 *      pattern goes on that list only once NOTHING in src/ reads those files
 *      except through the loader — `tests/league-data-store.test.ts` fails on
 *      any other reader, because a raw `fs` read of an excluded file ENOENTs in
 *      production only.
 *
 * The files stay committed in git exactly as before; only where the running
 * site reads them from changes. Local dev and tests read them off disk.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Directories whose JSON is published to the store. */
export const STORE_ROOTS = ['data', 'src/data'];

/** Blob pathname prefix for every published file. */
export const BLOB_PREFIX = 'league-data/';

/** Where the publish step writes the manifest the function bundles. Gitignored. */
export const MANIFEST_PATH = 'src/generated/league-data-manifest.json';

/**
 * Files no longer shipped inside the function, as path globs relative to the
 * repo root (`*` = one path segment, `**` = any depth). Grow this ONLY when the
 * last raw reader of the files is gone — the guard test enforces it.
 */
export const FUNCTION_EXCLUDED = [
  // Per-season feeds whose last raw reader moved to the loader (or that only
  // globs ever read). NOT weekly-results.json: accounting-season-data.ts reads
  // it off disk by a constructed name (`${feed}.json`) that the guard's
  // file-name scan cannot see.
  // A family whose remaining readers are SYNC helpers that a caller may not
  // have preloaded yet (playerScores.json for the hero components, the RSP
  // files for the draft room) stays in until those callers preload: its
  // fallback reads the disk, which an excluded file is not on.
  'data/*/mfl-feeds/*/player-scores-weekly.json',
  'data/*/mfl-feeds/*/futureDraftPicks.json',
  'data/*/mfl-feeds/*/auctionResults.json',
  // player-map's identity files and the bye calendar: preloaded on every
  // request by src/middleware.ts (src/utils/request-league-data.ts).
  'data/*/derived/player-identity-union.json',
  'data/*/derived/espn-nfl-id-backfill.json',
  'data/nfl/bye-weeks.json',
];

/** Directories under the roots that are never league data the site reads. */
const SKIP_DIRS = new Set(['perf-baseline', 'salary-history-archive', 'node_modules']);

const toPosix = (p) => p.split(sep).join('/');

/** Every publishable file under STORE_ROOTS, repo-relative, POSIX separators, sorted. */
export function storeFiles(root = process.cwd()) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(childRel);
      } else if (entry.name.endsWith('.json')) {
        out.push(toPosix(childRel));
      }
    }
  };
  for (const r of STORE_ROOTS) walk(r);
  return out.sort();
}

/** Content hash used as the blob name: 32 hex chars of sha256. */
export function hashContent(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

/** `{ path: hash }` for every publishable file. */
export function hashStoreFiles(root = process.cwd(), files = storeFiles(root)) {
  const out = {};
  for (const f of files) out[f] = hashContent(readFileSync(join(root, f)));
  return out;
}

/** A FUNCTION_EXCLUDED glob as a RegExp over repo-relative POSIX paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function isFunctionExcluded(path, patterns = FUNCTION_EXCLUDED) {
  return patterns.some((g) => globToRegExp(g).test(path));
}

/** The manifest the last publish wrote, or null (no build yet, or a plain checkout). */
export function readManifest(root = process.cwd()) {
  const p = join(root, MANIFEST_PATH);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Exact paths for the Vercel adapter's `excludeFiles` (it compares verbatim,
 * no globs). Empty unless the publish step actually stored the files — a build
 * with no store must keep shipping them, or the loader has nothing to read.
 */
export function functionExcludedFiles(root = process.cwd(), patterns = FUNCTION_EXCLUDED) {
  const manifest = readManifest(root);
  if (!manifest?.base) return [];
  return Object.keys(manifest.files ?? {})
    .filter((f) => isFunctionExcluded(f, patterns))
    .filter((f) => statSync(join(root, f), { throwIfNoEntry: false }));
}
