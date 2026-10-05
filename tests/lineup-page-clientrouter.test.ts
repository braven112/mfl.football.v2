/**
 * The lineup PAGES' own controller scripts under the ClientRouter.
 *
 * Both pages did all their DOM wiring at module-eval time. An Astro module
 * script is evaluated ONCE per document and the router swaps the DOM without
 * re-evaluating it, so on a return visit every `getElementById` below pointed
 * at the previous page's detached nodes: tapping a slot opened nothing, Submit
 * did nothing, and NOTHING was logged. A hard reload "fixed" it every time.
 *
 * Verified by driving simulated swaps against pristine server markup with a
 * different payload each pass: post-fix the CDM opens on every pass and the
 * saved draft carries THAT pass's week; pre-fix the first swap already answers
 * `open: false` with an empty candidate list and no draft written. See
 * docs/claude/rules/lineups.md and frontend.md's 2026-09-03 entry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './helpers/js-source';

/**
 * [label, file, the init's own-page gate]. Every league renders ONE shared
 * page component, whose one controller finds its own marker first and bails
 * on that. Until Oct 2026 TheLeague carried a forked copy with its own
 * controller; see the last describe below for what keeps it from coming back.
 */
const PAGES = [
  ['the shared', 'src/components/shared/lineup/LineupPage.astro', `if (!pageRoot) return;`],
] as const;

/** The whole page file, markup and styles included. */
function pageSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
}

/**
 * Just the page's bundled controller `<script>`, never the markup or styles,
 * and with comments blanked out.
 *
 * Comments are blanked because every assertion below that measures WHERE
 * something sits does it with `indexOf`. On raw text an explanatory comment
 * quoting `getElementById('lineup-submit')` shifts those offsets and fails a
 * correct file — that happened twice while writing the Sept 2026 hotfix, and
 * the workaround was to reword the comment, which is the guard constraining
 * prose. Blanking also stops a commented-out call from satisfying an
 * assertion. `stripComments` preserves length, so offsets still map to the
 * real file.
 */
function controllerScript(file: string): string {
  const src = pageSource(file);
  const start = src.indexOf('\n  <script>\n');
  const end = src.indexOf('\n  </script>', start);
  expect(start, `${file}: no bundled controller script`).toBeGreaterThan(-1);
  expect(end, `${file}: unterminated controller script`).toBeGreaterThan(start);
  return stripComments(src.slice(start, end));
}

