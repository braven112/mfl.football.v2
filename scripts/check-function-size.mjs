#!/usr/bin/env node
/**
 * Measure every serverless function in `.vercel/output/functions/` against
 * Vercel's 250 MB uncompressed limit, and say what is filling it.
 *
 * The whole site deploys as ONE function (`_render`): Astro 7's Vercel adapter
 * has no per-route split, so a native module on one page or a feed glob on
 * another counts against the same cap as everything else. It has been hit
 * three times — the raw `data/` tracer fallback (263 MB), the Archie's feed
 * archive, and the logo tracer's vectorizer (250.69 MB, 2026-10-29) — and each
 * time Vercel was the first to say so, with nothing but a total.
 *
 * Two callers:
 *   - `postbuild` (every Vercel build): report only, never fails. Vercel
 *     enforces the real limit itself; this puts the breakdown in the same log.
 *   - CI (`--enforce`): fails above BUDGET_MB, so a PR that would get within
 *     reach of the limit is red before it merges. The headroom is deliberate:
 *     the feeds grow every week in season, and bot sync commits to `main` never
 *     open a PR, so the margin is what absorbs that growth until the next run.
 *
 * Sizes are apparent bytes in MiB, which is how Vercel's "mb" reads (a 231 MiB
 * local build matched its own figure once the 18 MiB musl trim was added back).
 * Symlinks are counted as links, never followed: pnpm's node_modules links
 * point INTO the function's own `.pnpm` copy, so following them double-counts.
 */
import { lstatSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Vercel's hard limit for an uncompressed function. */
export const LIMIT_MB = 250;
/** CI fails above this — 10 MB clear of the limit. */
export const BUDGET_MB = 240;
/** The build log starts warning above this. */
export const WARN_MB = 225;

const MB = 1024 * 1024;

/** Every regular file and symlink under `dir`, with its apparent size. */
export function walk(dir, root = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, root, out);
    else out.push({ path: relative(root, p).split(sep).join('/'), bytes: lstatSync(p).size });
  }
  return out;
}

/**
 * The bucket a file is reported under — coarse enough that the top of the list
 * names a cause, not 1,400 hashed chunks:
 *   - a compiled chunk by its name minus the content hash (`players` ×27)
 *   - a pnpm package by its store entry
 *   - `data/<league>/mfl-feeds/<file>` across seasons, and other data by dir
 */
export function bucketOf(path) {
  const chunk = path.match(/^dist\/server\/chunks\/(.+?)_[A-Za-z0-9_-]{8}\.mjs$/);
  if (chunk) return `dist chunk: ${chunk[1]}`;
  if (path.startsWith('dist/')) return 'dist (other)';
  const pkg = path.match(/^node_modules\/\.pnpm\/([^/]+)/);
  if (pkg) return `node_modules: ${pkg[1]}`;
  if (path.startsWith('node_modules/')) return 'node_modules (links)';
  const feed = path.match(/^data\/([^/]+)\/mfl-feeds\/\d{4}\/(.+)$/);
  if (feed) return `data/${feed[1]}/mfl-feeds/*/${feed[2]}`;
  const parts = path.split('/');
  return parts.length > 2 ? `${parts[0]}/${parts[1]}/` : path;
}

/** Totals for one function directory, buckets largest first. */
export function measure(funcDir) {
  const files = walk(funcDir);
  const buckets = new Map();
  let bytes = 0;
  for (const f of files) {
    bytes += f.bytes;
    const key = bucketOf(f.path);
    const b = buckets.get(key) ?? { key, bytes: 0, files: 0 };
    b.bytes += f.bytes;
    b.files += 1;
    buckets.set(key, b);
  }
  return { bytes, files: files.length, buckets: [...buckets.values()].sort((a, b) => b.bytes - a.bytes) };
}

export const toMb = (bytes) => bytes / MB;

function report(name, m, top) {
  const mb = toMb(m.bytes);
  console.log(`\n[function-size] ${name}: ${mb.toFixed(1)} MB of ${LIMIT_MB} MB (${(LIMIT_MB - mb).toFixed(1)} MB left, CI budget ${BUDGET_MB} MB)`);
  for (const b of m.buckets.slice(0, top)) {
    const n = b.files > 1 ? ` ×${b.files}` : '';
    console.log(`  ${toMb(b.bytes).toFixed(1).padStart(6)} MB  ${b.key}${n}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const enforce = args.includes('--enforce');
  const topArg = args.find((a) => a.startsWith('--top='));
  const top = topArg ? Number(topArg.slice(6)) : 15;
  const dir = '.vercel/output/functions';

  if (!existsSync(dir)) {
    // Not a Vercel adapter build (a demo or Storybook build, say): nothing to measure.
    console.log('[function-size] no .vercel/output/functions — skipped');
    return;
  }

  let failed = false;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.func'))) {
    const funcDir = join(dir, name);
    // A .func can be a symlink to another (the adapter dedupes identical ones).
    if (lstatSync(funcDir).isSymbolicLink()) continue;
    const m = measure(funcDir);
    const mb = toMb(m.bytes);
    report(name, m, top);
    if (mb > BUDGET_MB) {
      const msg = `${name} is ${mb.toFixed(1)} MB, over the ${BUDGET_MB} MB budget (Vercel fails at ${LIMIT_MB}). See docs/claude/rules/storage-and-build.md § "The function size budget".`;
      if (enforce) {
        console.error(`::error::${msg}`);
        failed = true;
      } else {
        console.warn(`[function-size] WARNING: ${msg}`);
      }
    } else if (mb > WARN_MB) {
      console.warn(`[function-size] WARNING: ${name} is within ${(LIMIT_MB - mb).toFixed(1)} MB of Vercel's limit.`);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
