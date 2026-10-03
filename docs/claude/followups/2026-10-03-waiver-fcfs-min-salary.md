---
slug: waiver-fcfs-min-salary
status: open
severity: P1
opened: 2026-10-03
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1311
hotfix_sha: d07ee6c
followup_issue: 1312
followup_pr:
followup_session: session_01Gkq5jef3JuYN3wCi3ptqGk
---

# Follow-up: waiver column called FCFS pickups free

## What broke
The Week 3 Schefter waiver-pickups column (`sf_2026_waiver_pickups_w03`) said
two first-come-first-served pickups cost "zero dollars". In TheLeague every
pickup signs at the $425K league minimum. MFL records no price on a
`FREE_AGENT` row, so the fact sheet priced it at $0.

## What the hotfix did
- Added `minimumSalary: 425_000` to TheLeague's registry entry
  (`src/config/leagues-data.mjs`, typed in `src/config/leagues.ts`).
- `scripts/article-types/waiver-pickups.mjs` prices FCFS pickups at that
  minimum and states the rule in the fact sheet. "Highest single bid" counts
  only BBID bids.
- Tests in `tests/article-transaction-parse-guard.test.ts` cover TheLeague
  (priced) and the AFL (unpriced).
- Rewrote paragraphs 3–4 of the published Week 3 article.

## Deferred items

- [ ] **F1 — Consolidate hardcoded 425000 onto `minimumSalary`**
  - Source: Claude review, /hotfix step 5
  - Where: about 17 files. Most matter: `src/utils/waiver-claim.ts`,
    `src/pages/api/waiver-claim.ts`, `src/utils/cap-space-calculator.ts`,
    `src/utils/contract-eligibility.ts`, `src/utils/draft-pick-cap-impact.ts`,
    `src/utils/surplus-value.ts`, `src/utils/mfl-transactions.ts`,
    `src/utils/august-cut-selection-core.mjs`, `src/pages/theleague/players.astro`.
  - Why deferred: a cross-cutting refactor; it would have widened a one-file fix.
  - Note: some of these 425000s are rookie-slot or demo values rather than
    the league minimum (`scripts/lib/rookie-salary-slots.mjs`,
    `scripts/demo/lib/simulate.mjs`). Classify each first. Consider a
    `/guard-test` that forbids a bare 425000 outside the registry.

- [ ] **F2 — State the minimum-salary rule in the shared Schefter system prompt**
  - Source: Claude review, /hotfix step 5
  - Where: `scripts/article-utils/ai-client.mjs:148` (`buildCachedSystem`)
  - Why deferred: the hotfix fixed only the article type that made the
    error. Read the rule from the registry so every article type knows an
    FCFS pickup is never free.

## Context to start cold
- `FREE_AGENT` strings are `"addId,|dropId,"` and carry no price. BBID rows
  are `"addId,|bid|dropId,"` and the bid is the salary. Parse only via
  `scripts/lib/roster-move-parse.mjs#parseRosterMove`.
- `minimumSalary` is optional on purpose: the AFL and Best Ball have no
  salaries and must stay unpriced.
- `scripts/schefter-scan.mjs#generateFreeAgentPost` omits the salary on FCFS
  posts instead of printing $0, so it is not affected.
