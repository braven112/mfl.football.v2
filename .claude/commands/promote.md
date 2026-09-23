Cut the weekly release: verify `staging` is promotable, then fast-forward `main`
to it and confirm production came up. This is the only way features reach
production — `/live` ships them to `staging`, `/promote` ships `staging` to the
world.

Run it Tuesday morning PT, after `/release-review` has returned a GO.

## The one-line version

Every check below exists to protect a single command:

```bash
git checkout main && git merge --ff-only origin/staging && git push origin main
```

`--ff-only` is the load-bearing flag. It **fails rather than inventing a merge
commit**, which is exactly right: if `main` cannot fast-forward to `staging`,
then `staging` does not contain `main`, merge-down is broken, and the release
must stop rather than be resolved on release day. Never replace it with a plain
`merge`, and never `--no-ff`.

---

## Step 0: Is merge-down healthy? (ask this FIRST)

Before any local git. The Step 2 fast-forward is an EFFECT;
`.github/workflows/staging-merge-down.yml` is the cause. If that job is
failing, `staging` cannot contain `main` and the promotion is already dead —
discovering it three steps later off a local clone just spends time reaching
the same answer, and a shallow clone will lie to you about *why* (Step 1).

```bash
gh api "repos/braven112/mfl.football.v2/actions/workflows/staging-merge-down.yml/runs?per_page=5" \
  --jq '.workflow_runs[] | "\(.created_at)\t\(.conclusion // .status)\t\(.head_sha[0:10])"'
```

No `gh` in the session (Claude Code on the web has none) — use the GitHub MCP
tools instead: `actions_list` with `list_workflow_runs`, then `get_job_logs`
with `failed_only` for the reason.

A `failure` on the most recent run means **STOP and fix that job** — resolve
the conflict it names on a branch and push to `staging`, per Step 2. Every
cron push to `main` retries it, so a broken merge-down shows up as a wall of
identical failures, not one: ten runs in the 2.5 hours before the 2026-09-17
attempt, each triggered by a routine sync commit.

## Step 1: Preflight

```bash
git fetch origin main staging
git status --short          # must be clean
```

**Check the clone is not shallow before trusting any ancestry check.**

```bash
git rev-parse --is-shallow-repository    # must print false
```

A shallow clone — a CI checkout, or a fresh agent session — fabricates a root
commit at the graft boundary. `git merge-base` then reports NO common ancestor
and the left/right divergence counts are nonsense. Read literally, that is
indistinguishable from `main` having been force-pushed and its history
destroyed, which is how a routine "merge-down is behind" became a 20-minute
incident investigation on 2026-09-17. If it prints `true`, deepen until a
merge base exists and only then run Step 2:

```bash
git fetch --deepen=250 origin main staging
git merge-base origin/main origin/staging    # must print a sha
```

Prefer `--deepen` over `--unshallow`: this repo's `.git` is 3.3 GB at depth 50
and the session disk allowance is finite.

**If `staging` does not exist**, stop and say so. The release train is not set
up; `docs/plans/staging-release-process.md` has the build order.

Establish what is shipping, and print it — the person running this should see
the release before it happens, not after:

```bash
git log origin/main..origin/staging --oneline
git diff --stat origin/main...origin/staging
```

If the range is empty, there is nothing to promote. Say so and stop — a release
with no changes still costs a production build.

## Step 2: The fast-forward check

```bash
git merge-base --is-ancestor origin/main origin/staging && echo "fast-forward OK"
```

**If this fails, STOP.** `staging` does not contain `main`, so the promotion
would be a real merge — a week of drift resolved on the one day you least want
surprises. Do not resolve it here.

The cause is almost always that `.github/workflows/staging-merge-down.yml`
failed, and its failure is the thing to fix: check its recent runs, resolve the
conflict it reported on a branch, push to `staging`, then re-run this step. The
merge-down job is what makes every promotion a fast-forward; a manual merge
here would paper over a broken one.

## Step 3: Blackout windows

```bash
node scripts/release-blackout.mjs
```

