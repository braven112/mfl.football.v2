---
slug: roster-page-unpaired-week-404
status: shipped
severity: P0
opened: 2026-09-08
shipped: 2026-09-08
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1016
hotfix_sha: b04d8d04d5351749d6fdedefa6a5dce65e34c58f
followup_issue: https://github.com/braven112/mfl.football.v2/issues/1017
followup_pr: PLACEHOLDER_FOLLOWUP_PR
followup_session: https://claude.ai/code/session_01BtjyWxbxBjnznjKBG35KkH
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

- [x] **F1 — An SSR throw renders as a 404, not a 500**
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
  - **Verdict: STILL TRUE — and not the wide behavior change it looked like.**
    Astro resolves its error page by EXACT route
    (`astro/dist/core/routing/match.js`): `matchRoute('/500', …)` first looks
    for a route whose path IS `/500`, and only on a miss falls through to a
    generic pattern match. There was no `src/pages/500.astro`, so the
    fall-through hit `[...path].astro` — the shared-host router added in July
    2026 — which pins `Astro.response.status = 404`. Astro returns that page's
    own status. The "error boundary across every route" the hotfix was right
    not to touch turned out to be one missing file.
  - **Fixed:** added `src/pages/500.astro` — Schefter-voiced, mirroring
    `404.astro`, with the league-aware home CTA plus a retry link guarded
    against a protocol-relative `//host` pathname. Server-rendered, so Astro's
    handler hands it the error in `Astro.props.error`, and it emits one
    greppable line — `[ssr-500] GET <path> — <stack>` — making the next outage
    a single filtered `get_runtime_logs` query rather than an afternoon. The
    stack is never rendered into the response body.
  - **Paging on an SSR exception: deliberately NOT built.** No alerting
    mechanism exists in the repo, and a naive one would fire on every bot crawl
    of a bad route. The log line is the cheap 90%; real paging is its own
    `/feature`, not a follow-up line item.
  - **Guard:** `tests/ssr-error-page-status.test.ts` (7 tests), wired into
    `.claude/hooks/path-guard.json` under a new `error-pages` domain. Verified
    to FAIL when `500.astro` is deleted — the only way this regresses, since
    nothing else about the site breaks without it.
  - **Rule:** `docs/claude/rules/error-pages.md` + the `CLAUDE.md` router row.

- [x] **F2 — `processWeeklyScores` exists in three copies**
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
  - **Verdict: STILL TRUE, with one correction to this brief.** "No importers
    at all" was true when written but not by the time it was worked:
    `tests/weekly-results-matchup-guard.test.ts` imported it (line 6). It was
    *test-only* dead code — the guard test was the only thing keeping it alive.
  - **Fixed:** deleted `src/utils/weekly-scores.ts` outright (its other three
    exports — `calculateTrendWeeks`, `getPlayerTrendScores`,
    `getPlayerAverageScore` — had no importers either) and pointed
    `rosters.astro` at `coach-data.ts`'s canonical copy instead of its own
    45-line inline one. One implementation now, three consumers.
  - **Guard:** the test shrank from three pinned files to one and GREW an
    anti-drift check — every consumer (`theleague/rosters.astro`,
    `theleague/lineup.astro`, `afl-fantasy/lineup.astro`) must IMPORT
    `processWeeklyScores` and must not declare its own. Both halves verified
    to fail against the pre-fix `rosters.astro`. Pinning the guards *inside*
    the function was never enough: the defect shipped because a copy DRIFTED,
    so the shape is what gets pinned now.
  - **Verified:** `scripts/roster-parity-check.mjs` before and after —
    `PARITY: 12 (season, team) renders identical`, config payload 1.03MB →
    1.03MB, dev server serving `/theleague/rosters` at 200. Type baseline
    retightened 1743 → 1738.

