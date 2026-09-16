---
slug: lineup-controller-untestable
status: open
severity: P3
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1120
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: the lineup controller's wiring can only be scan-tested

## What was found

Raised by Copilot on #1120, and it is correct: every guard on the lineup pages'
client controller — `tests/lineup-page-clientrouter.test.ts`,
`tests/cross-league-init-gate.test.ts`, and the new
`tests/lineup-bench-sync.test.ts` — is a **source scan**. They assert that the
file contains `renderBench()`, that `updateSubmitBar()` calls it, that the
`isConnected` guard precedes the render. None of them executes a swap.

So the layer that actually broke in #1120 — "the slots moved and the bench did
not" — is still verified by reading the source rather than by running it. A
regression in the live `currentSlots` wiring or the element refs could
reproduce the reported duplicate with all 21 assertions green.

## Why #1120 did not just add a jsdom test

The controller is a bundled inline `<script>` inside a ~2,400-line `.astro`
page. A test cannot import `renderBench` or `updateSubmitBar`; it can only
**re-implement** them. That is the failure mode this repo already has a rule
about (`docs/claude/insights/` — a fixture that agrees with the consumer by
construction proves nothing): the test would pass against a copy of the wiring
while the real wiring rotted. It would read as coverage and be worse than the
scan, which at least fails when the real file changes shape.

`vitest.config.ts` is also `environment: 'node'` with no jsdom installed, so
this would add a devDependency — and per CLAUDE.md the lockfile/CI install path
is not something to disturb inside a bug fix.

## What the follow-up should do

Pick ONE, not both:

1. **Extract the controller into a module** (`src/utils/lineup-controller.ts`
   or similar) that the page's `<script>` initialises with its refs and
   payload. Then a jsdom test drives the REAL `performSwap` → `renderBench`
   against real markup and asserts the slot/bench ids and count. This is the
   version with teeth, and it would also shrink two near-identical 2,400-line
   pages — see `docs/plans/` for the sibling-unforking direction and
   `tests/page-fork-ratchet.test.ts`.
2. **A Playwright smoke test** against the Vercel preview, driving a real swap
   on both league pages. Needs an authenticated session in CI, which is the
   blocker — the pages are auth-gated and `/live` has no logged-in browser.

Option 1 is the recommendation: it removes the reason the test is hard rather
than working around it.

## Interlock

Do not close this by adding a jsdom test that re-implements the controller.
That is the outcome this brief exists to prevent.
