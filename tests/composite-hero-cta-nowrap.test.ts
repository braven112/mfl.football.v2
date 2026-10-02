/**
 * The composite hero's call-to-action must never wrap mid-phrase.
 *
 * "View Draft Order" broke across two lines on a 390px phone (Brandon,
 * Sep 2026). The mechanism is worth stating because it is not obvious from the
 * CTA's own rule: `.cmh__footer` is `flex-wrap: nowrap` by default, so the
 * metrics group beside the button takes the width it needs and the button —
 * the only shrinkable thing on the row — absorbs the difference by wrapping its
 * label. A button whose label breaks reads as a broken layout, not as a button.
 *
 * The fix is a pair, and BOTH halves are load-bearing:
 *
 *   - `white-space: nowrap` stops the label breaking;
 *   - `flex-shrink: 0` stops that turning into a button that overflows the
 *     card instead. With it, the METRICS give up width — they are a stacked
 *     label that already wraps gracefully.
 *
 * And on a phone the two genuinely cannot always share a row, so the mobile
 * footer wraps and the CTA takes its own line. That is the honest third
 * outcome; without it the pair above just trades a wrapped label for a
 * sideways-scrolling card.
 *
 * Scan-style rather than render-style on purpose: the wrap depends on the
 * label, the viewport and the metrics beside it, so a test that renders one
 * hero at one width would pass while a longer label on another hero broke.
 * These three declarations are what make it impossible for all of them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/styles/composite-hero.css'), 'utf8');

/** The body of one rule, by exact selector at the start of a line. */
function ruleBody(selector: string, from = 0): string {
  const at = css.indexOf(`\n${selector} {`, from);
  expect(at, `${selector} is not defined in composite-hero.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('composite hero CTA', () => {
  it('never breaks its label across lines', () => {
    // Since Oct 2026 the CTA is a shared `.cta` (src/styles/cta.css), whose
    // base rule carries the `nowrap`; every hero's CTA must therefore carry
    // the shared class, and the shared base must keep the declaration.
    const ctaCss = readFileSync(join(__dirname, '..', 'src/styles/cta.css'), 'utf8');
    const base = ctaCss.slice(ctaCss.indexOf(':where(.cta) {'));
    expect(base.slice(0, base.indexOf('}'))).toContain('white-space: nowrap');
    for (const file of [
      'src/components/shared/CompositeHero.astro',
      'src/components/shared/LeagueCompositeHero.astro',
      'src/components/theleague/AuctionCompositeHero.astro',
      'src/components/theleague/CutWatchCompositeHero.astro',
      'src/components/theleague/PreseasonCompositeHero.astro',
      'src/components/theleague/season-heroes/RecapCompositeHero.astro',
    ]) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(src, `${file} must render .cmh__cta as a shared .cta`).toMatch(/class="cta cta--primary cmh__cta"/);
      expect(src).not.toMatch(/class="cmh__cta"/);
    }
  });

  it('cannot be squeezed into overflowing instead', () => {
    // The other half. `nowrap` alone moves the failure rather than fixing it:
    // a shrinkable button with an unbreakable label runs past the card edge.
    expect(ruleBody('.cmh__cta')).toContain('flex-shrink: 0');
  });

  it('gets its own row on a phone rather than fighting the metrics', () => {
    // Inside the mobile block, and overriding the `--cmh-footer-wrap` token —
    // an adopter's `nowrap` is a desktop composition choice.
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    const footer = mobile.slice(mobile.indexOf('.cmh__footer {'));
    expect(
      footer.slice(0, footer.indexOf('}')),
      'the mobile footer must wrap, or the un-shrinkable CTA has nowhere to go',
    ).toContain('flex-wrap: wrap');
  });
});
