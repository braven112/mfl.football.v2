/**
 * The Salary Analytics page's client scripts under the ClientRouter.
 *
 * Astro BUNDLES both of them, so each is evaluated once per document and the
 * router swaps the DOM without re-evaluating it. Everything ran at module
 * scope, so on a return visit the season and week selects were bound to
 * detached nodes and the delegated Show More handler was still closed over the
 * previous page's config. Nothing threw.
 *
 * Measured against pristine server markup across three simulated swaps: the
 * pre-fix page comes back with the week dropdown holding ONE option (its
 * server-rendered "Season Total" — the controller never repopulated it) and a
 * select that no longer answers a `change`. Post-fix it holds all 31 on every
 * pass and the snapshot label still moves. See frontend.md's 2026-09-03 entry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/theleague/salary.astro'),
  'utf-8',
);
const EXPORT_HANDLER = fs.readFileSync(
  path.join(process.cwd(), 'src/scripts/salary-export-handler.ts'),
  'utf-8',
);

describe('the salary page re-initialises on astro:page-load', () => {
  it('wires the controller inside an init() rather than at module scope', () => {
    const initAt = PAGE.indexOf('function init()');
    expect(initAt, 'the controller must live in an init() that re-runs per load')
      .toBeGreaterThan(-1);

    // The config blob goes stale exactly like the elements do.
    for (const read of [
      "getElementById('salary-config')",
      "getElementById('salarySeasonSelect')",
      "getElementById('salaryWeekSelect')",
    ]) {
      expect(PAGE.indexOf(read), `${read} must be re-read inside init()`).toBeGreaterThan(initAt);
    }

    expect(PAGE).toContain("document.addEventListener('astro:page-load', init)");
    // astro:page-load fires on the initial load too.
    expect(PAGE, 'astro:page-load already fires on the first load')
      .not.toMatch(/^\s*init\(\);\s*$/m);
  });

  it('replaces its delegated Show More listener rather than stacking it', () => {
    // `document` is the one node the swap does NOT replace, so re-adding per
    // navigation stacks a handler each time — and a once-flag would pin the
    // survivor to the first page's config, which is the original bug.
    expect(PAGE).toContain("document.removeEventListener('click', onShowMoreClick)");
    expect(PAGE).toContain("document.addEventListener('click', onShowMoreClick)");
    expect(PAGE, 'the delegated handler must be held in a module-scoped var')
      .not.toMatch(/document\.addEventListener\('click', \(event\) =>/);
  });

  it('re-inits the Export to Excel button too', () => {
    // Same page, same trap, separate module: a single module-scope call bound
    // the listener to the FIRST page's button and closed over its config, so
    // Export was dead on a return visit alongside the selects.
    expect(EXPORT_HANDLER).toContain(
      "document.addEventListener('astro:page-load', initExportButton)",
    );
    expect(EXPORT_HANDLER, 'the module-scope call is what broke it')
      .not.toMatch(/^\s*initExportButton\(\);\s*$/m);
  });
});
