/**
 * Storybook coverage of the shared components may only go UP.
 *
 * The classifier (scripts/lib/story-coverage.mjs) derives every bucket from
 * source — page bodies, data-bound components and style injectors cannot be
 * storied and are excluded by what they ARE, not by a list someone edits. What
 * is left is presentational, and every presentational shared component either
 * has a story, renders inside one, carries an `exempt` reason, or is in the
 * frozen backlog in tests/fixtures/story-coverage-baseline.json.
 *
 * A NEW presentational shared component therefore fails here until it ships
 * with a story. That is the point: the backlog was 135 when this landed
 * (Oct 2026, after the shared-folder sweep made "shared" mean something), and
 * the next component should not be the 136th.
 *
 * Report: `node scripts/story-coverage.mjs` (`--all` for every bucket).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { measureStoryCoverage, classify } from '../scripts/lib/story-coverage.mjs';

const ROOT = process.cwd();
const BASELINE_PATH = 'tests/fixtures/story-coverage-baseline.json';
const baseline: { backlog: string[]; exempt: Record<string, string> } = JSON.parse(
  fs.readFileSync(path.join(ROOT, BASELINE_PATH), 'utf8'),
);
const { buckets } = measureStoryCoverage(ROOT, { exempt: baseline.exempt }) as {
  buckets: Record<string, string[]>;
};

describe('Storybook coverage of src/components/shared', () => {
  it('finds the stories it claims to — a resolver that matched nothing would pass vacuously', () => {
    expect(buckets.story.length).toBeGreaterThanOrEqual(19);
  });

  it('ships every NEW presentational shared component with a story', () => {
    const added = buckets.backlog.filter((f) => !baseline.backlog.includes(f));
    expect(
      added,
      'these are presentational shared components with no story. Add one under stories/ ' +
        '(docs/claude/rules/storybook.md), or — only if it genuinely cannot take one — ' +
        `record why under "exempt" in ${BASELINE_PATH}`,
    ).toEqual([]);
  });

  it('retightens the backlog when an entry leaves it', () => {
    const retired = baseline.backlog.filter((f) => !buckets.backlog.includes(f));
    expect(retired, 'run `node scripts/story-coverage.mjs --write` to drop these from the baseline').toEqual([]);
  });

  it('keeps every exemption live and explained', () => {
    for (const [file, reason] of Object.entries(baseline.exempt)) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} is exempt but gone`).toBe(true);
      expect(buckets.exempt, `${file} is exempt but no longer needs to be — drop the entry`).toContain(file);
      expect(reason.trim().length, `${file} needs a reason, not a flag`).toBeGreaterThan(20);
    }
  });
});

describe('the classifier', () => {
  it('reads a *Page component as a page body', () => {
    expect(classify('src/components/shared/x/FooPage.astro', '---\n---\n<div/>')).toBe('page');
  });

  it('reads frontmatter data access as data-bound, and markup alone as presentational', () => {
    expect(classify('a.astro', "---\nconst u = getAuthUser(Astro.request);\n---\n<div/>")).toBe('dataBound');
    expect(classify('a.astro', "---\nconst f = import.meta.glob('x');\n---\n<div/>")).toBe('dataBound');
    expect(classify('a.astro', '---\nconst { a } = Astro.props;\n---\n<div>{a}</div>')).toBeNull();
  });

  it('reads a style/script-only component as non-visual, but not one that also renders', () => {
    expect(classify('a.astro', '---\n---\n<style set:html={css}></style>')).toBe('nonVisual');
    expect(classify('a.astro', '---\n---\n<script is:inline>x()</script>')).toBe('nonVisual');
    expect(classify('a.astro', '---\n---\n<button>t</button><script>x()</script>')).toBeNull();
  });

  it('reads a React island that fetches as data-bound', () => {
    expect(classify('a.tsx', 'useEffect(() => { fetch("/api/x") }, [])')).toBe('dataBound');
    expect(classify('a.tsx', 'export default () => <div/>')).toBeNull();
  });
});
