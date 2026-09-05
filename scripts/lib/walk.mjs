/**
 * The one directory walker for scripts, hooks and tests.
 *
 * Five walkers grew in one PR, each with its own skip list (one skipped
 * nothing, one stat'd every entry before reading it — a TOCTOU CodeQL flags).
 * This is the single implementation: `withFileTypes` so a directory is never
 * stat'd separately from being listed, one default skip list, and paths that
 * come back sorted so every caller's output is deterministic.
 *
 * Importable from `.mjs` and, via the relative path, from `.ts` under tests/.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

/** Directory NAMES never descended into, at any depth. */
export const DEFAULT_SKIP_DIRS = ['node_modules', '.git', 'dist', '.astro', '.vercel', 'coverage'];

/**
 * @param {string} root absolute or cwd-relative directory (a file is returned as itself)
 * @param {object} [opts]
 * @param {string[]|null} [opts.extensions] keep only these extensions (with the dot); null = all
 * @param {string[]} [opts.skipDirs] directory names to skip anywhere (defaults to DEFAULT_SKIP_DIRS)
 * @param {string[]} [opts.skipPaths] directory paths relative to `root` to skip (e.g. ['data'])
 * @param {string|null} [opts.relativeTo] when set, return forward-slash paths relative to this dir; else absolute
 * @returns {string[]} sorted
 */
export function walkFiles(root, { extensions = null, skipDirs = DEFAULT_SKIP_DIRS, skipPaths = [], relativeTo = null } = {}) {
  const absRoot = path.resolve(root);
  const skipNames = new Set(skipDirs);
  const skipRel = new Set(skipPaths.map((p) => p.split(path.sep).join('/')));
  const exts = extensions ? new Set(extensions) : null;
  const out = [];
  const keep = (abs) => (!exts || exts.has(path.extname(abs))) && out.push(abs);
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOTDIR') return keep(dir); // root was a file
      if (err.code === 'ENOENT') return; // vanished between listing and descent; nothing to walk
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipNames.has(entry.name)) continue;
        if (skipRel.size && skipRel.has(path.relative(absRoot, abs).split(path.sep).join('/'))) continue;
        visit(abs);
      } else if (entry.isFile()) {
        keep(abs);
      }
    }
  };
  visit(absRoot);
  out.sort();
  if (!relativeTo) return out;
  const base = path.resolve(relativeTo);
  return out.map((abs) => path.relative(base, abs).split(path.sep).join('/'));
}
