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
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

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
 * franchise-band-brand), data/afl-fantasy/tier-history.json
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
  // The franchise crests TeamIconCell renders — one per dark-mode branch, in
  // both leagues for the swap — plus the two dark files those swaps fetch.
  // Listed individually, NOT as the two league trees: `public/assets/afl/**` +
  // `public/assets/theleague/**` matched ~700 files — every franchise's icon,
  // banner, group-me and history art — so a logo swap for any of the 40 teams
  // started a build that could not change a pixel.
  // `computeStoryAssetLiterals()` below is what keeps this list honest.
  'public/assets/afl/icons/ninjas.png',
  'public/assets/afl/icons/ninjas_dark.png',
  'public/assets/afl/icons/swift.png',
  'public/assets/theleague/group-me/cowboy_up.png',
  'public/assets/theleague/group-me/ninjas.png',
  'public/assets/theleague/group-me/pigskins.png',
  'public/assets/theleague/group-me/wabbits.png',
  'public/assets/theleague/icons/cowboy_up.png',
  'public/assets/theleague/icons/ninjas.png',
  'public/assets/theleague/icons/ninjas_dark.png',
  'public/assets/theleague/icons/pigskins.png',
  'public/assets/theleague/icons/pigskins_dark.png',
  'public/assets/theleague/icons/wabbits.png',
  'public/assets/theleague/icons/wabbits_dark.png',
  'public/assets/afl/dleague-dark.svg',
  'public/assets/afl/dleague.svg',
  'public/assets/afl/premier-dark.svg',
  'public/assets/afl/premier.svg',
  'public/assets/nfl-logos/**',
  'public/assets/college-logos/**',
  'public/assets/logos/**',
  'public/assets/icons/**',
  'public/assets/hero-players/**',
  'public/assets/fonts/**',
  'public/assets/claude-schefter-avatar.webp',
];

/**
 * League configs, for the ONE asset a story needs that it does not name.
 *
 * A crest with an `iconDark` is swapped by the injected `TeamIconDarkStyles`
 * CSS, keyed on the light `src`. So rendering `pigskins.png` also fetches
 * `pigskins_dark.png`, and nothing in `stories/` says so. Derived rather than
 * hardcoded: the day a story's crest GAINS a dark variant, the new file must
 * enter the trigger, and the config edit that adds it cannot be what reminds
 * anyone (that edit already triggers a build on its own — the dark PNG's
 * LATER edits are the ones that would ship unbuilt).
 *
 * Read from the registry, per CLAUDE.md — a league added there brings its
 * crests along with no edit here.
 *
 * The match below is exact on the config's `icon` string, which is only correct
 * while those are ROOT-RELATIVE (`/assets/...`). All 3 configs are today; an
 * absolute `https://…` one would miss silently and leave the dark file out of
 * the trigger, so `tests/chromatic-path-filter.test.ts` asserts the precondition
 * rather than this normalizing a shape that does not exist.
 */
const LEAGUE_CONFIGS = ALL_LEAGUES.map((l) => l.configPath).filter(Boolean);

/**
 * Every public/ asset a story renders, as repo-relative paths.
 *
 * Assets are runtime URL strings, so they are absent from the import graph —
 * this is a TEXT scan of the story files, which is the only thing that can see
 * them. Interpolated specifiers (`/assets/nfl-logos/${code}.svg`) and bare
 * directories are skipped: neither is one file, and both are covered by the
 * `**` globs above that stay broad for exactly that reason.
 *
 * `tests/chromatic-path-filter.test.ts` asserts STORY_ASSET_GLOBS covers all of
 * it. That is the guard the individually-listed crests need: without it,
 * a story rendering a fifth crest would silently fall outside the trigger, its
 * regressions would ship, and `--auto-accept-changes` on main would bless them
 * as the baseline.
 */
export function computeStoryAssetLiterals() {
  const found = new Set();
  for (const file of storyTextFiles()) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\/assets\/[A-Za-z0-9._/-]+/g)) {
      // A trailing path segment with no extension is a directory prefix, not a
      // file — `/assets/theleague/icons/` and friends.
      if (/\.[A-Za-z0-9]+$/.test(m[0])) found.add(`public${m[0]}`);
    }
  }

  // Add the dark counterpart of any crest above that declares one.
  for (const cfg of LEAGUE_CONFIGS) {
    if (!existsSync(cfg)) continue;
    for (const team of JSON.parse(readFileSync(cfg, 'utf8')).teams ?? []) {
      if (team.icon && team.iconDark && found.has(`public${team.icon}`)) {
        found.add(`public${team.iconDark}`);
      }
    }
  }
  return [...found].sort();
}

/**
 * Directories a story reaches through an INTERPOLATED path, which the literal
 * scan above cannot enumerate.
 *
 * `/assets/nfl-logos/${code}.svg` is fine — that tree keeps a `**` glob for
 * exactly this reason. `/assets/theleague/icons/${seed.slug}.png` was NOT:
 * the playoff fixtures built twelve crest paths that way, and when the two
 * league trees were replaced by individual files those crests kept rendering
 * with nothing in the trigger matching them. The literal scan saw nothing to
 * complain about, because there was no literal.
 *
 * So the rule this exposes: **a dynamically-built asset path REQUIRES a `**`
 * glob over its directory.** Write the paths out if you want a narrow trigger.
 */
export function computeStoryAssetPrefixes() {
  const found = new Set();
  for (const file of storyTextFiles()) {
    // Any `/assets/...` string that stops at a directory separator instead of a
    // filename. Deliberately NOT keyed on a following `${`: template literals
    // are one way to splice a path and `'/assets/x/' + slug + '.png'` is
    // another, and a guard that only knows the first is one syntax away from
    // the twelve-crest miss it exists to prevent. The DIRECTORY LITERAL is the
    // tell, whatever follows it.
    // The lookahead matters: it requires the path to STOP at the separator —
    // either the string literal closes there (`'/assets/x/' + slug`) or an
    // interpolation starts (`` `/assets/x/${slug}.png` ``). Without it, the
    // directory inside a perfectly good filename matches too and every crest
    // demands a `**` tree.
    for (const m of readFileSync(file, 'utf8').matchAll(/\/assets\/[A-Za-z0-9._/-]*\/(?=['"`]|\$\{)/g)) {
      found.add(`public${m[0]}`);
    }
  }
  return [...found].sort();
}

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

/**
 * Every text file under stories/ — story modules AND the fixtures they import.
 *
 * NOT `SEED_GLOBS`: that is `*.stories.ts` only, which is right for walking the
 * import graph and wrong for scanning asset strings. Fixtures are where the
 * bulky, asset-heavy data lives, and skipping them is how twelve playoff crests
 * stayed outside the Chromatic trigger.
 */
function storyTextFiles() {
  // .astro and .json too: stories/overview/ChromaticReport.astro is a story
  // source, and JSON fixtures lived here until Sept 2026. An asset named from
  // either would be invisible to a guard that only reads TypeScript — the same
  // class of miss as skipping stories/fixtures/ in the first place.
  return globSync('stories/**/*.{ts,tsx,astro,js,mjs,json}');
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
