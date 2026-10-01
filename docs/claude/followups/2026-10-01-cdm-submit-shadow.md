---
slug: cdm-submit-shadow
status: open
severity: P1
opened: 2026-10-01
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1288
hotfix_sha: c177462
followup_issue: 1291
followup_pr:
followup_session: session_015p8F872MvYWtfVUvcLSGFG
---

# Follow-up: contract declarations failed with "reading 'cancelled'"

## What broke
Pressing **Declare Contract** in the roster player sheet (TheLeague) showed
"Cannot read properties of undefined (reading 'cancelled')" and filed nothing.
Broken since #1151 (2026-09-17, Front Office hub), found 2026-10-01 by an owner
with a live 24h declaration deadline.

## What the hotfix did
`src/utils/cdm-wizard.ts:1496` declared its click handler as a local
`const submitDeclaration`, shadowing `import { submitDeclaration } from
'./contract-actions-client'`. The handler's "API call" therefore called itself,
recursed until the stack overflowed, one level caught the RangeError and returned
`undefined`, and the level above read `.cancelled` off it. No request ever reached
`/api/contracts/declare`. The hotfix renamed the handler to
`handleDeclarationSubmit`, added `tests/cdm-wizard-submit-shadow.test.ts` (wired
into path-guard's `front-office-hub` domain), and retightened the type baseline
1351 → 1349 — the two errors removed WERE the bug.

## Deferred items

- [ ] **F1 — The type checker saw this bug on day one and the ratchet absorbed it**
  - Source: deferred at implementation (found while retightening the baseline)
  - Where: `tests/fixtures/typecheck-baseline.json` (`clearedClasses`),
    `tests/typecheck-baseline.typecheck.ts`
  - What: #1151 introduced two `astro check` errors (an argument passed to a
    zero-arg function, `.cancelled` on `void`). The baseline is a COUNT, so they
    hid inside a run that also removed errors elsewhere. The guard shipped with the
    hotfix covers this one file only. Generalise it: pin "a local binding shadows a
    named import in the same module" as a `clearedClasses` entry at 0 (or a
    repo-wide scan guard under `/guard-test`), so the next shadowed import fails CI
    in any file.
  - Why deferred: repo-wide scan needs a census of existing hits first; out of
    scope for a two-line hotfix.

- [ ] **F2 — Owners who tried to declare between 2026-09-17 and 2026-10-01**
  - Source: deferred at implementation
  - Where: `src/pages/api/contracts/declare.ts`, declaration store (Redis)
  - What: every wizard declaration in that window failed client-side and never
    reached the server, so no server log records the attempts. Any owner whose
    deadline lapsed in that window may have been defaulted through no fault of
    their own. Identify players whose declaration deadline (acquisition + window)
    fell inside it and who have no filed declaration, and hand the list to the
    commissioner. Rosters-page bulk submit and the homepage Unsigned FA card used
    the shared client directly and were NOT affected.
  - Why deferred: a data audit plus a commissioner decision, not a code fix.

## Context to start cold
- Only TheLeague's rosters page imports `cdm-wizard.ts`; `scripts/sibling-drift.mjs`
  found no AFL twin. `FrontOfficeActions.astro` and `HpUnsignedFaCard.astro` import
  `submitDeclaration` themselves and have no local binding of the name.
- The fix was not click-tested on a preview: previews share production's Redis,
  so a test declaration would have filed a real pending contract.
- Copilot's one finding on #1288 (wire the guard into path-guard) was fixed in the
  PR, not deferred.
