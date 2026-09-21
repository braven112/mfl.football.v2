/**
 * The roster page's controls under the ClientRouter.
 *
 * The original bug: the team-navigation chevron expanded an accordion holding
 * all 16 teams, and its wiring lived in a module-scope IIFE inside the page's
 * BUNDLED `<script>`. Astro evaluates such a script once per browser session —
 * ClientRouter keys `scriptsAlreadyRan` on it and swaps the DOM underneath —
 * so the handler bound on the first visit and never again. Every later arrival
 * got a fresh button with no handler, and the team list would not open until
 * the owner hard-refreshed. Nothing threw, because `initRosterPage` IS bound
 * to `astro:page-load`; only the chevron was dead.
 *
 * That chevron is now retired. The team switcher is a row of plain LINKS in a
 * shared component (components/shared/roster-header/TeamDivisionRow.astro),
 * which is what the first block below pins: a control that ships no client
 * script cannot be bound once per session, so the whole bug class is gone
 * rather than guarded. The rule itself still has teeth for the contract-action
 * buttons, which remain in the bundled script — so those cases are unchanged.
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

const TEAM_ROW = fs.readFileSync(
  path.join(process.cwd(), 'src/components/shared/roster-header/TeamDivisionRow.astro'),
  'utf-8',
);

describe('the team switcher needs no client script at all', () => {
  it('ships no <script> — the bug class is removed, not guarded', () => {
    expect(TEAM_ROW, 'a scriptless control cannot be bound once per session')
      .not.toMatch(/<script/);
  });

  it('switches team with links, so it works before hydration and is shareable', () => {
    // Anchors, not buttons: a team switch is a navigation. The ClientRouter
    // soft-swaps the document, so this stays cheap while the URL — and
    // therefore the SSR header beside it — always matches the table below.
    expect(TEAM_ROW).toMatch(/<a\s+href=\{teamHref\(/);
    expect(TEAM_ROW, 'a button would need JS and would not be linkable')
      .not.toMatch(/<button[^>]*data-team-id/);
  });

  it('is gone from the roster page, accordion and all', () => {
    for (const dead of ['initTeamNavAccordion', 'team-icon-btn', "data-accordion-toggle=\"team-nav\""]) {
      expect(PAGE, `${dead} should have retired with the old team card`).not.toContain(dead);
    }
  });
});

describe('the roster page binds its controls per page load, not per session', () => {
  it('is not wired by a module-scope IIFE', () => {
    expect(
      PAGE,
      'a module-scope IIFE runs once per session, not once per page load',
    ).not.toMatch(/\(function init\w+\s*\(/);
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
