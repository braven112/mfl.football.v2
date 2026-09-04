/**
 * The shared Asset Library page's inline script under the ClientRouter.
 *
 * This one breaks the usual pattern in BOTH directions, which is why the shape
 * is pinned rather than left to a future reader's judgement:
 *
 * - The `document`-level copy/focusin delegation is CORRECT as written and must
 *   stay behind its `window.__assetCopyDelegation` once-flag. Those handlers
 *   close over nothing but `copyText` (a pure function) and resolve every
 *   element at event time, which is the one shape where a once-flag is safe
 *   (frontend.md, 2026-09-03). Measured: Copy still fires exactly once per
 *   click on the third router arrival. Converting it to remove-then-add would
 *   be churn on working code.
 *
 * - The ELEMENT-scoped wiring was the broken half, for an unusual reason:
 *   ClientRouter re-executes an inline script the first time it sees it, then
 *   marks it as already run for the session. So the team filter and the
 *   dimension fill wired themselves on the FIRST arrival and never again.
 *   Measured by driving real router navigations: on the 2nd and 3rd arrival the
 *   filter was inert and every "size" line blank. They now run from
 *   `astro:page-load`, which fires on every arrival regardless.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENT = fs.readFileSync(
  path.join(process.cwd(), 'src/components/shared/assets/AssetsPage.astro'),
  'utf-8',
);

describe('the asset library re-wires its controls on every arrival', () => {
  it('runs the element-scoped wiring from astro:page-load, not at script scope', () => {
    const initAt = COMPONENT.indexOf('const initAssetsPage = () =>');
    expect(initAt, 'the filter and dimension wiring must live in an init()')
      .toBeGreaterThan(-1);

    for (const read of ["querySelector('#team-filter')", "'.team-grid .team-card'"]) {
      expect(COMPONENT.indexOf(read), `${read} must be re-read inside init()`)
        .toBeGreaterThan(initAt);
    }

    // The first-pass render and the input binding are what only ever ran once
    // at script scope; both belong inside init() now.
    for (const call of ['filterCards(input.value);', "input.addEventListener('input'", 'initDimensions();']) {
      expect(COMPONENT.indexOf(call), `${call} must run inside init()`).toBeGreaterThan(initAt);
    }

    expect(COMPONENT).toContain("document.addEventListener('astro:page-load', initAssetsPage)");
    // astro:page-load fires on the initial load too, so a direct call on top of
    // the registration would double-init.
    expect(COMPONENT, 'astro:page-load already fires on the first load')
      .not.toMatch(/^\s*initAssetsPage\(\);\s*$/m);
  });

  it('replaces its astro:page-load registration rather than adding a second', () => {
    // `document` survives the swap. The script is normally executed once per
    // session, but it is shared by two league routes — hold the registration
    // and swap it rather than trusting that.
    expect(COMPONENT).toContain(
      "document.removeEventListener('astro:page-load', window.__assetsPageInit)",
    );
    expect(COMPONENT).toContain('window.__assetsPageInit = initAssetsPage');
  });

  it('LEAVES the copy delegation on its once-flag — it is the safe variant', () => {
    // Deliberate. These handlers hold no element references, so the flag gives
    // one listener over a closure that never goes stale. Rewriting them as
    // remove-then-add would change working code for no behavioural gain; this
    // case is the exception frontend.md's 2026-09-03 entry carves out.
    expect(COMPONENT).toContain('if (!window.__assetCopyDelegation)');
    expect(COMPONENT).toContain('window.__assetCopyDelegation = true');
    // If a future edit closes the delegated handler over a page element, the
    // flag stops being safe — that is what this next line is guarding.
    const flagAt = COMPONENT.indexOf('if (!window.__assetCopyDelegation)');
    const delegated = COMPONENT.slice(flagAt);
    expect(delegated, 'the delegated handlers must resolve elements at event time')
      .not.toMatch(/document\.addEventListener\('click', async \(event\) => \{[\s\S]{0,200}\bcards\b/);
  });
});
