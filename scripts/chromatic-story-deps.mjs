#!/usr/bin/env node
/**
 * Compute the set of src/ files that can change what a Storybook story RENDERS.
 *
 * Chromatic's workflow is path-filtered, and `src/utils/**` was far too broad:
 * 247 utils exist, 42 reach a story. But narrowing a visual-test trigger is
 * dangerous in exactly one direction — a util that renders but is NOT in the
 * filter means the regression ships, and then `--auto-accept-changes` on main
 * blesses it as the new baseline. A visual test that certifies the bug.
 *
 * So the list is not hand-maintained. This walks the real import graph from
 * every story AND from .storybook/preview.ts (which imports utils of its own to
 * build the accent/dark-logo CSS), and `tests/chromatic-path-filter.test.ts`
 * fails the build if chromatic.yml's filter has drifted from it.
 *
 * Resolution is deliberately conservative: anything it cannot resolve is
 * ignored rather than guessed, and the guard test only checks that every
 * REACHED file is COVERED — extra paths in the filter are always safe.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { globSync } from 'node:fs';

const SEED_GLOBS = ['stories/**/*.stories.ts', 'stories/**/*.stories.tsx'];
const EXTRA_SEEDS = ['.storybook/preview.ts'];
const EXT = ['', '.ts', '.tsx', '.astro', '.mjs', '.js', '.css', '/index.ts'];

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), spec));
  for (const ext of EXT) {
    const cand = base + ext;
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

export function computeStoryDeps() {
  const seeds = [...SEED_GLOBS.flatMap((g) => globSync(g)), ...EXTRA_SEEDS].filter(existsSync);
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveSpec(file, m[1]);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen].filter((f) => f.startsWith('src/')).sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const deps = computeStoryDeps();
  const byDir = {};
  for (const d of deps) {
    const top = d.split('/').slice(0, 2).join('/');
    (byDir[top] ??= []).push(d);
  }
  for (const [dir, files] of Object.entries(byDir).sort()) {
    console.log(`\n# ${dir} (${files.length})`);
    for (const f of files) console.log(`      - '${f}'`);
  }
}
