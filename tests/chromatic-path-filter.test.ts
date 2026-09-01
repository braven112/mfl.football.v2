import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeStoryDeps,
  computeExternals,
  computeStoryStylesheets,
  STORY_ASSET_GLOBS,
} from '../scripts/chromatic-story-deps.mjs';

/**
 * Chromatic path-filter guard - the safety net under a narrowed visual trigger.
 *
 * `.github/workflows/chromatic.yml` used to trigger on `src/utils/**`. That
 * glob covers 247 files, of which 45 actually reach a story, so most Chromatic
 * builds were re-snapshotting the entire suite for code no snapshot renders.
 * The filter is now the real import closure of the story suite.
 *
 * That narrowing is safe in exactly one direction, and this test is what keeps
 * it that way. A file that RENDERS but is not MATCHED by the filter is the bad
 * case: its regression never triggers a build, ships, and is then auto-accepted
 * as the new baseline by the `--auto-accept-changes` run on main. A visual test
 * that certifies the bug. So:
 *
 *   - every file in the closure must be matched by the filter, or this fails
 *   - extra patterns in the filter are always SAFE (they only over-trigger),
 *     so they are not flagged
 *
 * Both trigger blocks are checked independently. They are duplicated in the
 * YAML because GitHub Actions has no anchor support for `on:` filters, and a
 * `paths:` list that drifts between push and pull_request would mean a change
 * builds on the PR but not on the merge that sets the baseline.
 *
 * When this fails: run `node scripts/chromatic-story-deps.mjs` and paste the
 * output into BOTH `paths:` lists in the workflow.
 */

const WORKFLOW = '.github/workflows/chromatic.yml';

/** Extract each `paths:` list under the `on:` block, in document order. */
function extractPathLists(yaml: string): string[][] {
  const lines = yaml.split('\n');
  const lists: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^\s*paths:\s*$/.test(line)) {
      current = [];
      lists.push(current);
      continue;
    }
    if (current === null) continue;

    const entry = line.match(/^\s*-\s*'([^']+)'\s*$/);
    if (entry) {
      current.push(entry[1]);
      continue;
    }
    // A comment or blank line inside the list does not end it.
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    current = null;
  }
  return lists;
}

/**
 * Minimal glob to RegExp, supporting the `**` and `*` the workflow uses.
 *
 * Scanned left to right rather than via chained `.replace()` with a sentinel:
 * the sentinel approach needs a character that cannot occur in a path, and the
 * obvious pick (NUL) makes git treat this file as BINARY — no diff, no review.
 */
function globToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      out += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else {
      out += pattern[i].replace(/[.+^${}()|[\]\\?]/, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

const matchesAny = (file: string, patterns: string[]) =>
  patterns.some((p) => globToRegExp(p).test(file));

describe('chromatic path filter', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const pathLists = extractPathLists(yaml);
  const deps = computeStoryDeps();

  it('finds both trigger path lists', () => {
    expect(pathLists).toHaveLength(2);
    for (const list of pathLists) expect(list.length).toBeGreaterThan(50);
  });

  it('resolves a non-trivial story closure', () => {
    // A resolver regression that silently returned [] would make every
    // coverage assertion below vacuously pass.
    expect(deps.length).toBeGreaterThan(80);
    expect(deps).toContain('src/utils/franchise-brand.ts');
    expect(deps).toContain('src/components/shared/PeckingOrderIssue.astro');
  });

  it.each([0, 1])('trigger block %i covers every rendering file', (index) => {
    const patterns = pathLists[index];
    const uncovered = deps.filter((file) => !matchesAny(file, patterns));

    expect(
      uncovered,
      `These files render into a story but no chromatic.yml path matches them, ` +
        `so a visual regression in them would ship and then be auto-accepted ` +
        `as the new baseline on main.\n\n` +
        `Regenerate with: node scripts/chromatic-story-deps.mjs\n\n` +
        uncovered.map((f) => `  - '${f}'`).join('\n'),
    ).toEqual([]);
  });

  it('keeps both trigger blocks identical', () => {
    // Drift means a change builds on the PR but not on the merge to main (or
    // the reverse), so the baseline and the review disagree about what was
    // tested.
    expect([...pathLists[0]].sort()).toEqual([...pathLists[1]].sort());
  });

  it('does not re-widen to the globs the closure replaced', () => {
    for (const list of pathLists) {
      expect(list).not.toContain('src/utils/**');
      expect(list).not.toContain('src/components/**');
    }
  });

  it('triggers on every asset tree a story renders', () => {
    // Assets are runtime URL strings, not imports, so they are absent from the
    // module graph and cannot be derived from it. If the workflow stops
    // matching one, a crest or logo swap never triggers a build.
    for (const list of pathLists) {
      for (const glob of STORY_ASSET_GLOBS) expect(list).toContain(glob);
    }
  });

  it('excludes the cron-written feeds', () => {
    // These churn on a schedule and render into nothing. If one ever enters
    // the closure, that is a real finding - a snapshot is reading live data,
    // which is the nondeterminism .storybook/modes.ts froze fixtures to avoid.
    const noisy = deps.filter(
      (f) =>
        /schefter-feed\.json$/.test(f) ||
        f.includes('mfl-feeds/') ||
        /post-history\.json$/.test(f),
    );
    expect(noisy).toEqual([]);
  });
});

/**
 * TurboSnap externals - the OTHER half, and it fails in the opposite direction.
 *
 * The CLI disables TurboSnap for the whole build the moment any changed file
 * matches any externals glob:
 *
 *   for (const e of externals) {
 *     const n = changedFiles.filter(f => picomatch(e, f));
 *     if (n.length > 0) { changedFiles = undefined; break; }
 *   }
 *
 * So the list must be TIGHT (a stylesheet that renders nowhere disables the
 * discount for everyone) and COMPLETE (a stylesheet that does render, left out,
 * lets TurboSnap inherit a stale snapshot and ship the regression green).
 * Exactly the story closure's CSS, plus the untraceable asset and font trees.
 */
describe('chromatic externals', () => {
  const config = JSON.parse(readFileSync('chromatic.config.json', 'utf8'));

  it('matches the generated set exactly', () => {
    expect(config.externals).toEqual(computeExternals());
  });

  it('covers every stylesheet a story renders', () => {
    const missing = computeStoryStylesheets().filter((f) => !config.externals.includes(f));
    expect(
      missing,
      `These stylesheets render into a story but are not in externals, so ` +
        `TurboSnap would inherit their snapshots and miss the regression.\n\n` +
        `Regenerate with: node scripts/chromatic-story-deps.mjs --externals`,
    ).toEqual([]);
  });

  it('does not re-widen to the globs that disabled TurboSnap', () => {
    // `src/styles/**/*.css` matched 26 stylesheets of which 9 render, and
    // `public/assets/**` matched the What's New screenshots this repo adds
    // constantly. Together they disabled TurboSnap on essentially every build.
    expect(config.externals).not.toContain('src/styles/**/*.css');
    expect(config.externals).not.toContain('src/styles/**');
    expect(config.externals).not.toContain('public/assets/**');
  });

  it('keeps --only-changed on, which externals requires', () => {
    // The CLI throws if externals is set without onlyChanged.
    expect(config.onlyChanged).toBe(true);
    expect(config.buildScriptName).toBe('build:storybook:stats');
  });

  it('leaves the stats build wired up, since TurboSnap needs it', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts[config.buildScriptName]).toContain('--stats-json');
  });
});
