---
slug: roster-page-unpaired-week-404
status: open
severity: P0
opened: 2026-09-08
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1016
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: the roster page 404'd on a week MFL had not paired up

## What broke

`theleague.us/rosters` served the Schefter 404 page to every owner on TheLeague
(the AFL was fine). The route was never missing — the SSR render threw, and the
throw came back as a 404, so an outage looked like a deleted page.

```
TypeError: Cannot read properties of undefined (reading 'franchise')
    at processWeeklyScores (rosters.astro:376)
```

The season rollover filled `data/theleague/mfl-feeds/2026/weekly-results-raw.json`
out to Week 17. MFL returns a week it has **not paired into matchups** as
`{ week, franchise }` with no `matchup` key at all — 2026 weeks 15-17 all arrived
that way. The page's inline `processWeeklyScores` wrapped that `undefined` into
an array (`: [weekResults.matchup]` → `[undefined]`) and the next line read
`matchup.franchise` off it.

## What the hotfix did

A forward fix, not a revert. In all three copies of `processWeeklyScores`, prove
`weekResults.matchup` truthy before making a list of it, and skip a null
`matchup` / `franchise` before dereferencing:

- `src/pages/theleague/rosters.astro:381` — the copy that took the site down
- `src/utils/weekly-scores.ts:37` — same defect, currently unimported
- `src/utils/coach-data.ts:345` — had the inner null guards, still had the wrap

Plus `tests/weekly-results-matchup-guard.test.ts` (F1 shipped WITH the fix, not
deferred) and its wiring in `.claude/hooks/path-guard.json` under `rosters-page`
and a new `mfl-weekly-results` domain.

## Deferred items

- [ ] **F1 — An SSR throw renders as a 404, not a 500**
  - Source: deferred at implementation (root-cause observation, step 1)
  - Where: `src/pages/404.astro`, and the Astro/Vercel error path that reaches
    it; reproduce with any page that throws in frontmatter
  - Why deferred: this is the part that made a P0 hard to see, but changing the
    error boundary is a behavior change across every route on the site — far
    too wide to land during an outage
  - Detail: in `astro dev` the same throw returns **500** with the stack. In
    production it returned **404** with our styled 404 page, no `x-vercel-error`
    header, and the real `TypeError` only visible in
    `mcp__Vercel__get_runtime_logs`. Anyone triaging from the browser alone
    would conclude the route had been deleted. Worth deciding whether a
    frontmatter throw should surface as a 500 page, and whether an SSR
    exception should page someone.

- [ ] **F2 — `processWeeklyScores` exists in three copies**
  - Source: cross-cutting lens, step 5
  - Where: `src/pages/theleague/rosters.astro:370`,
    `src/utils/weekly-scores.ts:19`, `src/utils/coach-data.ts:332`
  - Why deferred: collapsing them means editing the 12k-line `rosters.astro`
    to import a util, which needs a `roster-parity-check` cycle — not a diff
    to widen on a P0
  - Detail: `src/utils/weekly-scores.ts` has **no importers at all** (verified
    by grep). It is dead code carrying a live landmine — it had neither guard
    before this hotfix. Strongest option is to delete it and have
    `rosters.astro` import `coach-data.ts`'s copy, which is now the canonical
    one. `tests/weekly-results-matchup-guard.test.ts` pins all three today and
    should shrink to one file when they merge.

- [ ] **F3 — The pre-push full-suite gate silently did not run**
  - Source: deferred at implementation (noticed at step 4)
  - Where: `.claude/hooks/pre-push-check.sh` exists and is executable, but this
    cloud clone had no `.git/hooks/pre-push` and no `core.hooksPath`
  - Why deferred: infrastructure, not this outage
  - Detail: `git push` exited 0 with no test output. CLAUDE.md already warns
    the hook exits 0 silently when vitest is missing; this is a second silent
    mode — **the hook is not installed at all in a fresh clone**, which is
    exactly what a cloud session always is. The full suite was run manually
    instead and found one real failure (see Context). Worth installing the hook
    from the session-start hook, or having it fail loudly when absent.

- [ ] **F4 — Post-merge reviewer findings**
  - Source: Copilot / CodeQL, which land after the merge
  - Where: PR #1016 comments
  - Why deferred: `/hotfix` does not wait on external reviewers
  - Note: re-read the PR comments and fold anything real in here.

## Context to start cold

**The data, exactly.** `data/theleague/mfl-feeds/2026/weekly-results-raw.json`
is a 17-element array. Weeks 1-14 are `{ week, matchup: [...] }`. Weeks 15-17
are `{ week, franchise: [...] }` — 16 franchises, each with
`{ id, starters, nonstarters, player: [...] }`, and **the players carry `id` and
`status` but no `score`**. That last part is why skipping those weeks loses
nothing: `parseFloat(p.score)` was already `NaN`, so they never contributed to
the trend map. If a future change wants to read weeks 15-17, it has to handle
the franchise-at-week-level shape, not just stop crashing on it.

**What was ruled out.** The first three theories were all wrong and cost time:
the route being dropped from the build (the build log was clean, `Build
Completed in 2m`), a Vercel routing/rewrite problem (`vercel.json`'s
`/theleague/:path*` → `/:path*` redirect and `src/middleware.ts`'s host rewrite
both behave correctly), and a stale production deployment (the deploy was
`READY` and every sibling route was 200). The `/rosters` 404 is also recorded in
`docs/claude/insights/domains/deployment.md` under **2026-03-08**, where it was
written up as "custom domain routing may not be a reliable benchmark target" —
that entry is almost certainly this same crash, misdiagnosed as a routing
quirk, and could be corrected.

**What actually found it in one call:** `mcp__Vercel__get_runtime_logs` filtered
to the route. Production telemetry beat every amount of reading. Note that the
log line reads `GET /theleague/rosters 404 [error/serverless]` — a 404 *with* an
error payload attached, which is the tell that it is a throw and not a missing
route.

**Why `/rosters` looked intermittently fine.** Interleaved 200s in the same log
window were AFL requests (league `19621` in the log body); both leagues serve
this path. Do not read a mixed 200/404 stream as flakiness.

**Local repro.** `node_modules/.bin/astro dev --port 4399`, then
`curl -o /dev/null -w '%{http_code}' localhost:4399/theleague/rosters`. 500
before the fix, 200 after, and `node_modules/.bin/astro dev logs` carries the
identical stack trace to production. `node scripts/roster-parity-check.mjs`
needs that same server on 4399 and renders 12 franchise/season combinations.

**One real test failure came from the changelog entry, not the code.**
`tests/whats-new-data.test.ts` rejects an `area` that is not one of the rollup's
`AREA_LABELS` slugs; `"Roster/Salary"` is the page's display name and `rosters`
is the slug. Fixed in `addfeb2`. Worth knowing that the full suite is 400 files
/ 9,819 tests and takes ~88s.
