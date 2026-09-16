import { existsSync, readFileSync, statSync } from 'node:fs';
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
 * Deliberate limits, because a guard that lies is worse than none:
 *  - Only literal specifiers are seen. `await import(someVar)` is invisible.
 *  - Comment lines (`//`, `*`, `/*`) are skipped, so a specifier quoted in a
 *    doc comment is not a dependency (src/config/leagues-data.mjs quotes its
 *    own path in the header, which is exactly the false positive this avoids).
 *  - Only .mjs/.js/.ts/.mts/.cjs sources are parsed; .json/.astro resolve but
 *    are not walked.
 */

const BUILTINS = new Set(builtinModules);
const PARSEABLE = new Set(['.mjs', '.js', '.ts', '.mts', '.cjs']);
const CANDIDATE_SUFFIXES = ['', '.mjs', '.js', '.ts', '.mts', '.cjs', '/index.mjs', '/index.js', '/index.ts'];

/** `from 'x'`, `import 'x'`, `import('x')`, `require('x')`. */
const SPEC_RE = /\b(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g;

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveRelative(spec: string, fromFile: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export interface ModuleGraph {
  /** Bare specifiers that are not node builtins → the repo-relative file that imports each. */
  packages: Map<string, string>;
  /** Every repo-local file reached, repo-relative. */
  files: string[];
  /** Relative specifiers that resolved to nothing — a typo, or a limit of this resolver. */
  unresolved: string[];
}

/** Walk every local import reachable from `entry` (repo-relative) and report the packages it needs. */
export function moduleGraph(entry: string): ModuleGraph {
  const start = path.resolve(REPO_ROOT, entry);
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const unresolved: string[] = [];
  const stack = [start];

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!PARSEABLE.has(path.extname(file))) continue;

    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);

    for (const line of src.split('\n')) {
      if (isComment(line)) continue;
      for (const match of line.matchAll(SPEC_RE)) {
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
    }
  }

  return { packages, files: [...seen].map((f) => path.relative(REPO_ROOT, f)).sort(), unresolved };
}
