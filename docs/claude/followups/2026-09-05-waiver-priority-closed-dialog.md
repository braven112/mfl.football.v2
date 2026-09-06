---
slug: waiver-priority-closed-dialog
status: open
severity: P1
opened: 2026-09-05
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/979
hotfix_sha: 2d5eef5
followup_issue: 980
followup_pr:
followup_session:
---

# Follow-up: closed waiver priority card stayed painted over Free Agents

## What broke
Reported 2026-09-05 17:05 PT from the AFL free-agents page on a phone.
Closing the waiver priority card left it on the page — no backdrop, the
twelve-team list painted over the player table at the foot of the table. The
card shipped that morning (c246722, the owners-poll reapply) and the SSR order
from #974 made the closed panel twelve rows tall, which is when it became
impossible to miss.

## What the hotfix did
Forward fix, one rule moved. `src/styles/waiver-priority-modal.css` set
`display: flex` on the `<dialog>` element's own class, which overrides the UA
`dialog:not([open]) { display: none }`; the column layout now lives on
`.wpm[open]`. Guard: `tests/dialog-closed-display.test.ts` scans every
`<dialog>` in `src/components/shared/*.astro` for an author `display` on its
bare class selector, wired into the `theming-and-assets` path-guard domain.
Staging changelog entry added (`bug-fix`, `afl`).

## Deferred items

- [ ] **F1 — The guard does not run at edit time for the scoped modal styles**
  - Source: Claude review, `/code-review` on #979
  - Where: `.claude/hooks/path-guard.json:125` (`theming-and-assets` routes
    `src/styles/**` only); `.wcm` and `.sim` are styled in the scoped `<style>`
    blocks of `src/components/shared/WaiverClaimModal.astro` and
    `SignInModal.astro`, which route to the client-scripts domain
  - Why deferred: coverage of the hook, not of CI — CI runs the test either way

- [ ] **F2 — The scan treats only `.cls` / `dialog.cls` as the bare selector**
  - Source: Claude review
  - Where: `tests/dialog-closed-display.test.ts:59` (`bareRuleBodies`)
  - Why deferred: `#waiver-priority-modal { display }` or a global
    `dialog { display }` would reproduce the bug past a green guard; capture the
    id from the tag and treat `#id`, `dialog`, `.cls`, `dialog.cls` as bare

- [ ] **F3 — The scan reads only the top level of `src/components/shared` and `class="…"`**
  - Source: Claude review, and Copilot's one finding on #979 (recursive walk of
    `src/components/shared/**`)
  - Where: `tests/dialog-closed-display.test.ts:32` (`nativeDialogs`)
  - Why deferred: the React dialogs
    (`src/components/theleague/rankings-import/ImportDetailModal.tsx`,
    `ConfirmDeleteModal.tsx`, `className="ri-modal"`, styled in
    `src/components/shared/rankings-import/ImportRankingsPage.astro`) are clean
    today but unguarded; walk `src/components/**` and `src/pages/**` and match
    `className=` too

- [ ] **F4 — Record the rule in the theming rules doc**
  - Source: Claude review (CLAUDE.md: "Adding a gotcha? Put it in the domain doc")
  - Where: `docs/claude/rules/theming-and-assets.md`; the rule lives only in
    the CSS comment at `src/styles/waiver-priority-modal.css:57` and the test
    docblock
  - Why deferred: docs; one short entry (rule, trap line, test name)

- [ ] **F5 — Fold in any Copilot / Gemini / CodeQL findings that landed on #979 after the merge**
  - Source: external reviewers; Copilot and CodeQL had completed clean before
    the merge, Gemini's review job was skipped
  - Where: https://github.com/braven112/mfl.football.v2/pull/979

## Context to start cold
- Repro is a one-file Chromium check, no dev server: set page content to the
  stylesheet plus `<dialog class="wpm">`, read `getComputedStyle(dialog).display`
  before `showModal()`, after, and after `close()`. Before the fix: flex / flex
  / flex with a 68px box. After: none / flex / none.
- The modal is mounted only on the AFL free-agents page; there is no sibling.
- The stylesheet is external on purpose (rows are injected with innerHTML, so
  scoped styles would not reach them) — see the file's header comment. Do not
  move the rule into a scoped block.
- `.wcm` (WaiverClaimModal) and `.sim` (SignInModal) set no `display`; the
  React `.ri-modal` dialogs do not either.
