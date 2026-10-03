---
slug: waiver-fcfs-min-salary
status: shipped
severity: P1
opened: 2026-10-03
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1311
hotfix_sha: d07ee6c
followup_issue: 1312
followup_pr: TBD
shipped: 2026-10-03
followup_session: https://claude.ai/code/session_01Gkq5jef3JuYN3wCi3ptqGk
---

# Follow-up: waiver column called FCFS pickups free

## What broke
The Week 3 Schefter waiver-pickups column (`sf_2026_waiver_pickups_w03`) said
Pacific Pigskins and Da Dangsters picked up Chad Ryland and Xavier Hutchinson
"for zero dollars" as "free assets". In TheLeague, a first-come-first-served
pickup still signs at the $425K league minimum. Cause: MFL records no price on
a `FREE_AGENT` transaction row, so the fact sheet priced it at $0.

## What the hotfix did
PR #1311, squash `d07ee6c`: `minimumSalary: 425_000` on TheLeague's registry
entry; `scripts/article-types/waiver-pickups.mjs` prices FCFS adds at it and
states the rule; "highest single bid" counts only BBID bids; tests in
`tests/article-transaction-parse-guard.test.ts` for TheLeague (priced) and the
AFL (unpriced); the published Week 3 article was corrected.

The hotfix already shipped a guard test for the original bug, so no separate
F0 guard was owed.

## Deferred items
- [x] **F1 — Consolidate hardcoded 425000 onto the registry's `minimumSalary`**
  - Added `leagueMinimumSalary(slug)` to `src/config/leagues.ts` (throws for a
    league with no salaries instead of answering 0).
  - Converted the copies that MEAN the league minimum:
    `src/utils/surplus-value.ts`, `src/utils/cap-space-calculator.ts`,
    the four fallbacks in `src/utils/draft-pick-cap-impact.ts`, the two in
    `src/utils/draft-pick-value.ts`, the two in
    `scripts/lib/rookie-salary-slots.mjs` (now `ROOKIE_SALARY_FLOOR`),
    `src/utils/demo-mfl-standin.ts` (MFL's default bid/add salary),
    `scripts/generate-historical-salary-curves.mjs`,
    `scripts/analyze-salary-rank-correlation.mjs`.
    `scripts/demo/lib/simulate.mjs` bypassed its own `LEAGUE_RULES.minSalary`
    in three places; those now read the table.
  - Classified and LEFT: the rookie slot table rows (schedule data), the
    one-off `scripts/fix-season-salaries.mjs` correction table, the demo
    league's own rule table, and every comment quoting MFL's transaction
    strings or error text. The files the brief named as "most matter" —
    `waiver-claim.ts`, `api/waiver-claim.ts`, `mfl-transactions.ts`,
    `contract-eligibility.ts`, `august-cut-selection-core.mjs`,
    `players.astro` — held the figure only in comments (`waiver-claim.ts`
    reads the live bid minimum from MFL), so nothing to change there.
  - Rule-prose (`league-constitution.ts`, `rules.astro`, the auction hero copy)
    writes "$425,000"/"$425K" as constitution text and stays as written.
  - Guard: `tests/minimum-salary-literal-guard.test.ts` (wired into
    path-guard as `league-minimum-salary`) fails on a bare `425000`/`425_000`
    in `src/` or `scripts/` outside a four-entry allowlist.
- [x] **F2 — Teach the shared Schefter system prompt the minimum-salary rule**
  - `buildCachedSystem` (`scripts/article-utils/ai-client.mjs`) appends a
    `SALARY FLOOR` line to the UNCACHED league block from the registry, so every
    article type that passes `league` is told no pickup is free. The cached
    preamble stays league-neutral; leagues with no `minimumSalary` get nothing.
  - Not covered: `scripts/lib/pecking-order-ai.mjs` passes no `league` (it
    names its league inline) and so gets no floor line — power rankings do
    not price pickups, so this was left as is.
  - Tests: `tests/article-type-league-option.test.ts`.

## Insights recorded
`docs/claude/rules/schefter.md` § "A first-come-first-served pickup is never
free in a salary league" (and corrected the older line that said a free-agent
add is $0); CLAUDE.md league-registry section names `minimumSalary`.
