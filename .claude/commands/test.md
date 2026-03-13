Push the current worktree branch to GitHub for a Vercel preview deployment, then extract and display the actual preview URL.

## Steps

1. **Check for uncommitted changes** — Run `git status -u` (never use `-uall`). If there are staged or unstaged changes relevant to the current feature, stage and commit them with a descriptive message following the repo's commit style. Skip unrelated data sync files (`data/theleague/live-*`, `data/theleague/mfl-feeds/`, `src/data/salary-history/`, `src/data/theleague/mfl-player-salaries-*`).

2. **Push the branch** — Run `git push -u origin <current-branch>`. If the branch already tracks a remote and is up to date, skip this step.

3. **Wait for Vercel deployment** — Sleep 15 seconds to let Vercel register the deployment, then poll for the preview URL.

4. **Extract the Vercel preview URL** — Use the GitHub API to find the actual preview hostname:
   ```bash
   COMMIT_SHA=$(git rev-parse HEAD)
   ```
   Then fetch the check runs via `WebFetch`:
   ```
   https://api.github.com/repos/braven112/mfl.football.v2/commits/{COMMIT_SHA}/check-runs
   ```
   Look for the `Vercel Preview Comments` check run. Its `output.summary` contains a `vercel.live/open-feedback/{hostname}` link. Extract the `{hostname}` — that's the preview deployment URL.

   If the check run isn't available yet, retry once after 15 more seconds.

5. **Output the preview link** — Print the URL as a clickable markdown link. Include both the base URL and a direct link to TheLeague homepage with team context:
   ```
   **Preview deployed:**
   → [https://{hostname}/theleague?myteam=0001](https://{hostname}/theleague?myteam=0001)
   ```

## Notes

- Stay on the worktree branch for continued development — do NOT merge to main.
- This triggers a Vercel preview deployment without touching main.
- Preview deployments may be behind Vercel's preview protection (login required).
- The hostname pattern is typically: `mflfootballv2-git-{branch-slug}-brandons-projects-90cd4041.vercel.app`
