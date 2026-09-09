/**
 * The roster page's team-navigation chevron under the ClientRouter.
 *
 * The chevron above the roster table expands the accordion holding all 16
 * teams — it is how an owner gets from their own roster to anyone else's.
 * Its wiring lived in a module-scope IIFE inside the page's BUNDLED
 * `<script>`, and Astro evaluates such a script once per browser session:
 * ClientRouter keys `scriptsAlreadyRan` on it and swaps the DOM underneath.
 * So the click handler was bound on the first visit to the page and never
 * again — every later arrival got a fresh button with no handler, and the
 * team list would not open until the owner hard-refreshed. Nothing threw,
 * and the rest of the page kept working because `initRosterPage` IS bound
 * to `astro:page-load`.
 *
 * Measured with a real browser against the dev server (first load, in-site
 * navigation away and back): pre-fix the second visit's click left
 * `aria-expanded="false"` and the content `collapsed`; post-fix both visits
 * expand.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/theleague/rosters.astro'),
  'utf-8',
);

/**
 * The body of initRosterPage, from its declaration to the astro:page-load
 * registration that follows it.
 *
 * "the call appears after `const initRosterPage`" is NOT enough on its own —
 * a module-scope call placed below the function satisfies that while being
 * exactly the bug (thanks, Copilot). A call is only re-run per navigation if
 * it is INSIDE the function, so the guards below check the region and the
 * indentation, and separately reject a call at module scope (two spaces).
 */
const INIT_BODY = (() => {
  const start = PAGE.indexOf('const initRosterPage = ');
  const end = PAGE.indexOf("document.addEventListener('astro:page-load', initRosterPage)");
  expect(start, 'initRosterPage must exist').toBeGreaterThan(-1);
  expect(end, 'initRosterPage must be registered on astro:page-load').toBeGreaterThan(start);
  return PAGE.slice(start, end);
})();

/** Asserts `fn()` is called from inside initRosterPage, not at module scope. */
const expectCalledFromInit = (fn: string) => {
  expect(INIT_BODY, `${fn}() must be called from inside initRosterPage`).toMatch(
    new RegExp(`^ {4,}${fn}\\(\\);$`, 'm'),
  );
  expect(PAGE, `${fn}() at module scope runs once per SESSION, not per page load`)
    .not.toMatch(new RegExp(`^ {0,2}${fn}\\(\\);$`, 'm'));
};

describe('the roster page binds its controls per page load, not per session', () => {
  it('is not wired by a module-scope IIFE', () => {
    expect(
      PAGE,
      'a module-scope IIFE runs once per session, not once per page load',
    ).not.toMatch(/\(function initTeamNavAccordion\s*\(/);
  });

  it('is called from initRosterPage(), which astro:page-load re-runs', () => {
    const defineAt = PAGE.indexOf('const initTeamNavAccordion =');
    expect(defineAt, 'the accordion wiring must be a callable function').toBeGreaterThan(-1);

    expectCalledFromInit('initTeamNavAccordion');
    expect(PAGE).toContain("document.addEventListener('astro:page-load', initRosterPage)");
  });

  it('assigns its handlers rather than adding them', () => {
    // initRosterPage runs twice on the initial load ("Initial-Load
    // Double-Init", docs/claude/insights/domains/frontend.md), so an added
    // listener would stack and every click would toggle the accordion twice —
    // i.e. open and immediately close it.
    expect(PAGE).toContain('toggleButton.onclick = toggleAccordion;');
    expect(PAGE, 'a stacked click listener toggles twice per click')
      .not.toMatch(/toggleButton\.addEventListener\(/);
  });

  it('wires the contract-action buttons the same way', () => {
    // Same bundled script, same trap, and a worse symptom: updateClearAllButton()
    // re-queries both buttons by id to show them, so a module-scope binding left
    // a VISIBLE Submit button with no handler on a return visit — a franchise
    // tag or veteran extension that never reached the commissioner.
    for (const id of ['clearAllTagsBtn', 'submitFranchiseTagsBtn']) {
      expect(
        PAGE,
        `#${id} must not be bound with addEventListener at module scope`,
      ).not.toMatch(new RegExp(`getElementById\\('${id}'\\);\\n\\s*\\w+\\?\\.addEventListener`));
    }

    expectCalledFromInit('initContractActionButtons');

    // Assigned, not added — a stacked submit handler POSTs every declaration twice.
    expect(PAGE).toContain('submitBtn.onclick = handleSubmitFranchiseTagsClick;');
    expect(PAGE).toContain('clearAllBtn.onclick = handleClearAllTagsClick;');
  });
});
