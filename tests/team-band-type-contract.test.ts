/**
 * The type contract every team band owes its own contrast measurement.
 *
 * `src/utils/team-band.ts` measures each franchise's ink at WCAG's 3:1
 * LARGE-TEXT floor, and that floor is only earned while the text sitting on
 * the fill is actually large: ≥18.66px bold (14pt bold). Measured at the 4.5:1
 * body floor instead, eight AFL clubs — the Micks' green at 3.20:1 among them —
 * would need dark ink or a darkened fill.
 *
 * So the font sizes in each band's CSS are not a styling preference. They are
 * the premise of the calculation, and nothing else in the codebase connects
 * the two: someone tidying a band's cells back toward the 12px the rest of a
 * table uses would take it sub-AA without a single test going red.
 *
 * This is deliberately a REGISTRY, not a scan of one file. The band is meant to
 * spread — standings first, then the Pecking Order chip, and whatever comes
 * next — and a guard pinned to its first caller would quietly stop covering
 * the feature it was written for. A new importer of `team-band` fails this
 * suite until it declares which of its selectors carry band text, which forces
 * the question to be answered once, in the open, per surface.
 *
 * It reads the CSS as text on purpose: the rule has to hold in the files that
 * ship, not in a re-implementation of them here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { BAND_INK_MIN_RATIO } from '../src/utils/team-band';
import { AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';

const SRC = resolve(__dirname, '../src');

/** WCAG: bold text counts as "large" from 14pt = 18.66px. */
const LARGE_TEXT_PX = 18.66;
const REM_PX = 16;

/**
 * Every surface that paints a team band, and the selectors in it that carry
 * text ON the fill. Adding a band to a new component means adding it here.
 */
const CONTRACTS: Record<string, { bandText: RegExp; boldRule: RegExp }> = {
  'components/theleague/standings/StandingsTable.astro': {
    bandText: /st-row--band|band-name|band-crest|band-team/,
    boldRule: /tbody tr\.st-row--band td\s*\{([^}]*)\}/,
  },
  'components/shared/PeckingOrderIssue.astro': {
    // The chip is the only thing drawn on the fill; the name, blurb and
    // metrics all sit on the card, where the normal text tokens apply.
    bandText: /pr-card__rank-num/,
    boldRule: /\.pr-card__rank-num\s*\{([^}]*)\}/,
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files under src/ that import the band utility, excluding the utility itself. */
function bandImporters(): string[] {
  return walk(SRC)
    .filter((f) => !f.endsWith(`utils${require('node:path').sep}team-band.ts`))
    .filter((f) => /from\s+['"][^'"]*utils\/team-band['"]/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).split(require('node:path').sep).join('/'));
}

/** Every `font-size` declared in a block whose selector matches `bandText`. */
function bandFontSizes(css: string, bandText: RegExp): Array<{ selector: string; px: number }> {
  const out: Array<{ selector: string; px: number }> = [];
  // Strip comments first, or a rule's doc block is parsed as part of its
  // selector and the failure message arrives unreadable.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, rawSelector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.replace(/\s+/g, ' ').trim();
    if (!bandText.test(selector)) continue;
    for (const [, value, unit] of body.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)) {
      out.push({ selector, px: unit === 'rem' ? parseFloat(value) * REM_PX : parseFloat(value) });
    }
  }
  return out;
}

describe('team band — the type keeps the contrast measurement valid', () => {
  it('measures its ink at the large-text floor, not the body floor', () => {
    // If this ever changes, every size below is no longer the right premise —
    // re-derive the bands before relaxing anything here.
    expect(BAND_INK_MIN_RATIO).toBe(AA_LARGE_TEXT_RATIO);
  });

  it('has a declared contract for every surface that paints a band', () => {
    const undeclared = bandImporters().filter((f) => !(f in CONTRACTS));
    expect(
      undeclared,
      'A new team-band surface must declare which of its selectors carry text ' +
        'on the fill, so the 3:1 floor that ink was measured at stays honest.',
    ).toEqual([]);
  });

  it('declares no contract for a surface that no longer paints a band', () => {
    const importers = new Set(bandImporters());
    expect(Object.keys(CONTRACTS).filter((f) => !importers.has(f))).toEqual([]);
  });

  for (const [file, contract] of Object.entries(CONTRACTS)) {
    describe(file, () => {
      const css = readFileSync(resolve(SRC, file), 'utf8');

      it('declares band type at 18.66px or larger, at every breakpoint', () => {
        const sizes = bandFontSizes(css, contract.bandText);
        expect(sizes.length).toBeGreaterThan(0);
        const tooSmall = sizes
          .filter((s) => s.px < LARGE_TEXT_PX)
          .map((s) => `${s.selector} → ${s.px}px`);
        expect(tooSmall).toEqual([]);
      });

      it('sets that text bold, which the large-text floor also requires', () => {
        const rule = contract.boldRule.exec(css);
        expect(rule, `expected ${contract.boldRule} to match a rule in ${file}`).not.toBeNull();
        const weight = /font-weight:\s*(\d+)/.exec(rule![1]);
        expect(weight).not.toBeNull();
        expect(Number(weight![1])).toBeGreaterThanOrEqual(700);
      });

      it('reads both themes from the band, never just one', () => {
        // A surface that sets --band-fill without its dark counterpart renders
        // the light-theme fill on a dark card, where the ink was measured
        // against a different colour than the one on screen.
        if (!/var\(--band-fill\)/.test(css)) return;
        expect(css).toMatch(/var\(--band-fill-dark\)/);
        expect(css).toMatch(/var\(--band-ink-dark\)/);
      });
    });
  }

  it('cancels the global dark-mode crest swap where a band renders a crest', () => {
    // The band is the club's colour in BOTH themes, so a crest chosen for a
    // dark CARD has no business on it. `bandCrestSrc` picks by fill; this rule
    // stops `TeamIconDarkStyles` overriding that after sunset.
    const standings = readFileSync(
      resolve(SRC, 'components/theleague/standings/StandingsTable.astro'),
      'utf8',
    );
    expect(standings).toMatch(/html\.dark\)?\s*\.band-crest\s*\{[^}]*content:\s*normal/);
  });
});