- [x] **F3 — The pre-push full-suite gate silently did not run**
  - Source: deferred at implementation (noticed at step 4)
  - Where: `.claude/hooks/pre-push-check.sh`
  - Why deferred: infrastructure, not this outage
  - Detail: `git push` exited 0 with no test output. CLAUDE.md already warns
    the hook exits 0 silently when vitest is missing; this is a second silent
    mode — **the hook is not installed at all in a fresh clone**, which is
    exactly what a cloud session always is. The full suite was run manually
    instead and found one real failure (see Context). Worth installing the hook
    from the session-start hook, or having it fail loudly when absent.
  - **CORRECTION — this brief misdiagnosed it, and the evidence it cited was a
    red herring.** `.claude/hooks/pre-push-check.sh` is a **Claude Code
    PreToolUse hook**, wired in `.claude/settings.json` with matcher `Bash`,
    which reads the tool payload from stdin. It is NOT a git hook and never
    lives at `.git/hooks/pre-push`, so "no `.git/hooks/pre-push` and no
    `core.hooksPath`" is expected, irrelevant, and not the cause — and the
    proposed fix (install it from the session-start hook) aimed at the wrong
    mechanism entirely. `jq` was present too.
  - **Real cause:** a fresh cloud clone has no `node_modules` at all, so
    `node_modules/.bin/vitest` was missing and the hook took its `exit 0` path,
    warning on stderr and allowing the push.
  - **A SECOND, worse bug, found while fixing it.** In Claude Code hooks only
    **exit 2** blocks a tool call; every other non-zero code is a *non-blocking*
    error. The hook ended `vitest run || exit 1` — so even when the suite ran
    and FAILED, the push went through. Its headline promise ("Blocks the push
    if tests fail so broken code never leaves the machine") had never been true.
  - **A THIRD, found by being bitten by it.** The trigger was
    `case "$bash_command" in *<the phrase>*`, a substring match on the whole
    payload — so any command that merely MENTIONED it fired the gate, including
    the heredoc writing this very brief. Harmless while the gate exited 0
    silently; a blocked command and a wasted full suite run once it blocks.
  - **Fixed:**
    1. Fails closed — a missing vitest **blocks** (exit 2) with instructions,
       and a failing suite blocks (exit 2) instead of exit 1.
    2. `SKIP_PRE_PUSH_TESTS=1` is the deliberate, visible escape hatch, and is
       read from the **command text**, not only the environment: hooks are
       spawned by Claude Code rather than by the shell running the command, so
       an inline `VAR=1 <cmd>` never reaches the hook process. That is what
       makes the hatch usable from inside a session at all, and it is how
       CLAUDE.md's "pre-existing failures are OK" policy is honored without the
       gate being silently off.
    3. Detection is anchored to a real invocation (line start or after a shell
       separator), not a substring of the payload.
    4. Falls back to `node` when `jq` is absent, so one missing tool no longer
       ungates the push. Only "neither jq nor node" still exits 0 — blocking
       every Bash call over a missing parser is worse than the gap.
    5. New `.claude/hooks/session-start.sh` (a `SessionStart` hook) installs
       dependencies when `node_modules/.bin/vitest` is absent, so cloud sessions
       have a working gate at all. This also closes the ONE silent-skip case
       CLAUDE.md documents for the `path-guard` edit hook — both mechanical
       memories were off in exactly the same sessions.
    6. PreToolUse timeout 120s → 300s. The suite is ~88s; a gate that times out
       is one more way for it not to run.
  - **Verified** against synthetic payloads across seven cases: a plain
    command, prose merely mentioning the phrase, and `git status` all skip; a
    real invocation, one after `&&`, and one at the start of a script line all
    block; the escape hatch skips. Removing vitest blocks; shadowing `jq` still
    blocks through the node fallback.

- [x] **F4 — Post-merge reviewer findings**
  - Source: Copilot / CodeQL, which land after the merge
  - Where: PR #1016 comments
  - Why deferred: `/hotfix` does not wait on external reviewers
  - **Verdict: nothing to work — closed empty, not deferred.** Read via the
    GitHub API this session. Copilot posted one **Approval recommended** review
    with **0 comments generated** (6/6 files, "Lite" effort). There are **zero**
    review threads on the PR. CodeQL and Analyze both completed green. The only
    two issue comments are the Vercel deploy bot and the hotfix's own "shipped
    and verified" note. Nothing arrived late.

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


## Follow-up outcome (2026-09-08)

All four items worked; none dropped. Route: **direct**, not `/feature`. F1 was
flagged architectural in this brief, and would have been if it really meant
redesigning the error boundary — tracing it to `matchRoute` in Astro's own
source showed it was one absent route file, so the design gate had nothing to
decide. F2 was a delete plus an import swap, verified by the parity harness the
brief asked for.

Two things this follow-up found that the brief did not know:

1. **The `[ssr-500]` log line is the durable half of F1.** The 500 page makes
   the status honest, but what actually shortens the *next* outage is a fixed
   prefix in the runtime logs. Production telemetry beat every amount of
   reading on 2026-09-08 and would again.
2. **F3 was three bugs, not one**, and the two the brief did not see were worse
   than the one it did: a gate that exited 1 on failure never blocked anything,
   and a substring trigger fired on any command that mentioned the phrase. The
   silent no-op the brief identified was the least of them.

Also corrected: the **2026-03-08** entry in
`docs/claude/insights/domains/deployment.md`, which recorded this same
`/rosters` 404 as a custom-domain routing quirk. It was this crash, six months
earlier.
