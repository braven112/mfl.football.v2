/**
 * MatchupSelector's dropdown script under the ClientRouter.
 *
 * NOTE FOR WHOEVER MOUNTS THIS: the component is currently imported by NOTHING
 * (leftover from the unfinished `.kiro/specs/dynamic-matchup-previews` spec), so
 * this fix is pre-emptive — no live page regressed. It was verified for real by
 * mounting it on a temporary dev route and driving router navigations: pre-fix,
 * the trigger stops opening the menu from the SECOND arrival onward; post-fix it
 * opens, closes on an outside click and closes on Escape on all three, with the
 * `document` keydown tally flat.
 *
 * The trap: setup was registered on `DOMContentLoaded`, which never fires again
 * after an in-site navigation, and the two `document`-level listeners it adds
 * close over `trigger` and `menu`. See frontend.md's 2026-09-03 entry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENT = fs.readFileSync(
  path.join(process.cwd(), 'src/components/theleague/MatchupSelector.astro'),
  'utf-8',
);

/** Comment lines are stripped — the fix's own comments NAME the old shapes. */
const CODE = COMPONENT.split('\n')
  .filter((l) => {
    const t = l.trim();
    return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

describe('MatchupSelector re-initialises on astro:page-load', () => {
  it('does not rely on DOMContentLoaded', () => {
    // DOMContentLoaded fires once per document. Under the router that is the
    // first page only, so the dropdown was dead on every return visit.
    expect(CODE, 'DOMContentLoaded never fires again after a swap')
      .not.toContain('DOMContentLoaded');
    expect(CODE).toContain("document.addEventListener('astro:page-load', initMatchupSelector)");
    // astro:page-load fires on the initial load too, so the old immediate call
    // must not survive alongside it.
    expect(CODE).not.toMatch(/^\s*initMatchupSelector\(\);\s*$/m);
  });

  it('replaces its document listeners rather than stacking them', () => {
    expect(CODE).toContain("document.removeEventListener('click', onDocumentClick)");
    expect(CODE).toContain("document.addEventListener('click', onDocumentClick)");
    expect(CODE).toContain("document.removeEventListener('keydown', onDocumentKeydown)");
    expect(CODE).toContain("document.addEventListener('keydown', onDocumentKeydown)");
    // The inline shapes are the ones that shipped.
    expect(CODE).not.toMatch(/document\.addEventListener\('(click|keydown)', \(e\) =>/);
  });

  it('tears down BEFORE bailing on a page that has no selector', () => {
    // Navigating to a page WITHOUT the component still runs init(), and if the
    // teardown sat after the `!trigger || !menu` bail, the previous page's
    // handlers would stay armed on `document` — closing a dropdown that no
    // longer exists, over nodes that no longer exist.
    const teardownAt = CODE.indexOf("document.removeEventListener('click', onDocumentClick)");
    const bailAt = CODE.indexOf('if (!trigger || !menu) return;');
    expect(teardownAt).toBeGreaterThan(-1);
    expect(bailAt).toBeGreaterThan(-1);
    expect(teardownAt, 'the teardown must run before the bail').toBeLessThan(bailAt);
  });
});
