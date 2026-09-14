import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WHATS_NEW_CATEGORY_LABELS } from '../src/types/whats-new';
import type { WhatsNewCategory } from '../src/types/whats-new';

/**
 * Every What's New category needs a CSS rule in every family that styles by
 * category — and a color token defined in BOTH themes.
 *
 * THE BUG THIS EXISTS FOR. Adding the `weekly` category meant adding
 * `.foo--weekly` to eight separate rule families across three components. Three
 * were missed, and the failure was silent in the worst way: the badge's ink is
 * `var(--cat-badge-ink)` (white) and the BACKGROUND comes from the modifier, so
 * a missing rule renders white text on a white card. The "Type" row of the
 * article sidebar shipped visibly blank while every test stayed green, because
 * the label was in the markup — just unreadable.
 *
 * Same shape as the theming rule in CLAUDE.md, one level up — there it is the
 * variable that is missing, here it is the RULE:
 * "A `var(--x)` with no definition renders its fallback in *both* themes".
 *
 * Deliberately derived from `WHATS_NEW_CATEGORY_LABELS` and from the files
 * themselves rather than a hand-kept list: a sixth category must fail this the
 * day it is added, and a new rule family must be covered without anyone
 * remembering to extend the test.
 */

const ROOT = resolve(__dirname, '..');

/** Every file that styles a What's New entry by its category. */
const STYLED_BY_CATEGORY = [
  'src/components/shared/whats-new/WhatsNewDetailPage.astro',
  'src/components/shared/whats-new/WhatsNewIndexPage.astro',
  'src/components/theleague/WhatsNewRow.astro',
];

const CATEGORIES = Object.keys(WHATS_NEW_CATEGORY_LABELS) as WhatsNewCategory[];

/**
 * Rule families in one file, as `base -> set of categories styled`.
 *
 * A "family" is a class stem that carries a category modifier, e.g.
 * `.wn-detail__badge--bug-fix` has the stem `.wn-detail__badge`. Read out of
 * the source so a family nobody has thought about is still covered.
 */
function familiesIn(source: string): Map<string, Set<string>> {
  const families = new Map<string, Set<string>>();
  const escaped = CATEGORIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(\\.[a-z0-9_-]+?)--(${escaped})\\b`, 'gi');
  for (const [, stem, category] of source.matchAll(pattern)) {
    if (!families.has(stem)) families.set(stem, new Set());
    families.get(stem)!.add(category);
  }
  return families;
}

describe('every What\'s New category is styled everywhere it is rendered', () => {
  it('has categories to check (sanity)', () => {
    expect(CATEGORIES.length).toBeGreaterThan(3);
    expect(CATEGORIES).toContain('weekly');
  });

  for (const file of STYLED_BY_CATEGORY) {
    describe(file, () => {
      const source = readFileSync(resolve(ROOT, file), 'utf-8');
      const families = familiesIn(source);

      it('declares at least one category rule family', () => {
        // Guards the regex: a reformat that broke the match would otherwise
        // validate every category against an empty map and report green.
        expect(families.size).toBeGreaterThan(0);
      });

      it('styles every category in every family that styles any of them', () => {
        const gaps: string[] = [];
        for (const [stem, styled] of families) {
          for (const category of CATEGORIES) {
            if (!styled.has(category)) gaps.push(`${stem}--${category}`);
          }
        }
        expect(
          gaps,
          `Missing category rules. A modifier with no rule is not a missing color — the ` +
            `badge's ink is white and its background comes from the modifier, so the label ` +
            `renders white-on-white and reads as an empty field.`,
        ).toEqual([]);
      });
    });
  }
});

describe('every category color token is defined in both themes', () => {
  const light = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf-8');
  const dark = readFileSync(resolve(ROOT, 'src/styles/tokens-dark.css'), 'utf-8');

  it('defines --cat-<category> in tokens.css and tokens-dark.css', () => {
    const missing: string[] = [];
    for (const category of CATEGORIES) {
      const token = `--cat-${category}:`;
      if (!light.includes(token)) missing.push(`${token} (tokens.css)`);
      if (!dark.includes(token)) missing.push(`${token} (tokens-dark.css)`);
    }
    expect(
      missing,
      `A category color defined in only one theme renders its fallback in the other — ` +
        `light looks perfect and dark ships wrong, which is the trap CLAUDE.md's theming ` +
        `rule names. Add both or neither.`,
    ).toEqual([]);
  });
});
