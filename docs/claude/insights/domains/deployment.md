## 2026-03-08 - Vercel Preview Hostnames Can Be Recovered From GitHub Check Metadata

**Context:** Pushing `codex/roster-performance-refactor` and trying to benchmark the branch's Vercel preview deployment against the live site.

**Insight:** When Vercel's commit status only exposes a dashboard URL, the actual preview hostname can still be recovered from GitHub check metadata. In this repo, the `Vercel Preview Comments` check output included a `vercel.live/open-feedback/...` link whose hostname matched the preview deployment. That let us derive the preview URL even without local Vercel CLI auth.

**Evidence:** For commit `1b8f59cd12ac464da46321045e83be6977b25382`, `GET /repos/braven112/mfl.football.v2/commits/{sha}/check-runs` returned a check whose summary linked to `https://vercel.live/open-feedback/mflfootballv2-git-codex-roste-cd5785-brandons-projects-90cd4041.vercel.app?...`. Hitting that hostname directly returned `401`, confirming the deployment existed but was preview-protected.

**Recommendation:** If future work needs a branch preview URL and only the GitHub-side integrations are available:
1. Query the commit status for the Vercel dashboard link.
2. Query the commit check runs and inspect `Vercel Preview Comments` output for the preview hostname.
3. Expect preview protection to block automated benchmarking unless preview auth/bypass is available.

## 2026-03-08 - Custom Domain Routing May Not Be A Reliable Performance Benchmark Target

**Context:** Attempting a branch-preview-versus-live Lighthouse comparison for the roster page.

**Insight:** The public custom domain can be healthy at `/` while still failing on the route you want to benchmark. During this comparison attempt, `https://www.theleague.us/` returned `200`, but `https://www.theleague.us/rosters` and related variants returned `404`, even though the homepage HTML linked to `/rosters`.

**Evidence:** `curl -I https://www.theleague.us/` returned `200`, while `curl -I https://www.theleague.us/rosters` and `curl -I https://www.theleague.us/rosters?view=planner` returned `404`. The homepage HTML still contained multiple `href="/rosters"` links.

**Recommendation:** For future remote perf comparisons, prefer:
1. The actual Vercel deployment URL for `main`, or
2. A verified public route known to resolve directly,
instead of assuming the custom domain route is a valid benchmark target.

## 2026-07-07 - An Invalid Workflow File Presents As "0 Jobs / event=push / conclusion=failure"

**Context:** Debugging why Schefter went silent. The `schefter-scan.yml` scan step's `env:` map had defined `GROUPME_AFL_ROGER_BOT_ID` twice.

**Insight:** A duplicate key in a workflow-file mapping (or any YAML that fails GitHub's workflow validation) is a **startup failure**, not a runtime failure. The tells in the Actions API, when the *scheduled* workflow you're debugging never actually ran:
- `list_workflow_jobs` returns `total_count: 0` and `get_job_logs(failed_only)` finds no failed jobs — there are no logs because no job ever started.
- The run's `conclusion` is `failure` but its `event` is **`push`, not `schedule`** — when the file is invalid GitHub can't evaluate its `on:` triggers, so the cron never fires; failed startup runs only surface when a commit lands. A healthy scheduled workflow (compare `groupme-sync.yml`) shows `event: schedule`. So `event=push` on a workflow that only declares `schedule`/`workflow_dispatch` is a reliable signature that the file itself is broken.

**Evidence:** All 30 recent `schefter-scan.yml` runs: `conclusion=failure`, `event=push`, `jobs.total_count=0`. The sibling `groupme-sync.yml` (valid file) showed `event=schedule` with a real failed job whose logs carried the actual runtime error.

**Recommendation:** When a scheduled job "stopped running," first check whether it's a startup failure vs a runtime failure. If runs show 0 jobs and `event=push`, validate the YAML with a **duplicate-key-detecting** parser (Python `yaml.safe_load` silently keeps last-wins and will NOT catch this — add a custom constructor that throws on repeat keys) rather than reading job logs that don't exist.
