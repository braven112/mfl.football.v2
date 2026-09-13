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

const PAGES = [
  ['TheLeague', 'src/pages/theleague/lineup.astro'],
  ['the AFL', 'src/pages/afl-fantasy/lineup.astro'],
] as const;

/** Just the page's bundled controller `<script>`, never the markup or styles. */
function controllerScript(file: string): string {
  const src = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
  const start = src.indexOf('\n  <script>\n');
  const end = src.indexOf('\n  </script>', start);
  expect(start, `${file}: no bundled controller script`).toBeGreaterThan(-1);
  expect(end, `${file}: unterminated controller script`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe.each(PAGES)('%s lineup page survives an in-site navigation', (_league, file) => {
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
    const gate = SCRIPT.indexOf("if (!document.getElementById('lineup-slots')) return;");
    expect(gate, 'init must bail when the lineup DOM is gone').toBeGreaterThan(-1);

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
    const [a, b] = PAGES.map(([, file]) => controllerScript(file));
    const shapeOf = (s: string) =>
      s.split('\n').filter((l) => /init\(\)|astro:page-load|onDeviceMotion|onMotionPermissionClick|stopRankingsWatch|getElementById\('lineup-slots'\)\) return/.test(l));
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });
});
