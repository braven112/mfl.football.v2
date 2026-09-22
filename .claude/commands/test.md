Push the current worktree branch to GitHub for a Vercel preview deployment, then extract and display the actual preview URL.

## Steps

1. **Check for uncommitted changes** — Run `git status -u` (never use `-uall`). If there are staged or unstaged changes relevant to the current feature, stage and commit them with a descriptive message following the repo's commit style. Skip unrelated data sync files (`data/theleague/live-*`, `data/theleague/mfl-feeds/`, `src/data/salary-history/`, `src/data/theleague/mfl-player-salaries-*`).

2. **Open the PR — do this yourself, and do it BEFORE the push.**

   **A branch with no open PR does not build.** `vercel.json`'s `ignoreCommand`
   (`scripts/vercel-ignore-build.mjs`) cancels preview builds for branches that
   have no PR, because preview builds from work-in-progress pushes were the bulk
   of a build bill that ran 91% of Vercel spend. The deployment appears as
   `CANCELED` and **no preview URL is ever produced**, so step 5 would poll
   forever against a deployment that was never built.

   **Invoking `/test` IS the request for a PR.** A preview is the whole point of
   this command and a PR is the only way to get one, so open it without asking
   and without offering the alternative. This standing authorization is scoped
   to `/test` on the current worktree branch — it does not extend to any other
   branch, to merging, or to any other command.

   - Check first: `mcp__github__list_pull_requests` with `head: braven112:<branch>`
     and `state: open`. If one is already open, reuse it — never open a second.
   - Otherwise `mcp__github__create_pull_request` against the repo's default
     base, titled from the branch's work, body summarising the diff. Mirror
     `.github/pull_request_template.md` if it exists. Mark it draft unless the
     work is actually up for review — a preview build does not need a review-ready
     PR, and a draft still builds.
   - `FORCE_PREVIEW_BUILD=1` in the Vercel project's environment is the escape
     hatch for a preview with no PR. Only reach for it if PR creation is refused
     or fails; mention it then, not before.

   **ORDER MATTERS: open the PR BEFORE the push, not after.** The ignore
   command runs within seconds of the push and asks GitHub, right then,
   whether an open PR exists — so push-then-open-PR loses the race and
   cancels the build even though the PR is open moments later. Vercel still
   stamps the deployment with the PR id afterwards, which makes the record
   look like it should have built. It did not: read the build log, not the
   metadata. Recovering costs a second push, because a cancelled build is
   never resumed. (Observed 2026-09-07 on PR #1006: `[ignore-build] SKIP` at
   16:00:43, PR opened at 16:00:5x.)

   **The branch is already pushed with no PR** — the one case the ordering rule
   cannot fix, because the race is already lost on the commit that is up there.
   Open the PR, then land a **real** commit to trigger a fresh build. Never an
   empty commit, never a close-and-reopen: find something the branch genuinely
   still needs. If there is honestly nothing, say so and use
   `FORCE_PREVIEW_BUILD=1` rather than manufacturing a commit.

3. **Push the branch** — Run `git push -u origin <current-branch>`. If the branch already tracks a remote and is up to date, skip this step.

   If step 5 finds a `CANCELED` deployment, do not retry the poll — check the
   build log for `[ignore-build] SKIP`. That line means the PR was not open when
   the push landed, so the fix is another real commit, not more waiting.

4. **Wait for Vercel deployment** — Sleep 15 seconds to let Vercel register the deployment, then poll for the preview URL.

5. **Extract the Vercel preview URL** — Use the GitHub API to find the actual preview hostname:
   ```bash
   COMMIT_SHA=$(git rev-parse HEAD)
   ```
   Then fetch the check runs via `WebFetch`:
   ```
   https://api.github.com/repos/braven112/mfl.football.v2/commits/{COMMIT_SHA}/check-runs
   ```
   Look for the `Vercel Preview Comments` check run. Its `output.summary` contains a `vercel.live/open-feedback/{hostname}` link. Extract the `{hostname}` — that's the preview deployment URL.

   If the check run isn't available yet, retry once after 15 more seconds.

6. **Output the preview link** — Print the URL as a clickable markdown link, and the PR link alongside it. Include both the base URL and a direct link to TheLeague homepage with team context:
   ```
   **Preview deployed:** (PR #{number})
   → [https://{hostname}/theleague?myteam=0001](https://{hostname}/theleague?myteam=0001)
   ```

## Notes

- Stay on the worktree branch for continued development — do NOT merge to main.
- This triggers a Vercel preview deployment without touching main.
- Preview deployments may be behind Vercel's preview protection (login required).
- The hostname pattern is typically: `mflfootballv2-git-{branch-slug}-brandons-projects-90cd4041.vercel.app`