**It evaluates the PT clock, not your shell's — read the day it prints.** A
session running in UTC is a day ahead from 5pm PT on, so `date` saying Friday
while the script says `Thursday … DO NOT PROMOTE` is the script being right and
the shell being in the wrong zone. Print both before you argue with it:

```bash
date -u; TZ=America/Los_Angeles date
```

Exit 0 is clear; exit 1 prints every applicable reason. It covers, in PT:

- **NFL game days in season** — the routine Thu/Sat/Sun/Mon, *plus whatever day
  the real schedule opens a week on*. That second half is not decoration: 2026's
  week 1 is a Wednesday and so is week 12, and a fixed weekday list called both
  of them clear. The season year is resolved on the Labor Day clock first, so a
  January week-18 Sunday is still in season.
- **Each league's MFL league-year rollover** ±1 day, read from the registry —
  Feb 14 for TheLeague, June 1 for the AFL and Best Ball.
- **Labor Day through Labor Day + 3**, the season-year rollover.
- **The AFL National League draft** ±1 day, derived per year.

**One gap it cannot check.** TheLeague's own draft date lives in the
league-events registry rather than an `.mjs` this script can import, so it is
not mechanical. If TheLeague's draft is within a day, hold the release —
`/promote` will not stop you.

If the script reports that it *could not evaluate* a rule, that is a blackout,
not a pass. A safety check that failed to run has told you nothing.

A blackout is not a veto you route around; it is a reason to ship Wednesday
instead. Overriding one is the user's call, made explicitly, never yours.

## Step 4: CI is green on staging's tip

Pin the query to the **exact SHA** you are about to promote. Listing recent
runs by branch is not the same check — a green run from an older commit reads
as sufficient while the tip itself has never been built, which is precisely the
state a merge-down commit creates.

```bash
SHA=$(git rev-parse origin/staging)
gh api "repos/braven112/mfl.football.v2/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "-")"'
```

Three failure modes, all of which stop the promotion:

- **Any conclusion other than `success`** (or `neutral`/`skipped` for a check
  that legitimately does not apply) — red CI on `staging` is a bug already live
  on `staging.theleague.us`, and promoting makes it live everywhere.
- **Any check still `in_progress` or `queued`** — that means wait, not proceed.
- **No check runs at all for this SHA** — treat as blocking, not as a pass.
  `ci.yml` runs on pushes to `staging` precisely so the tip always has one; an
  empty result means that job did not fire and the tip is untested.

`Tests` and `Type baseline` are the two that must be green. CodeQL runs on PRs
into `staging` rather than on the tip — deliberately, and `codeql.yml` explains
why — so its absence here is expected, not a gap.

## Step 5: The `/release-review` GO

The promotion does not run without one. If `/release-review` has not been run
against this range, run it now — it is the gate, not a formality.

A **NO-GO** stops the release. Two legitimate ways forward, both the user's
call: fix the blocking item and re-run the review, or pull the offending
feature off `staging` and promote the rest. Never promote past a NO-GO.

Filing a follow-up is a GO, not a deferred NO-GO — the review's own rule.

## Step 5b: Capture the visual diffs BEFORE the fast-forward

Chromatic's PR trigger is scoped to `branches: [main]`, and this command
fast-forwards with a direct push — so **no pull request into `main` is ever
created, and nothing here would trigger a capture.** The `push` to `main` that
follows runs with `--auto-accept-changes`, which would then bless the week's
visual changes as the new baseline with nobody having looked: the exact
"visual test that certifies the bug" failure `chromatic.yml`'s own comments
exist to prevent.

So capture on `staging`'s tip, explicitly, before promoting:

```bash
gh workflow run chromatic.yml --ref staging
```

Dispatched on `staging` rather than `main`, the workflow runs plain
`chromatic` — diffs land **pending** for a human to accept or reject in the
Chromatic UI, which is the review this whole placement is for. Wait for it,
review the diffs, and only promote once they are accepted. The subsequent
`--auto-accept-changes` on `main` is then blessing snapshots that were already
reviewed, which is what makes it safe.

