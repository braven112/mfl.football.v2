/**
 * Inline-script inventory — how much of this app is still written as
 * `is:inline` / `define:vars` script inside .astro files.
 *
 * Counts ONLY those two kinds. A plain `<script>` in an .astro file is a
 * BUNDLED module: it is real TypeScript, `astro check` type-checks it, and it
 * can import — so it is not what this measures. `is:inline` and `define:vars`
 * are the ones that opt out of all three: no types, no imports, no bundling,
 * and invisible to the type baseline.
 *
 * Used by tests/inline-script-ratchet.test.ts. Run it directly for a report:
 *   node scripts/lib/inline-script-inventory.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCRIPT_TAG = /<script([^>]*)>([\s\S]*?)<\/script>/g;

/** True for the two forms that opt out of bundling, typing and imports. */
export function isUnbundled(attrs) {
  return attrs.includes('is:inline') || attrs.includes('define:vars');
}

/** Lines of unbundled script in one .astro source. */
export function countUnbundledLines(source) {
  let lines = 0;
  let blocks = 0;
  for (const match of source.matchAll(SCRIPT_TAG)) {
    if (!isUnbundled(match[1])) continue;
    lines += match[2].split('\n').length - 1;
    blocks += 1;
  }
  return { lines, blocks };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.astro')) out.push(full);
  }
  return out;
}

/**
 * Every .astro file carrying unbundled script, as `path -> lines`, keyed by a
 * repo-relative POSIX path. Sorted descending so a report reads usefully.
 */
export function inlineScriptInventory(root = process.cwd()) {
  const result = new Map();
  for (const file of walk(join(root, 'src'))) {
    const { lines } = countUnbundledLines(readFileSync(file, 'utf8'));
    if (lines > 0) result.set(relative(root, file).split('\\').join('/'), lines);
  }
  return new Map([...result].sort((a, b) => b[1] - a[1]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inv = inlineScriptInventory();
  let total = 0;
  for (const [file, lines] of inv) {
    total += lines;
    console.log(String(lines).padStart(6), file);
  }
  console.log(`\n${total} unbundled script lines across ${inv.size} files`);
}
