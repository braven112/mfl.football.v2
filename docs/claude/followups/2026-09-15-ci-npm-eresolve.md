---
slug: ci-npm-eresolve
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1103
hotfix_sha: ec49ea81c5
followup_issue: 1106
followup_pr:
followup_session:
---

# Follow-up: npm-installing CI workflows died on ERESOLVE for four days

## What broke

From 2026-09-11 every GitHub Actions workflow that installed dependencies with
`npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts`
failed at the install step, before any script ran:

```
npm error ERESOLVE unable to resolve dependency tree
Found: vitest@1.6.1 (peerOptional from @vitejs/devtools-vitest@0.7.3 <- @vitejs/devtools@0.7.3 <- vite@8.3.0)
Could not resolve dependency: peerOptional vitest@"^4.1.0" from @storybook-astro/framework@1.12.0
```

npm ignores `pnpm-lock.yaml` and re-resolves peers strictly from the registry,
so a publish upstream broke us with no code change here. Silenced: schefter-scan,
schefter-rumor-scan, schefter-trade-speculation (including the franchise-history
milestone scan), and lineup-reminders (Roger's Sunday check on 09-13).

schedule-release failed daily for a separate reason (since at least 09-10): a
bare `pnpm/action-setup@v4` with no `version:` and no `packageManager` in
package.json → "No pnpm version is specified".

## What the hotfix did

Forward fix, no revert (the last package.json change, 937592d82d / #1052, was
scripts-only and not the cause).

- `.github/workflows/{schefter-scan,schefter-rumor-scan,schefter-trade-speculation,lineup-reminders,schedule-release}.yml`
  now use `./.github/actions/setup` (pnpm pinned, `pnpm install --frozen-lockfile`)
  directly after their existing checkout step.
- `tests/workflow-install-guard.test.ts` forbids `npm ci|install|i` and a raw
  `uses: pnpm/action-setup@` anywhere in `.github/workflows` / `.github/actions`
  (comment lines skipped; the shared action is exempt). Verified it flags all
  five files as they were on main.
- Wired into the `github-workflows` domain of `.claude/hooks/path-guard.json`.
- Changelog staged (bug-fix, `both`).

Verified with workflow_dispatch dry runs on the branch (35025027181,
35025029960, 35025032468, 35025069480) and on main @ ec49ea81c5 (35026135793,
35026138164, 35026140380), plus a workflow_dispatch run of schefter-scan on main (no dry_run exists; GitHub was firing its */15 cron only every ~3h).

## Deferred items

- [ ] **F1 — path-guard does not cover `.github/actions`**
  - Source: Copilot inline review on #1103
  - Where: `.claude/hooks/path-guard.json:247-257` — the `github-workflows`
    domain matches `.github/workflows/*.yml` only
  - Why deferred: CI still runs the guard on every PR; only the edit-time hook
    misses an edit to `.github/actions/setup/action.yml`. Add
    `.github/actions/**/*.yml`; `tests/path-guard-map.test.ts` requires every
    glob to match a file.

- [ ] **F2 — No prose rule with a `Guard:` pointer**
  - Source: Copilot inline review on #1103
  - Where: `tests/workflow-install-guard.test.ts:1-20`; the prose belongs next
    to CLAUDE.md "Project basics" (package manager line) or in
    `docs/claude/rules/storage-and-build.md`
  - Why deferred: docs-only; the test header already carries the reasoning.

- [ ] **F3 — ~8 workflows run raw `actions/setup-node` with no install at all**
  - Source: deferred at implementation
  - Where: `.github/workflows/{schefter-articles,groupme-post,schefter-announce,apply-pending-contracts,apply-august-cuts,backfill-standings-points,phase0-owner-cookie-spike,pr-external-review}.yml`
  - Why deferred: not broken today. But schefter-scan's own comment records
    that a job with no install degrades SILENTLY when a script dynamically
    imports a package (`@upstash/redis` → "Redis import failed", exit 0).
    Audit what each runs; move to the shared action where a dependency is
    imported, and consider extending the guard.

- [ ] **F4 — pnpm version is single-sourced only inside the composite action**
  - Source: deferred at implementation
  - Where: `package.json` (no `packageManager`), `.github/actions/setup/action.yml:14-16`
  - Why deferred: a toolchain change reaches local dev and Vercel; not needed
    to restore CI. Consider `"packageManager": "pnpm@10.24.0"` and confirm
    Vercel/corepack agree before shipping.

## Context to start cold

- `--omit=dev` / `--ignore-scripts` were dropped on purpose: package.json has no
  install lifecycle scripts, and ~29 other feed-writing crons already do a full
  pnpm install through the shared action.
- `chromatic.yml` already used the shared action and was never affected.
- The pre-push hook (`.claude/hooks/pre-push-check.sh`) fires on ANY Bash command
  containing `git push` and runs before the command — never chain a rebase
  resolution and a push in one command, or it tests the conflicted tree.
- schedule-release, rumor-scan, trade-speculation and lineup-reminders all take
  `dry_run`; schefter-scan does not (it posts for real), so verify it via its
  15-minute cron, not a dispatch.