Skip this only when the range touches nothing in the story import closure
(`chromatic.yml` lists it) — then there is nothing to capture.

## Step 6: Promote

```bash
git checkout main
git merge --ff-only origin/staging
git push origin main
```

**Do not tag.** The release used to be tagged `vYYYY.MM.DD`, and the tag push
was what published the week's article. Agent sessions cannot push tags (HTTP
403 on 2026-09-18 and again on 2026-09-22, when branch pushes from the same
credentials succeeded), so that step failed both times and both weeks' articles
went unpublished. Step 8 now dispatches the rollup directly. The release stays
addressable through its record: Step 9 writes the exact commit range into
`docs/claude/releases/`, which answers "what shipped that Tuesday?" just as a
tag would.

Return to the branch you were on. Do not leave the checkout sitting on `main`.

## Step 7: Confirm production actually came up

A push is not a release. Watch the production deployment to completion and
then check the site itself — at minimum a page load on each league's apex host,
signed out.

If it fails, **roll back by promoting the previous production deployment in
Vercel** — seconds, and no prebuild re-run — and only then revert on the
branch. That order matters: the revert rebuilds, the promote does not.

What a rollback does **not** undo, and must be checked by hand if the release
touched any of it: Redis writes (expand/contract is what makes them
survivable), MFL writes, notifications already sent, and data files a cron has
since rewritten.

## Step 8: Announce — dispatch the rollup, then verify it

Dispatch `weekly-changelog-rollup.yml` on `main` once Step 7 has confirmed
production is up — never before, or the article can land ahead of the code it
describes:

```bash
gh workflow run weekly-changelog-rollup.yml --ref main
```

No `gh` in the session: use the GitHub MCP `actions_run_trigger` with
`run_workflow`, `workflow_id: weekly-changelog-rollup.yml`, `ref: main`. A 403
("Resource not accessible by integration") means the Claude GitHub App lacks
**Actions: write**. Say so and ask the user to grant it; do not route around it.

A dispatched run publishes exactly as a tag push would: `changelog-rollup-gate.mjs`
gates only SCHEDULED runs, so a `workflow_dispatch` always publishes. It reads
`main`'s staging queue, which Step 6 just brought in. (The workflow still
accepts a `v*` tag push, so a human who tags by hand gets the same result.
Don't do both, because the second run finds the id taken and stands down.)

What to verify, because it is a cron-shaped job and nobody watches those:

- The run exists and is green. It publishes ONE article per league covering the
  whole week, then empties the staging queue.
- It waited for the permalink. `scripts/wait-for-whats-new-live.mjs` polls the
  article's real URL before the notification goes out and prints a `::warning::`
  if it gave up — that warning means owners may have been notified a minute
  before the page resolved, not that anything is broken.
- If a Monday cron already published this week's article, the dispatched run
  finds the id taken and stands down, PRESERVING the queue. That should not
  happen — `scripts/changelog-rollup-gate.mjs` makes the cron yield whenever a
  release is pending — but if it does, the release's entries roll to the next
  run rather than being lost.

## Step 9: Report

State, in this order: what shipped (the commit range and the features),
that production is up and verified, the rollup run and the article it
published, anything the blackout or review
flagged and how it was resolved, and anything deliberately left on `staging`.

Then record the release in
`docs/claude/releases/YYYY-MM-DD-release-review.md` alongside the review — one
file per week is what makes a later "what went out and what did we defer?"
answerable in a minute.

---

## Never

- Never `--no-ff` or a plain `merge`. A fast-forward that fails is information.
- Never promote past a red CI, a NO-GO, or an unexplained blackout.
- Never force-push `main`.
- Never resolve a merge-down conflict inside this command — fix the job.
- Never skip step 7. A release nobody looked at is a release nobody knows
  failed.
- Never skip step 5b on a diff that renders. A direct push to `main` is the one
  path where `--auto-accept-changes` can bless an unreviewed visual change.
