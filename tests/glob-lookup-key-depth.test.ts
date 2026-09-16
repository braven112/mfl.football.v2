/**
 * Guard: a hand-written `import.meta.glob` lookup key must be relative to the
 * file it sits in.
 *
 * `import.meta.glob('../../../data/…')` returns an object keyed by the exact
 * relative specifier, and pages index it with a template literal that repeats
 * the prefix: `feeds[\`../../../data/<league>/mfl-feeds/${year}/rosters.json\`]`.
 * Moving the page one directory deeper means fixing the glob, which fails loudly
 * at build if it matches nothing, AND every lookup, which fails silently: the
 * key misses, the lookup is `undefined`, and the page renders with no data.
 *
 * That shipped when the AFL trade builder moved under `front-office/` (#1063).
 * Its globs were fixed but all six lookups kept three `../`. On staging the
 * builder had no rosters, no players and no draft picks.
 *
 * This scan resolves every such key against its own file and requires it to
 * land in the repo-root `data/` directory.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src/pages', 'src/components', 'src/layouts'];
const EXTENSIONS = new Set(['.astro', '.ts', '.tsx']);

// identifier[`../../data/...`] — the bracket lookup into a glob result.
const LOOKUP = /[A-Za-z_$][\w$]*\s*\[\s*`((?:\.\.\/)+)data\//g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

describe('import.meta.glob lookup keys resolve from their own file', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it('finds lookups to check (the scan is not vacuous)', () => {
    const count = files.reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(LOOKUP)].length,
      0,
    );
    expect(count).toBeGreaterThan(10);
  });

  it('every relative `data/` lookup key reaches the repo-root data directory', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(LOOKUP)) {
        const resolved = path.resolve(path.dirname(file), `${m[1]}data`);
        if (resolved !== path.join(ROOT, 'data')) {
          const line = src.slice(0, m.index).split('\n').length;
          const depth = path.relative(path.dirname(file), ROOT).split(path.sep).length;
          offenders.push(
            `${path.relative(ROOT, file)}:${line} — key uses ${m[1].length / 3} "../" but this file needs ${depth}`,
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
