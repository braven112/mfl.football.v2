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

## Step 1: Preflight

```bash
git fetch origin main staging
git status --short          # must be clean
```

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

Then tag it, so the week is addressable — for a bisect, a rollback, or an
answer to "what shipped that Tuesday?":

```bash
git tag -a "v$(date +%Y.%m.%d)" -m "Release $(date +%Y-%m-%d)"
git push origin "v$(date +%Y.%m.%d)"
```

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

## Step 8: Announce — automatic now, but verify it

**Step 6's tag is what publishes the article.** `weekly-changelog-rollup.yml`
fires on `push: tags: ['v*']`, so the release's What's New article and its
`site-update` notification go out on the back of the tag you just pushed. You do
not dispatch anything.

What to verify, because it is a cron-shaped job and nobody watches those:

- The run exists and is green. It publishes ONE article per league covering the
  whole week, then empties the staging queue.
- It waited for the permalink. `scripts/wait-for-whats-new-live.mjs` polls the
  article's real URL before the notification goes out and prints a `::warning::`
  if it gave up — that warning means owners may have been notified a minute
  before the page resolved, not that anything is broken.
- If a Monday cron already published this week's article, the tag-triggered run
  finds the id taken and stands down, PRESERVING the queue. That should not
  happen — `scripts/changelog-rollup-gate.mjs` makes the cron yield whenever a
  release is pending — but if it does, the release's entries roll to the next
  run rather than being lost.

## Step 9: Report

State, in this order: what shipped (the commit range and the features),
the tag, that production is up and verified, anything the blackout or review
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
