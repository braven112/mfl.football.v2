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

const PAGES = [
  ['TheLeague', 'src/pages/theleague/lineup.astro', 'theleague'],
  ['the AFL', 'src/pages/afl-fantasy/lineup.astro', 'afl-fantasy'],
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

describe.each(PAGES)('%s lineup page survives an in-site navigation', (_league, file, slug) => {
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
    const gate = SCRIPT.indexOf(`if (!document.querySelector('.lineup-page[data-league="${slug}"]')) return;`);
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

describe('the two lineup pages stay siblings', () => {
  it('applies the identical ClientRouter shape to both', () => {
    // These pages are near-line-identical (docs/claude/rules/lineups.md); a fix
    // that lands in one and not the other is how they drifted before.
    //
    // The league slug is the one thing that is SUPPOSED to differ — the whole
    // point of the cross-league gate — so it is normalised out before the
    // comparison. Everything else still has to match line for line.
    const shapeOf = (s: string) =>
      s
        .split('\n')
        .filter((l) =>
          /init\(\)|astro:page-load|onDeviceMotion|onMotionPermissionClick|stopRankingsWatch|data-league="[^"]+"\]'\)\) return|getElementById\('lineup-slots'\)\) return/.test(l),
        )
        .map((l) => l.replace(/data-league="[^"]+"/g, 'data-league="<slug>"'));
    const [a, b] = PAGES.map(([, file]) => controllerScript(file));
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });
});
