---
name: rebase
description: Rebase the current branch onto origin/main and resolve conflicts by class, autonomously, the way CLAUDE.md "Merge conflicts — always rebase, resolve autonomously" prescribes — with the ours/theirs flip under rebase handled correctly, the lock regenerated, and both ratchet baselines re-measured. Use when a PR shows a merge conflict, when main has moved under a branch, or before /live on a long-lived branch. Trigger on /rebase, "rebase onto main", "resolve the conflicts", "branch is behind main".
---

# /rebase — onto origin/main, resolved by class

Only Brandon and Claude commit here, so conflicts are resolved without asking.
The classes and their rules are CLAUDE.md's; this skill is the order of
operations plus the two mechanical helpers that remove the judgment from the
mechanical classes.

**The side trap, first:** under a rebase, `--ours` is MAIN and `--theirs` is
your branch commit (the reverse of a merge). `scripts/resolve-rebase-conflicts.mjs`
picks the correct side for you; if you resolve by hand, take MAIN with
`git checkout --ours -- <file>`.

## Procedure

1. **Prepare.**
   ```bash
   git config rerere.enabled true        # a fresh clone does not carry it
   git fetch origin main
   git status --short                    # must be clean; stash or commit first
   node scripts/ratchet.mjs --skip-types # note the pre-rebase fork state
   ```
   Record the pre-rebase unit-test baseline: `pnpm test:unit 2>&1 | tail -5`.

2. **Rebase.** `git rebase origin/main`. If it completes clean, go to step 5.

3. **On each stop, run the resolver, then finish the manual files.**
   ```bash
   node scripts/resolve-rebase-conflicts.mjs
   ```
   It takes main's copy of generated data and ratchet baselines, regenerates
   the lock once package.json is clean, and prints every remaining file with
   its CLAUDE.md rule. Resolve those by hand:
   - `package.json` → union; same key twice → the newer version spec.
   - `docs/`, `CLAUDE.md` → additive; both sides' sections survive.
   - `src/`, `scripts/`, `tests/` → integrate the intent: keep main's
     structural change, re-apply the branch's behavioral change on top.
   Then `git add` each and `git rebase --continue`. Repeat until done.
   Never `git rebase --skip` a commit to get past a conflict.

4. **Re-measure the ratchets** (mandatory even if no baseline conflicted —
   main's number moved, so yours is stale either way):
   ```bash
   node scripts/ratchet.mjs --write      # runs astro check, ~2.5 min
   ```
   If it reports a RISE, that is a real regression the rebase surfaced: fix
   it, do not raise the baseline. Commit the fixture change:
   `git commit -am "Re-measure ratchet baselines after rebase"`.

5. **Validate before pushing.**
   ```bash
   pnpm test:unit                        # same failures as pre-rebase, or fewer
   git diff --name-only origin/main -- '*.mjs' | xargs -r node --check
   ```

6. **Push.** `git push --force-with-lease` — never plain `--force`.

7. **Report**: how many commits replayed, which files conflicted in which
   class and how each was resolved, the two ratchet numbers before/after, and
   the test baseline before/after.

## Don'ts

- Don't merge main into the branch. Rebase only.
- Don't hand-edit `pnpm-lock.yaml` or any generated feed file, ever.
- Don't keep either side's ratchet baseline number — re-measure.
- Don't turn `rerere` off.
