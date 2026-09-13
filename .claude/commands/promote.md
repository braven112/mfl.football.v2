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

Exit 0 is clear; exit 1 prints the reason. It covers, in PT: NFL game days in
season (Thu/Sat/Sun/Mon), the Feb 14 MFL league-year rollover ±1 day, Labor Day
through Labor Day + 3, and the AFL National League draft ±1 day.

**One gap it cannot check.** TheLeague's own draft date lives in the
league-events registry rather than an `.mjs` this script can import, so it is
not mechanical. If TheLeague's draft is within a day, hold the release —
`/promote` will not stop you.

A blackout is not a veto you route around; it is a reason to ship Wednesday
instead. Overriding one is the user's call, made explicitly, never yours.

## Step 4: CI is green on staging's tip

```bash
gh run list --branch staging --limit 5 \
  --json conclusion,name,headSha,status
```

Every required check must be **green on `staging`'s current head SHA**, not on
an older commit. A run that is still in progress means wait, not proceed.

Red CI on `staging` blocks the promotion outright. `staging` is a
production-level branch — if its tip is broken, that is a bug already live on
`staging.theleague.us`, and promoting it makes it live everywhere.

## Step 5: The `/release-review` GO

The promotion does not run without one. If `/release-review` has not been run
against this range, run it now — it is the gate, not a formality.

A **NO-GO** stops the release. Two legitimate ways forward, both the user's
call: fix the blocking item and re-run the review, or pull the offending
feature off `staging` and promote the rest. Never promote past a NO-GO.

Filing a follow-up is a GO, not a deferred NO-GO — the review's own rule.

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

## Step 8: Announce

The What's New rollup publishes the week's article. Confirm it ran **after**
the promotion, not before — an article that lands first tells owners to go look
at a feature that is not there yet, and pushes a `site-update` notification
saying so.

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
