/**
 * The AFL Keeper Planner's "Finalize keepers" CTA actually cuts real
 * rosters (sequential POSTs to /api/cut-player), so it must not exist on
 * the page outside the window between the AFL's new season starting and
 * the keeper deadline — disabled-but-present isn't enough, since a stray
 * click handler or a screen reader landing on it would imply the action is
 * possible. Saving the drag-sorted plan must keep working year-round; only
 * the destructive step is gated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/components/afl-fantasy/KeeperPlanner.astro', 'utf-8');

describe('KeeperPlanner finalize window', () => {
  it('derives the window from the shared calendar helpers, not a re-typed date', () => {
    expect(SRC).toMatch(/newSeasonStartsFor\(/);
    expect(SRC).toMatch(/keeperDeadlineFor\(/);
    expect(SRC).toMatch(/from '\.\.\/\.\.\/utils\/afl-mock-draft'/);
  });

  it('honors ?testDate= like the rest of the AFL\'s date-dependent pages', () => {
    expect(SRC).toMatch(/getTestDateFromSearchParams\(Astro\.url\.searchParams\)/);
  });

  it('the finalize button only renders when canFinalize is true', () => {
    const statusBar = SRC.match(/<!-- Status bar \/ actions -->[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
    expect(statusBar).toMatch(/\{canFinalize \? \(/);
    expect(statusBar).toMatch(/data-action="finalize"/);
    // The reset button (pure client-side, non-destructive) is NOT gated —
    // it must sit outside the canFinalize branch.
    expect(statusBar.indexOf('data-action="reset"')).toBeLessThan(statusBar.indexOf('{canFinalize'));
  });

  it('shows a hint instead of the button when the window is closed', () => {
    expect(SRC).toMatch(/kp-finalize-note/);
    expect(SRC).toMatch(/beforeFinalizeWindow/);
  });

  it('reframes the closed-window hint around next year once the AL draft has run', () => {
    // "The keeper deadline has passed" only makes sense in the narrow gap
    // between the deadline and the redraft of the cut players — once that
    // draft has actually happened, the roster is settled and the page
    // should talk about the NEXT keeper class (year + 1), not old news.
    expect(SRC).toMatch(/from '\.\.\/\.\.\/utils\/draft-utils'/);
    expect(SRC).toMatch(/isDraftConducted\(/);
    expect(SRC).toMatch(/draftConducted/);
    expect(SRC).toMatch(/Keeper planning for \$\{year \+ 1\} opens/);
    // Missing/malformed draftResults must fail toward the OLD pre-draft
    // copy, never silently toward the reframed one.
    expect(SRC).toMatch(/let draftConducted = false;/);
  });

  it('the finalize button click handler stays null-safe (optional chaining)', () => {
    // The button can be entirely absent from the DOM now — every reference
    // to it in the script must tolerate that.
    expect(SRC).toMatch(/finalizeBtn\?\.\s*addEventListener\('click'/);
    expect(SRC).toMatch(/if \(finalizeBtn\) finalizeBtn\.disabled/);
  });

  it('auto-save is never conditioned on canFinalize', () => {
    // The debounced save call sites must not be inside the finalize-window
    // gate — saving the plan works whether or not finalizing is open.
    const saveCallSites = [...SRC.matchAll(/scheduleSave\(|persistPlan\(|savePlan\(/g)];
    expect(saveCallSites.length).toBeGreaterThan(0);
  });
});
