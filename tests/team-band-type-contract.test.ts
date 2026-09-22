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
 * Every surface that imports the band utility.
 *
 * A surface that PAINTS a band declares the selectors carrying text on the
 * fill, and where that CSS lives when it is not in the same file. A surface
 * that only RESOLVES bands — a config builder handing them to something else —
 * declares `paints: false`, which is a statement, not an exemption: the file
 * still has to be listed, so nobody adds a band-painting component and has it
 * quietly count as data plumbing.
 */
type Contract =
  | { paints: false }
  | { paints?: true; bandText: RegExp; boldRule: RegExp; cssFile?: string }
  /**
   * A surface that paints a fill but puts NO text on it — the band is behind a
   * crest, a swatch or an icon, and every glyph stays on the card.
   *
   * This is not a weaker version of the contract above, it is a DIFFERENT
   * claim, and a checkable one: the suite asserts the band's selectors declare
   * no `font-size` at all. That is what makes it safe to skip the 18.66px
   * floor, because the floor only exists to justify measuring ink at 3:1 — and
   * where there is no ink on the fill there is nothing to measure.
   *
   * It must not become the easy way out. A surface that wants small text on a
   * fill does not belong here; it needs ink measured at the 4.5:1 body floor,
   * which is a change to `team-band.ts` and re-derives eight AFL clubs' fills.
   */
  | { paints?: true; bandText: RegExp; textOnFill: false; cssFile?: string };

const CONTRACTS: Record<string, Contract> = {
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
  'components/shared/WaiverPriorityModal.astro': {
    bandText: /wpm-row--band/,
    boldRule: /\.wpm-row--band\s*\{([^}]*)\}/,
    cssFile: 'styles/waiver-priority-modal.css',
  },
  // Paints a band without importing the util: its rows are built by
  // `scripts/transaction-hub.ts` from bands `transaction-hub-config.ts`
  // resolved. Painting and importing are not the same file here, which is why
  // the two checks below are independent.
  'components/theleague/TransactionHubModal.astro': {
    bandText: /thm-worow--band/,
    boldRule: /:global\(\.thm-worow--band\)\s*\{([^}]*)\}/,
  },
  // The draft order grid's pick plates. Text-free by necessity, not by taste:
  // the tile's own background is how its four status marks work, and its type
  // is 14.2px/16.5px/11.8px in a 100px-wide tile, which cannot reach 18.66px.
  'components/theleague/DraftPredictorGrid.astro': {
    bandText: /draft-pick--band/,
    textOnFill: false,
  },
  // Resolve-only: they attach bands to a team list that other surfaces paint.
  'utils/transaction-hub-config.ts': { paints: false },
  'pages/afl-fantasy/players.astro': { paints: false },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Files under src/ that import the band utility for its VALUES, excluding the
 * utility itself.
 *
 * Type-only imports are stripped first and deliberately do not count. A file
 * that imports `TeamBand` as a type cannot resolve a band or measure one — it
 * is handed one already resolved, and the surface that PAINTS that band is
 * registered on its own (the shared waiver row renderer is exactly this: its
 * markup is styled by two stylesheets, both listed above).
 */
function bandImporters(): string[] {
  const sep = require('node:path').sep;
  return walk(SRC)
    .filter((f) => !f.endsWith(`utils${sep}team-band.ts`))
    .filter((f) => {
      const values = readFileSync(f, 'utf8').replace(/import\s+type\s+[^;]*?;/g, '');
      return /from\s+['"][^'"]*team-band['"]/.test(values);
    })
    .map((f) => relative(SRC, f).split(sep).join('/'));
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

  it('keeps no data-plumbing entry for a file that no longer resolves bands', () => {
    // Only the `paints: false` entries are claims about IMPORTING. A painting
    // entry need not import the util at all — the hub's rows are built by a
    // script from bands its config resolved — and its own check below fails
    // loudly if its CSS stops existing or stops matching.
    const importers = new Set(bandImporters());
    const stale = Object.entries(CONTRACTS)
      .filter(([, c]) => c.paints === false)
      .map(([file]) => file)
      .filter((file) => !importers.has(file));
    expect(stale).toEqual([]);
  });

  for (const [file, contract] of Object.entries(CONTRACTS)) {
    if (contract.paints === false) continue;
    describe(file, () => {
      const css = readFileSync(resolve(SRC, contract.cssFile ?? file), 'utf8');
      const textFree = 'textOnFill' in contract && contract.textOnFill === false;

      it(
        textFree
          ? 'puts no text on the fill at all, which is why the floor does not apply'
          : 'declares band type at 18.66px or larger, at every breakpoint',
        () => {
          const sizes = bandFontSizes(css, contract.bandText);
          if (textFree) {
            // The whole basis of this entry. A `font-size` appearing in a band
            // selector means glyphs moved onto the fill, and the ink behind
            // them was never measured for text that small.
            expect(sizes.map((s) => `${s.selector} → ${s.px}px`)).toEqual([]);
            return;
          }
          expect(sizes.length).toBeGreaterThan(0);
          const tooSmall = sizes
            .filter((s) => s.px < LARGE_TEXT_PX)
            .map((s) => `${s.selector} → ${s.px}px`);
          expect(tooSmall).toEqual([]);
        },
      );

      it('sets that text bold, which the large-text floor also requires', () => {
        // Narrowed on the property rather than on `textFree`: that flag is a
        // runtime check TypeScript cannot use to discriminate the union, and
        // reading `contract.boldRule` behind it is two type errors.
        if (!('boldRule' in contract)) return;
        const rule = contract.boldRule.exec(css);
        expect(rule, `expected ${contract.boldRule} to match a rule in ${file}`).not.toBeNull();
        const weight = /font-weight:\s*(\d+)/.exec(rule![1]);
        expect(weight).not.toBeNull();
        expect(Number(weight![1])).toBeGreaterThanOrEqual(700);
      });

      it('reads both themes from the band, never just one', () => {
        // A surface that sets --band-fill without its dark counterpart renders
        // the light-theme fill on a dark card, where the fill was lifted for a
        // different surface than the one it is sitting on. True of every
        // painting surface, text or no text.
        if (!/var\(--band-fill\)/.test(css)) return;
        expect(css).toMatch(/var\(--band-fill-dark\)/);
        // The ink pair is only owed where ink is actually drawn. A text-free
        // plate consumes no ink, and demanding it would push a surface into
        // declaring a colour it never paints.
        if (textFree) return;
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