describe.each(PAGES)('%s lineup page survives an in-site navigation', (_league, file, gateStatement) => {
  const SCRIPT = controllerScript(file);

  it('wires everything inside an init() registered on astro:page-load', () => {
    const initAt = SCRIPT.indexOf('function init()');
    expect(initAt, 'the controller must live in an init() that re-runs per load')
      .toBeGreaterThan(-1);

    // Every ref the handlers close over is resolved AFTER init() opens, or it
    // is the previous page's node.
    for (const read of [
      "getElementById('lineup-slots')",
      "getElementById('lineup-submit')",
      "getElementById('lineup-cdm')",
      "getElementById('lineup-announcer')",
    ]) {
      expect(SCRIPT.indexOf(read), `${read} must be re-read inside init()`).toBeGreaterThan(initAt);
    }

    // The SSR payload goes stale exactly like the elements do — the `is:inline`
    // block that assigns it is re-executed by the router on every arrival, so a
    // value captured beside the imports is the week the owner just left.
    expect(SCRIPT.indexOf('__LINEUP_DATA__'), 'the payload must be re-read inside init()')
      .toBeGreaterThan(initAt);

    expect(SCRIPT).toContain("document.addEventListener('astro:page-load', init)");
    // astro:page-load fires on the initial load too, so a direct call double-inits:
    // every slot double-bound and loadDraft() replayed twice.
    expect(SCRIPT, 'astro:page-load already fires on the first load')
      .not.toMatch(/^\s*init\(\);\s*$/m);
  });

  it('tears down its document/window registrations instead of stacking them', () => {
    // `document` and `window` are the nodes the swap does NOT replace. Re-adding
    // per navigation stacks one handler each time; a once-flag is no better —
    // it pins the survivor to the first page's dead nodes, which is the original
    // bug. Remove-then-add is the only shape that gets one listener AND a live
    // closure.
    expect(SCRIPT).toContain("document.removeEventListener('click', onMotionPermissionClick)");
    expect(SCRIPT).toContain("document.addEventListener('click', onMotionPermissionClick");

    // A surviving devicemotion listener is worse than a duplicate: it keeps
    // shaking a detached page's lineup back through undoLastSwap().
    expect(SCRIPT).toContain("window.removeEventListener('devicemotion', onDeviceMotion)");
    expect(SCRIPT).toContain("window.addEventListener('devicemotion', onDeviceMotion)");

    // onRankingsChanged registers on `window` and hands back an unsubscribe —
    // dropping it on the floor leaks one watch per navigation.
    expect(SCRIPT).toMatch(/stopRankingsWatch = onRankingsChanged\(/);
    expect(SCRIPT).toContain('stopRankingsWatch?.()');

    // The bare `window.addEventListener('devicemotion', (e) => {` shape is the
    // one that shipped — it must not come back.
    expect(SCRIPT, 'hold the handler in a module-scoped var, do not inline it')
      .not.toMatch(/addEventListener\('devicemotion', \(/);
  });

  it('bails instead of throwing when the payload is missing', () => {
    // Under init() a throw aborts the astro:page-load listener chain, taking
    // every other component's re-init on the page down with it.
    expect(SCRIPT).not.toContain("throw new Error('Missing lineup data')");
    expect(SCRIPT).toMatch(/if \(!data\) return;/);
  });

  it('gates on a node the router replaced, not on the window payload', () => {
    // `init` lives on `document`, which the swap does NOT replace, so it fires
    // on every in-site navigation for the rest of the session. `__LINEUP_DATA__`
    // is a `window` global, so it is STILL this page's payload on the next
    // page — which makes `if (!data) return` unfalsifiable after one lineup
    // visit. init then ran its body on /rosters, `lineup-submit` answered null,
    // and `submitBtn.querySelector(...)` threw an uncaught TypeError that took
    // the whole page down. The gate has to ask the DOM, not the window.
    const gate = SCRIPT.indexOf(gateStatement);
    expect(gate, "init must bail when this league's lineup DOM is gone").toBeGreaterThan(-1);

    // The slots list is still checked too: the controller's first ref read is a
    // non-null assertion on it, so "right league, no slots" must bail as well.
    expect(
      SCRIPT.indexOf("if (!document.getElementById('lineup-slots')) return;"),
      'the slots node must still be checked',
    ).toBeGreaterThan(gate);

    // Before the first ref read, or the null deref happens anyway.
    for (const read of [
      "getElementById('lineup-submit')",
      "getElementById('lineup-cdm')",
      "getElementById('lineup-announcer')",
    ]) {
      expect(SCRIPT.indexOf(read), `the gate must precede ${read}`).toBeGreaterThan(gate);
    }

    // But AFTER the teardown: leaving the page is exactly when the surviving
    // document/window registrations must come off, so an early return that
    // skips the teardown leaks a devicemotion listener per navigation.
    expect(
      SCRIPT.indexOf("window.removeEventListener('devicemotion', onDeviceMotion)"),
      'the teardown must still run on the way out',
    ).toBeLessThan(gate);
  });

});

describe('every league renders the ONE lineup page', () => {
  // The pages used to be two near-identical forks whose controllers drifted —
  // the ClientRouter fix above had to be landed twice and was compared line by
  // line here. Now every league's route is a thin wrapper over the shared
  // component, so a fix lands once. This keeps it that way: a route that grows
  // its own body (or stops rendering the component) is a fork coming back.
  const routes = fs
    .readdirSync(path.join(process.cwd(), 'src/pages'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'api')
    .map((d) => `src/pages/${d.name}/lineup.astro`)
    .filter((f) => fs.existsSync(path.join(process.cwd(), f)));

  it('finds the league routes', () => {
    expect(routes).toContain('src/pages/theleague/lineup.astro');
    expect(routes).toContain('src/pages/afl-fantasy/lineup.astro');
  });

  it.each(routes)('%s is a thin wrapper over the shared component', (route) => {
    const src = pageSource(route);
    expect(src, `${route} must render the shared lineup page`).toContain("components/shared/lineup/LineupPage.astro'");
    expect(src, `${route} must not carry its own controller`).not.toContain('<script');
    expect(src.split('\n').length, `${route} has grown a body — put it in the shared component`).toBeLessThanOrEqual(80);
  });
});
