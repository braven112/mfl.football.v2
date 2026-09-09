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

describe('the roster team-nav accordion re-binds on every page load', () => {
  it('is not wired by a module-scope IIFE', () => {
    expect(
      PAGE,
      'a module-scope IIFE runs once per session, not once per page load',
    ).not.toMatch(/\(function initTeamNavAccordion\s*\(/);
  });

  it('is called from initRosterPage(), which astro:page-load re-runs', () => {
    const defineAt = PAGE.indexOf('const initTeamNavAccordion =');
    expect(defineAt, 'the accordion wiring must be a callable function').toBeGreaterThan(-1);

    const initAt = PAGE.indexOf('const initRosterPage = ');
    expect(initAt).toBeGreaterThan(-1);

    const callAt = PAGE.indexOf('initTeamNavAccordion();');
    expect(callAt, 'initTeamNavAccordion() must be called from inside initRosterPage')
      .toBeGreaterThan(initAt);

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
});
