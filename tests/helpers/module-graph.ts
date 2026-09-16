import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { REPO_ROOT } from './scan-guard';

/**
 * Transitive import graph for repo-local ESM/CJS files.
 *
 * Written for the workflow install guard, which has to answer one question
 * mechanically: does this node script need `node_modules`? A CI job that runs
 * a script with no install does not fail loudly — it fails the way
 * schefter-scan documented, with a dynamic `await import('@upstash/redis')`
 * inside a try/catch that logs "Redis import failed" and exits 0. Auditing
 * that by hand is a one-time answer to a question that changes every time
 * someone adds an import three modules deep.
 *
 * **A false NEGATIVE here is the expensive direction.** It makes the guard
 * pass while the dependency is real, which is indistinguishable from safety.
 * Everything below is shaped by that, and each rule is a miss a reviewer
 * found in the first version of this file:
 *
 *  - **All four specifier shapes.** `import 'x';` (side-effect, no `from`) is
 *    the one a regex built around `from` misses; missing it once reported a
 *    file pinned into production as dead. See
 *    docs/claude/insights/features/dead-code-detection.md § "Building the graph".
 *  - **Specifiers may span lines.** `await import(\n  '@upstash/redis'\n)` is
 *    valid and a line-by-line scan cannot see it, so comments are stripped and
 *    the whole source is matched at once.
 *  - **Template-literal local imports are expanded.**
 *    `` await import(`./article-types/${type}.mjs`) `` is how
 *    schefter-weekly-articles.mjs loads its article modules — a whole subtree
 *    that a literal-only walker never enters, and one of those files does
 *    reach the shared Redis lib. A directory whose files match the literal
 *    prefix/suffix is walked; anything that cannot be expanded is reported in
 *    `dynamicUnresolved` so the caller can fail rather than assume.
 *  - **Unreadable files are not recorded.** A path is added to `files` only
 *    after it is proven to be a readable file, so `files.includes(entry)` is
 *    a real existence check rather than an echo of the argument.
 *
 * Remaining limit, stated so nobody mistakes it for coverage: a specifier
 * built from a variable (`import(someVar)`) is unknowable statically. It is
 * reported in `dynamicUnresolved`, never silently ignored.
 */

const BUILTINS = new Set(builtinModules);
const PARSEABLE = new Set(['.mjs', '.js', '.ts', '.mts', '.cjs']);
const CANDIDATE_SUFFIXES = ['', '.mjs', '.js', '.ts', '.mts', '.cjs', '/index.mjs', '/index.js', '/index.ts'];

/** `from 'x'`, `import 'x'`, `import('x')`, `require('x')` — `\s*` spans newlines. */
const SPEC_RE = /\b(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g;
/** `import(`...`)` with a template literal, resolved or reported. */
const TEMPLATE_IMPORT_RE = /\b(?:import|require)\s*\(\s*`([^`]*)`\s*\)/g;

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Blank out comments so a specifier quoted in prose is not a dependency
 * (src/config/leagues-data.mjs quotes its own path in its header) while
 * leaving real code — and its line structure — intact.
 */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return withoutBlocks
    .split('\n')
    .map((line) => (/^\s*(?:\/\/|\*)/.test(line) ? '' : line))
    .join('\n');
}

function resolveRelative(spec: string, fromFile: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Expand `` `./dir/${x}.mjs` `` to every file in that directory matching the
 * literal prefix and suffix. Returns null when the shape cannot be expanded.
 */
function expandTemplate(raw: string, fromFile: string): string[] | null {
  const open = raw.indexOf('${');
  const close = raw.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) return null;
  const prefix = raw.slice(0, open);
  const suffix = raw.slice(close + 1);
  // Only a repo-local path can be expanded; a bare package name cannot.
  if (!prefix.startsWith('.') && !prefix.startsWith('/')) return null;
  // The interpolation must not span a directory boundary, or the prefix's
  // directory is not the one being read.
  if (suffix.includes('/')) return null;

  // A prefix ending in '/' IS the directory — path.dirname() would drop it
  // ('./article-types/' -> '.'), which silently searched the wrong folder and
  // found nothing, i.e. reported a whole subtree as dependency-free.
  const endsWithSlash = prefix.endsWith('/');
  const dirSpec = endsWithSlash ? prefix : path.dirname(prefix);
  const baseSpec = endsWithSlash ? '' : path.basename(prefix);
  const dir = path.resolve(path.dirname(fromFile), dirSpec);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((name) => name.startsWith(baseSpec) && name.endsWith(suffix))
    .map((name) => path.join(dir, name))
    .filter(isFile);
  return matches.length > 0 ? matches : null;
}

export interface ModuleGraph {
  /** Bare specifiers that are not node builtins → the repo-relative file that imports each. */
  packages: Map<string, string>;
  /** Every repo-local file reached AND proven readable, repo-relative. */
  files: string[];
  /** Relative specifiers that resolved to nothing — a typo, or a limit of this resolver. */
  unresolved: string[];
  /** Dynamic specifiers that could not be expanded. Treat as unknown, never as none. */
  dynamicUnresolved: string[];
}

/** Walk every local import reachable from `entry` (repo-relative) and report the packages it needs. */
export function moduleGraph(entry: string): ModuleGraph {
  const start = path.resolve(REPO_ROOT, entry);
  const visited = new Set<string>();
  const readable = new Set<string>();
  const packages = new Map<string, string>();
  const unresolved: string[] = [];
  const dynamicUnresolved: string[] = [];
  const stack = [start];

  while (stack.length) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!isFile(file)) continue;
    readable.add(file);
    if (!PARSEABLE.has(path.extname(file))) continue;

    let src: string;
    try {
      src = stripComments(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);

    for (const match of src.matchAll(SPEC_RE)) {
      const spec = match[1];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveRelative(spec, file);
        if (resolved) stack.push(resolved);
        else unresolved.push(`${rel} -> ${spec}`);
        continue;
      }
      // Bare specifier: a builtin, or something that must come from node_modules.
      const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (BUILTINS.has(root)) continue;
      if (!packages.has(root)) packages.set(root, rel);
    }

    for (const match of src.matchAll(TEMPLATE_IMPORT_RE)) {
      const raw = match[1];
      if (!raw.includes('${')) continue; // a plain backtick literal; SPEC_RE ignores it
      const expanded = expandTemplate(raw, file);
      if (expanded) stack.push(...expanded);
      else dynamicUnresolved.push(`${rel} -> \`${raw}\``);
    }
  }

  return {
    packages,
    files: [...readable].map((f) => path.relative(REPO_ROOT, f)).sort(),
    unresolved,
    dynamicUnresolved,
  };
}
