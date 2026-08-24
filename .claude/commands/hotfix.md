Ship a fix to production on the fast path: triage, minimal fix, fast review that
favors shipping over polish, merge, verify on prod — then automatically hand the
deferred improvements to `/followup` in a separate session.

**This is not `/live` with less patience.** `/live` is thorough because it can
afford to be. A hotfix inverts one variable — cost of delay — and everything
below follows from that. Use it only when production is broken for owners right
now.

## Why the shortcuts are safe

~228 guard suites in `tests/` are this repo's memory. Design tokens, league
literals, `leagueUrl`, whats-new schema, year rollover, curated-head size — all
mechanically enforced, all still enforced on this PR. So a hotfix skips *review
of anything a test already covers*, because CI covers it anyway.

What CI cannot catch is what review must stay pointed at, and only this:

1. Does the fix actually fix the reported failure?
2. Does it break something that currently works?
3. Did the **sibling league page** drift? TheLeague and AFL have near-identical
   pairs (`theleague/players.astro` / `afl-fantasy/players.astro`, both lineup
   pages, both draft predictors). A fix applied to one and not the other is a
   recurring bug class here and is invisible in a diff that touches only one.

That is the entire hotfix review. Everything else is deferrable **by design**,
not by corner-cutting — and only because step 8 actually collects it.

---

## Step 0: Triage gate

If the user didn't describe the breakage, ask what is broken in production and
wait. Then decide honestly whether this belongs on the fast path:

| Situation | Route |
|---|---|
| Site down, page erroring, auth broken | `/hotfix` |
| Wrong data on a live page **during games** | `/hotfix` |
| Security, data loss, or an owner seeing another owner's data | `/hotfix` |
| Broken, but there's a workaround | judgment — say which you picked and why |
| Small change you just want shipped | `/live` |
| Anything with a design or UX decision in it | `/feature` |

Gameday is a real deadline here. Live scoring or Set Lineup broken on a Sunday
is genuinely P0; the same bug in March is not. Say which severity you assigned
(P0 / P1) and why, in one line, before moving on.

**If it isn't a hotfix, say so and stop.** Suggest `/live`. The fast lane keeps
its shortcuts only as long as it stays rare — a `/hotfix` that didn't need to be
one spends the credibility that lets the next real one skip review.

---

## Step 1: Reproduce, then diagnose

Confirm the failure before editing anything — a repro, the error, the log line,
or the wrong value on the page. The dominant hotfix failure mode is fixing the
wrong thing under pressure and shipping twice.

**The fastest confirmation is production's own telemetry**, not clicking around.
The Vercel MCP reads a pre-aggregated table, so it answers "is this real, and how
wide" in one call:

- `get_runtime_errors` — error clusters, occurrence counts, affected routes.
  Write down the count and `last seen`; step 7 checks that they stopped moving.
- `get_runtime_logs` filtered to the route, for the actual message.

**"No logs found" is itself a diagnosis.** A platform 502 (HTML body, not your
JSON) with nothing in either tool is the signature of a hung `await` running into
`maxDuration` — not a throw, which is why `try/catch` didn't catch it. See
`docs/claude/insights/domains/deployment.md` (2026-07-07).

Then check whether a **revert** is the fix:

```bash
git log --oneline -20 main
git log --oneline -10 -- <the broken file>
```

If a specific commit caused this and `git revert <sha>` applies cleanly, that is
the fastest, lowest-risk, most reviewable hotfix available — take it. The real
fix becomes a normal `/feature` PR with no clock on it, and step 8 records it.

Forward-fix only when a revert isn't clean, would undo unrelated shipped work,
or the bug was never in a single commit.

---

## Step 2: Fix small

- **Branch from fresh `origin/main`**, never from the current worktree branch —
  otherwise the hotfix drags in-progress feature work to production:
  ```bash
  git fetch origin main
  git checkout -B hotfix/<slug> origin/main
  ```
- **Minimum viable diff.** One or two files. If the diff keeps growing, that is
  evidence this isn't a hotfix — stop and say so rather than pushing through.
