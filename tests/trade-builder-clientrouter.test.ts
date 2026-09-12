/**
 * The AFL trade builder's client script under the ClientRouter.
 *
 * Astro bundles it, so it is evaluated once per document and the router swaps
 * the DOM without re-evaluating it. Everything ran at module scope: on a return
 * visit the picker buttons, the team switch and Send proposal were bound to
 * detached nodes, and the delegated remove-from-zone handler — which survives,
 * because `document` is the one node the swap does not replace — was still
 * driving the previous page's `offer` and writing into its detached zones.
 *
 * Measured against pristine server markup: pre-fix, the first simulated
 * navigation leaves the picker's Add doing nothing at all (zero assets land in
 * the zone) and the fairness verdict frozen, with no error logged. Post-fix,
 * add / remove / verdict all work on every pass. See frontend.md's 2026-09-03
 * entry.
 *
 * TheLeague's trade builder is a `client:load` React island and is NOT affected
 * — Astro re-hydrates an island per navigation.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/afl-fantasy/trade-builder.astro'),
  'utf-8',
);

describe('the AFL trade builder re-initialises on astro:page-load', () => {
  it('wires the builder inside an init() rather than at module scope', () => {
    const initAt = PAGE.indexOf('function init()');
    expect(initAt, 'the builder must live in an init() that re-runs per load')
      .toBeGreaterThan(-1);

    // The config blob goes stale exactly like the elements do — and this one is
    // not cosmetic: `fromFranchiseId` comes out of it and is what the submitted
    // proposal is sent as.
    for (const read of [
      "getElementById('tb-config')",
      "getElementById('zone-from')",
      "getElementById('tb-submit')",
      "getElementById('tb-to-select')",
    ]) {
      expect(PAGE.indexOf(read), `${read} must be re-read inside init()`).toBeGreaterThan(initAt);
    }

    expect(PAGE).toContain("document.addEventListener('astro:page-load', init)");
    // astro:page-load fires on the initial load too.
    expect(PAGE, 'astro:page-load already fires on the first load')
      .not.toMatch(/^\s*init\(\);\s*$/m);
  });

  it('replaces its delegated remove listener rather than stacking it', () => {
    // Re-adding per navigation stacks a handler each time; a once-flag pins the
    // survivor to the first page's `offer` object, which is the original bug.
    expect(PAGE).toContain("document.removeEventListener('click', onRemoveClick)");
    expect(PAGE).toContain("document.addEventListener('click', onRemoveClick)");
    expect(PAGE, 'the delegated handler must be held in a module-scoped var')
      .not.toMatch(/document\.addEventListener\('click', \(e\) =>/);
  });
});
