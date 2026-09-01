#!/usr/bin/env node
/**
 * Compute what can change a Storybook story's RENDER, for two Chromatic knobs.
 *
 *   node scripts/chromatic-story-deps.mjs            # workflow `paths:` block
 *   node scripts/chromatic-story-deps.mjs --externals # chromatic.config.json
 *
 * Both knobs were far too broad, in opposite ways, and both are now derived
 * from the real import graph rather than hand-maintained.
 *
 * 1. `.github/workflows/chromatic.yml` triggered on `src/utils/**`. 247 utils
 *    exist; 45 reach a story. Most builds re-snapshotted the whole suite for
 *    code no snapshot renders.
 *
 * 2. `--externals` triggered on `src/styles/**` and `public/assets/**`. Any
 *    changed file matching ANY externals glob makes the CLI null `changedFiles`
 *    and disable TurboSnap for the entire build:
 *
 *        for (const e of externals) {
 *          const n = changedFiles.filter(f => picomatch(e, f));
 *          if (n.length > 0) { changedFiles = undefined; break; }
 *        }
 *
 *    src/styles holds 26 stylesheets of which 9 render, and public/assets holds
 *    the What's New screenshots this repo adds constantly. So TurboSnap was
 *    disabled on essentially every build — 117 builds in, still reporting
 *    `TurboSnap active: no` and 0 inherited snapshots.
 *
 * THE TWO KNOBS PULL IN OPPOSITE DIRECTIONS, which is why neither may be
 * hand-edited:
 *
 *   - `paths:` too narrow  -> the build never runs, the regression ships, and
 *     --auto-accept-changes on main blesses it as the new baseline.
 *   - `externals` too narrow -> TurboSnap inherits a snapshot for a file it
 *     cannot trace, and the regression ships green.
 *   - either too broad -> wasted snapshots (the bug being fixed here).
 *
 * `tests/chromatic-path-filter.test.ts` pins both against this graph.
 */
import { readFileSync, existsSync, statSync, globSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

const SEED_GLOBS = ['stories/**/*.stories.ts', 'stories/**/*.stories.tsx'];
const EXTRA_SEEDS = ['.storybook/preview.ts'];
const EXT = [
  '',
  '.ts',
  '.tsx',
  '.astro',
  '.mjs',
  '.js',
  '.css',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.mjs',
  '/index.js',
  '/index.astro',
];

/**
 * Seed directories, which are covered by their own `stories/**` and
 * `.storybook/**` globs and so are dropped from the emitted list.
 *
 * NOTE this is the only thing filtered out. An earlier version filtered to
 * `src/` and silently dropped three files that genuinely render:
 * data/afl-fantasy/afl.config.json (AFL brand colors, imported by
 * PeckingOrderIssue and franchise-band-brand), data/afl-fantasy/tier-history.json
 * and data/best-ball-1/bb1.config.json. They matched no `paths:` entry, so an
 * AFL brand-color edit would have built on neither the PR nor the merge — the
 * exact hole this generator exists to close, reintroduced by a leftover prefix
 * check. Filter by what a glob already covers, never by a path prefix.
 */
const SEED_DIRS = ['stories/', '.storybook/'];

/**
 * Asset trees a story can render. NOT derivable from the import graph: these
 * are referenced as runtime URL strings (`/assets/nfl-logos/${abbr}.svg`), not
 * imports, so nothing links them into the module graph.
 *
 * Derived by scanning stories, fixtures and every component and util in the
 * closure for `/assets/...` literals. Re-run that scan when adding a story:
 *
 *   grep -rhoE "/assets/[A-Za-z0-9._/-]*" stories/ <closure files>
 *
 * `public/assets/fonts/**` is the one that looks droppable and is not - the
 * story stylesheets @font-face against it, and a re-subset font reflows every
 * snapshot. Deliberately EXCLUDED (they render nowhere): whats-new/, news/,
 * schefter/, tv-logos/, css/, js/, and the non-Schefter avatars.
 */
export const STORY_ASSET_GLOBS = [
  'public/assets/afl/**',
  'public/assets/theleague/**',
  'public/assets/nfl-logos/**',
  'public/assets/college-logos/**',
  'public/assets/logos/**',
  'public/assets/icons/**',
  'public/assets/hero-players/**',
  'public/assets/fonts/**',
  'public/assets/claude-schefter-avatar.webp',
];

/**
 * Storybook's own untraceable visual inputs.
 *
 * `.storybook/**\/*.css` covers preview-layout-globals.css, which preview.ts
 * imports and TurboSnap cannot follow. `.storybook/static/**` is the Vend Sans
 * mount: a staticDirs entry lives entirely outside the module graph - the built
 * CSS keeps the literal url('/storybook-fonts/...') and the woff2 is only
 * copied next to it.
 */
export const STORYBOOK_EXTERNAL_GLOBS = ['.storybook/**/*.css', '.storybook/static/**'];

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), spec));
  for (const ext of EXT) {
    const cand = base + ext;
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Every src/ file reachable from a story or from preview.ts. */
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
    // Also matches CSS `@import './x.css'`, so stylesheet-to-stylesheet edges
    // are followed. (There are none today; this keeps it true if one appears.)
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveSpec(file, m[1]);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen].filter((f) => !SEED_DIRS.some((d) => f.startsWith(d))).sort();
}

/** The stylesheets a story renders - the traceable half of `externals`. */
export function computeStoryStylesheets() {
  return computeStoryDeps().filter((f) => f.endsWith('.css'));
}

/** The full `externals` list for chromatic.config.json. */
export function computeExternals() {
  return [...computeStoryStylesheets(), ...STORYBOOK_EXTERNAL_GLOBS, ...STORY_ASSET_GLOBS];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--externals')) {
    console.log(JSON.stringify({ externals: computeExternals() }, null, 2));
  } else {
    const byDir = {};
    for (const d of computeStoryDeps()) {
      (byDir[d.split('/').slice(0, 2).join('/')] ??= []).push(d);
    }
    for (const [dir, files] of Object.entries(byDir).sort()) {
      console.log(`\n# ${dir} (${files.length})`);
      for (const f of files) console.log(`      - '${f}'`);
    }
  }
}