- **A guard test comes with the fix.** Every rule in this repo is a bug that
  shipped; skipping the test is how it ships a second time. If the test takes
  under ~5 minutes, write it now. If not, ship without it and it becomes
  **follow-up item F1, always** — never a silent omission.
- **Check the sibling league page** before you finish (point 3 above).
- **Check the year clock** if anything date-shaped is involved:
  `getCurrentLeagueYear()` for roster/contract/cap, `getCurrentSeasonYear()` for
  standings/results/draft order.

---

## Step 3: Validate locally

**Preflight — make sure the suite can actually run.** A fresh clone or a cloud
session has no `node_modules`, and `.claude/hooks/pre-push-check.sh` **exits 0
silently** when vitest is missing: you lose the full-suite gate with nothing that
looks like a failure. `pnpm install` is ~17s against a warm registry, so there is
nothing to trade away here:

```bash
[ -x node_modules/.bin/vitest ] || pnpm install
```

Never fall back to "CI will catch it" because deps are missing. Push-and-wait
costs a build plus a CI cycle *per iteration*, and on a hotfix, iteration count ×
cycle time is outage length.

Fail fast on the affected suites, then let the pre-push hook confirm the rest:

```bash
pnpm vitest run <the suites your change touches>
```

Run `pnpm build` **only** if the change touches build-time code (`scripts/`,
`astro.config.ts`, prebuild, anything imported at build time).

Do **not** run `pnpm test:types` locally — it shells out to `astro check`, takes
~2.5 minutes and needs the big heap. CI's `Type baseline` job owns it and step 6
waits for it.

**Never bypass `.claude/hooks/pre-push-check.sh`.** It runs the full vitest suite
on every push. Under time pressure that hook is the thing standing between a
hurried fix and a second outage. It should be a confirmation, not a discovery —
which is what the targeted run above buys you.

---

## Step 4: Push and open the PR

Commit in the repo's style (conventional commit, imperative subject,
`Co-Authored-By` trailer), prefixed `hotfix:`. Skip the data-sync noise when
staging: `data/theleague/live-*`, `data/theleague/mfl-feeds/`,
`src/data/salary-history/`, `src/data/theleague/mfl-player-salaries-*`.

```bash
git push -u origin HEAD
gh label create hotfix --color B60205 --description "Fast-path production fix" 2>/dev/null || true
gh pr create --label hotfix --title "hotfix: <imperative subject>" --body "$(cat <<'EOF'
## What broke
<the user-visible symptom, and since when>

## The fix
<one or two sentences — what changed and why it addresses the symptom>

## Validation
- [ ] Reproduced the failure before the fix
- [ ] Confirmed the symptom is gone after the fix
- [ ] Guard test added (or deferred as F1 in the follow-up brief)
- [ ] Sibling league page checked

## Deferred to follow-up
<filled in at step 5 — the findings this PR is knowingly shipping past>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Add the changelog entry while CI starts — it is one JSON object and about ten
seconds, so dropping it buys nothing. Append to the `changes` array of
`src/data/weekly-changelog-staging.json` with `date`, `type: "bug-fix"`, a
user-facing `summary`, `impact`, `area`, and `league` (**mandatory** —
`theleague | afl | both`; the rollup exits 1 on an untagged change). Amend it
into the same commit or push it as a second one.

Skip `/update-whats-new` and `/update-insights` here — the insight belongs in
the follow-up session, where there's time to write it properly.

> In a cloud session without `gh`, use the GitHub MCP tools
> (`mcp__github__create_pull_request`, `mcp__github__pull_request_read`, …).
> Everything below works the same way through them.

---

## Step 5: Review, and adjudicate for shipping

Run `/code-review --comment` and cover the cross-cutting lens yourself (missed
call sites, half-applied refactors, the sibling page pair).

**Do not wait on the external advisory reviewers.** Gemini, Copilot and CodeQL
lag minutes and are best-effort even in `/live`. Merge on Claude's review plus
green CI; their findings land on the PR after the merge and become follow-up
items automatically at step 8.

**One exception: wait for CodeQL** if the fix touches auth, a server route that
handles user-supplied input, or anything that reaches
`validatePublicUrl` / `getAuthUser`. Security findings are in the blocking
bucket, so they have to arrive before the merge, not after it.

### The bar: cost of the bug vs. cost of the delay

`/live`'s rule is "confirmed Important → fix it in this PR." **That rule is
overridden here.** The question is not *is this finding valid* — it is *would
fixing it justify leaving production broken longer?*

**Blocks the merge** — only findings that mean the fix doesn't work or makes
things worse:
- doesn't actually address the reported failure
- introduces a **new** user-facing break or regression
- security, auth, or data-loss
- leaves the sibling league page inconsistent

**Deferred — valid, correctly identified, and shipping anyway:**
- naming, DRY, duplication, missing abstraction, "this should be refactored"
- design tokens, hydration directives, bundle size, perf
- test coverage beyond the guard test
- "this pattern exists elsewhere and should be shared"

The finding being *right* is not the question. That is the whole mechanic, and
it is legitimate **only** because step 8 always runs. A deferral that isn't
captured is just skipping review with extra steps.

**Rejected** — findings that are wrong. Same handling as `/live`: read the code
they point at, check whether a repo rule or guard test already answers them, and
record the rejection with its reason. Watch for knowledge-cutoff findings ("X
does not exist", "that version is invalid") — check them against reality before
they count for anything.

Print the adjudication, including a distinct third state for reviewers you
deliberately didn't wait for:

```
Hotfix Adjudication
──────────────────────────────────────────────────
Blocking      <none / finding>
Deferred      F1 <finding>  (Claude, src/foo.ts:120)
              F2 <finding>  (Copilot)
