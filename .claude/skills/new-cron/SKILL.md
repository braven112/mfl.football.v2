---
name: new-cron
description: Scaffold a scheduled GitHub Actions job and its script with this repo's cron rules built in — no vars.* feature gates, registry-only league constants, a season-window guard for weekly jobs, canonical JSON writes, the shared setup and commit-push actions. Use when adding any scheduled sync, scan, or generator under .github/workflows/. Trigger on /new-cron, "add a cron", "schedule a job", "new workflow", "run this nightly/weekly".
---

# /new-cron — a scheduled job that follows the rules on day one

There are 40+ workflows and the rules for them are spread across three docs.
`scripts/scaffold-workflow.mjs` writes a workflow + script pair with every
rule already applied, in the shape of `.github/workflows/weekly-stats-sync.yml`.

| Rule | Where it bit | How the scaffold applies it |
|---|---|---|
| No `vars.*` feature gates | CLAUDE.md "Feature flags — code, not GitHub Actions variables" | `const ENABLED` in the script; disable by commenting the `cron:` line |
| Registry constants only | `tests/league-literal-guard.test.ts` | loops `ALL_LEAGUES`, reads `league.id` / `mflHost` / `dataPath` |
| Weekly job gates on the season being played | CLAUDE.md "Year rollover — two independent clocks" (Pecking Order fired all preseason) | `--season-gated` adds `isSeasonWindowOpen` on `getCurrentYears()` |
| Deterministic feed writes | `docs/claude/rules/storage-and-build.md` | `writeJsonIfChanged` from `scripts/lib/canonical-json.mjs` |
| Shared CI preamble + commit step | `.github/actions/setup`, `.github/actions/commit-push` | both wired |

## Procedure

1. **Collect**: kebab-case `name`, the schedule as a 5-field cron **in UTC**
   (convert from PT first and keep the PT time in the comment), a
   one-line description, what paths it commits (`--add-paths`, default
   `data/`), and whether it is a during-the-season job (`--season-gated`).

2. **Scaffold.**
   ```bash
   node scripts/scaffold-workflow.mjs --name <name> --cron "<m h dom mon dow>" \
     --description "<what it refreshes>" [--add-paths data/] [--season-gated] --dry-run
   ```
   Then again without `--dry-run`. It refuses to overwrite.

3. **Implement the script's TODOs**: which MFL export type, which year clock
   (`getCurrentLeagueYear` vs season year — see CLAUDE.md), and the output
   path under `league.dataPath`. Use `fetchExport` from `scripts/lib/mfl-api.mjs`
   with retries and a timeout; never a bare `fetch` to MFL.

4. **Verify.**
   ```bash
   node --check scripts/<name>.mjs && node scripts/<name>.mjs
   node_modules/.bin/vitest run tests/workflow-feature-flag-guard.test.ts tests/league-literal-guard.test.ts
   ```
   If the job posts to GroupMe, build every URL with `leagueUrl()` and run
   the text through `stripLinkAdjacentPunctuation` (docs/claude/rules/league-urls.md).

5. **First run**: trigger via `workflow_dispatch` and read the run log before
   trusting the schedule.

## Don'ts

- Don't add a `vars.*` reference to gate the job.
- Don't guard a weekly job with "the feeds have a completed week".
- Don't `writeFileSync` a feed — MFL array order is nondeterministic.
- Don't hardcode `'13522'`, a `www49` host, or `data/theleague`.