Rejected      <finding> — <why>
Reviewers     Claude ✓   CodeQL not waited on   Gemini not waited on
Decision      Shipping — 0 blocking, 2 deferred
```

`not waited on` is not `clean` and is not `did not run`. Never render a reviewer
you skipped as a pass — that is the exact failure `/live` was written to stop.

If something **is** blocking: fix it and re-run this step. Blocking findings are
the one thing that outranks the clock.

---

## Step 6: Merge on green

**Check the preview deployment before you merge.** It builds in parallel with CI,
so it costs no extra wall-clock, and it is a better test environment than local
dev — real env vars, real Redis, real MFL calls, none of which a fresh clone or
worktree has an `.env.local` for. Confirming the symptom is gone here means step 7
is confirming a deploy rather than discovering the fix doesn't hold under
production conditions.

Recover the preview hostname from the `Vercel Preview Comments` check run on the
head SHA, then read it with `mcp__Vercel__web_fetch_vercel_url` — preview
deployments are auth-protected and plain `curl` gets a 401.

Approve and enable auto-merge:

```bash
gh pr review <PR> --approve --body "Hotfix — reviewed by Claude Code. 0 blocking findings; improvements deferred to the follow-up brief. CI must pass before merge."
gh pr merge <PR> --auto --squash
```

**Both CI jobs must pass — including `Type baseline`. Loop until it finishes.**
It runs as its own ~2.5-minute job precisely so it never delays the unit-test
signal, so poll rather than assuming:

```bash
while true; do
  gh pr checks <PR> || true
  STATE=$(gh pr view <PR> --json state --jq .state)
  [ "$STATE" = "MERGED" ] && { echo "✓ merged"; break; }
  [ "$STATE" = "CLOSED" ] && { echo "closed without merging"; break; }
  sleep 20
done
```

The type baseline ratchets in **both** directions — it fails if the error total
rises *and* if it drops. A hotfix that deletes broken code legitimately lowers
the count; retightening `tests/fixtures/typecheck-baseline.json` is a mechanical
edit and belongs in this PR, not the follow-up. Treat `ts(2307) Cannot find
module` as blocking regardless: an `import type` from a missing module is erased
at build, so it has no runtime symptom while voiding every type in the file.

**Self-approval fallback.** GitHub blocks approving your own PR, so auto-merge
can sit `blocked` with every check green. Once `Tests`, `Type baseline` and
`Vercel` are all SUCCESS and no blocking finding is open:

```bash
gh pr merge <PR> --squash --admin
```

Never `--admin` with a failing check or an open blocking finding.

---

## Step 7: Verify on production

**Merged is not fixed.** This is the step hotfixes actually fail at, and the
reason this command exists rather than ending at `/live`.

1. Wait for the **production** Vercel deployment of the squash commit — not the
   preview build. Poll the deployment status for the merge SHA on `main`.
2. Hit the thing that was broken, on the real domain: `https://theleague.us/…`,
   `https://afl-fantasy.com/…`, or `https://mfl.football/…` for a path-only
   league. Build the URL with `leagueUrl(league, path)` semantics — never
   concatenate an origin and a path by hand.
3. Confirm the **original symptom** is gone. Not "the page loads" — the specific
   wrong value, error, or missing element from step 1. `www.theleague.us/` has
   returned 200 while `/rosters` returned 404 on the same deploy
   (`docs/claude/insights/domains/deployment.md`, 2026-03-08), so check the broken
   route, never the homepage.
4. Re-run `get_runtime_errors` from step 1 and confirm the cluster stopped
   climbing. "The page renders" and "the error stopped" are different claims — on
   a partial fix the first is true and the second isn't.

**Rollback trigger, armed.** If production is still broken, or worse, revert
immediately rather than forward-fixing a second time under pressure:

```bash
git revert <squash-sha> && git push origin main   # or: gh pr create for the revert
```

Then say plainly that the hotfix did not work and what you're doing next. A
second hurried fix on top of a failed one is how a 10-minute outage becomes an
hour.

---

## Step 8: Hand off to `/followup` — automatic, not optional

This step always runs, whether or not anything was deferred. The shortcuts in
step 5 were licensed by this step existing; skipping it retroactively makes them
corner-cutting.

**8a. Write the brief.** Create
`docs/claude/followups/<YYYY-MM-DD>-<slug>.md` using the schema in
`docs/claude/followups/README.md`. Every item needs enough to start **cold** —
the next session will not have the incident in its head:

- the finding, in its own words
- `file:line`
- which reviewer raised it (or "deferred at implementation")
- why it was deferred
- the hotfix PR URL and squash SHA

Always include, when they apply:
- **F1 — the guard test**, if step 2 shipped without one
- **the real fix**, if step 1 shipped a revert
- any external reviewer findings that landed on the PR after the merge — re-read
  the PR comments now and fold Gemini / Copilot / CodeQL in

Commit the brief on `main` (or as a tiny follow-on PR) so the debt is recorded
in the repo, not just in a session transcript.

**8b. Start the follow-up session.** Preferred — a genuinely separate session,
so the long-term fix never competes with the incident:

```
mcp__Claude_Code_Remote__create_session
  title:  "Follow-up: <slug>"
  prompt: "/followup docs/claude/followups/<YYYY-MM-DD>-<slug>.md"
```

If that tool isn't available in this environment, run `/followup <brief-path>`
directly instead — it branches off fresh `origin/main`, so it stays separated
from the hotfix either way. Never start it before step 7 passes: a parallel
session editing the same files while the hotfix is still deploying is a conflict
generator.

Tell the user which route you took and link the session or brief.

---

## Step 9: Report

```
Hotfix shipped
──────────────────────────────────────────────────
Broke         <symptom, since when>          P0
Fixed by      <revert of abc1234 / forward fix in src/foo.ts>
PR            <url>                          squash <sha>
CI            Tests ✓   Type baseline ✓   Vercel ✓
Production    verified — <what you checked, on which URL>
Deferred      3 items → docs/claude/followups/2026-08-24-<slug>.md
Follow-up     session started / run `/followup <path>`
Rejected      <finding> — <why>   (shipped unaddressed on my judgement)
```

List rejected findings explicitly. They shipped on your call, so the user gets a
last look at it.

---

## Auditing the fast lane

Periodically worth asking — and worth answering honestly when the user does:
how many hotfixes shipped, and how many of their briefs reached
`status: shipped`? If follow-ups don't get worked, this isn't a hotfix workflow,
it's a quality-skipping machine. `grep -l "^status: open" docs/claude/followups/*.md`
is the whole audit.
