---
slug: ci-npm-eresolve
status: shipped
severity: P1
opened: 2026-09-15
shipped: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1103
hotfix_sha: ec49ea81c5
followup_issue: 1106
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1108
followup_session: 2026-09-15
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

All four re-validated against main @ 54c14c3d58. None were dropped; F3 came
back materially **worse** than it was written, and grew a guard.

- [x] **F1 — path-guard does not cover `.github/actions`** — *still true, fixed*
  - The `github-workflows` domain now matches `.github/workflows/*.yml`,
    `.github/actions/**/*.yml` and `package.json` (the last so an edit that
    removes the pnpm pin runs the guard that requires it). Its `note` — what
    path-guard actually surfaces at edit time — now carries the install rule
    too, not just the feature-flag one.

- [x] **F2 — No prose rule with a `Guard:` pointer** — *still true, fixed*
  - New section in `docs/claude/rules/storage-and-build.md`, "CI installs with
    pnpm, never npm — and a no-install job stays dependency-free", covering all
    three failure modes with the `Guard:` line. `CLAUDE.md`'s package-manager
    bullet now says *why* pnpm is not a preference and points there.

- [x] **F3 — ~8 workflows run raw `actions/setup-node` with no install** —
  *still true, and the hand-audit's answer was wrong*
  - The audit says all eight are clean: every one uses only `redisCommand()`,
    which is plain `fetch`. The import graph says five of them reach
    `@upstash/redis` — `apply-august-cuts`, `apply-pending-contracts`,
    `phase0-owner-cookie-spike`, and `schefter-articles` (twice, via
    `generate-pecking-order` and `schefter-weekly-articles`) — because
    `scripts/lib/redis.mjs` held the REST helpers and `createUpstashClient()`
    in one file. Eleven REST-only scripts declared a dependency they never
    used. Nothing was *broken* (the SDK factory is never called on those
    paths), but the premise "these scripts only touch built-ins" was
    unverifiable, which is the actual defect.
  - Fixed structurally rather than by moving jobs onto the shared action:
    `createUpstashClient()` now lives alone in `scripts/lib/redis-client.mjs`,
    the only file in `scripts/lib` that names the package; the six SDK callers
    take one extra import line. No workflow changed.
  - Guard extended (this is the part that lasts): the suite now walks each
    no-install workflow's `node …` entrypoints transitively via the new
    `tests/helpers/module-graph.ts` and fails with the exact
    `workflow -> script -> package` chain. Negative-tested by adding a static
    `@upstash/redis` import to `scripts/lib/redis.mjs` — it flagged all five.

- [x] **F4 — pnpm version is single-sourced only inside the composite action**
  — *still true, fixed, verified both directions*
  - `"packageManager": "pnpm@10.24.0"` in package.json; the `pnpm-version`
    input and its `version:` are **removed** from `.github/actions/setup`,
    because `pnpm/action-setup` reads the field when given no version and
    *throws* `Multiple versions of pnpm specified` when both exist and
    disagree — a second copy is worse than none, not a backup. Nothing passed
    that input.
  - Corepack: verified locally, not assumed. Corepack fetched 10.24.0 with no
    interactive prompt, and `pnpm install --frozen-lockfile` under 10.24.0
    reported "Lockfile is up to date" and left `pnpm-lock.yaml` untouched.
  - Vercel: verified by this PR's own preview build — Vercel installs on its
    own, not through the composite action, so it is the only thing that
    exercises the `packageManager` field the way production will. Note the
    first push produced NO build: `vercel.json`'s `ignoreCommand` cancels a
    build for a branch with no open PR, and the branch was pushed before the
    PR existed, so the reassuring "Vercel ✓" on that commit was a CANCELED
    build, not a passing one. A skipped build and a green one look alike in
    the checks list; re-check after the PR is open.
  - CI verifies the action half — 34 workflows including `ci.yml` install
    through it, so a bad resolve is a red PR, not a silent cron.
  - Guard: `packageManager` must be pinned, and the shared action must not
    carry a `version:`.

## Late review findings

Copilot's two inline comments on #1103 are F1 and F2 above. No Gemini or
CodeQL findings landed after the merge; nothing else to adjudicate.

## What the follow-up's own review round added

Nine findings across Codex, Gemini, Copilot and CodeQL; eight confirmed, one
rejected. They all landed on the same place — the new import-graph walker —
and they were right to: in a guard, a FALSE NEGATIVE is the expensive
direction, because it passes while the dependency is real.

- Template-literal local imports were invisible. `schefter-weekly-articles.mjs`
  loads its modules with an interpolated specifier, so ten `article-types/*`
  modules were never walked — and `cut-watch.mjs` is one of them. Expanded now;
  an unexpandable dynamic import FAILS the guard rather than being skipped.
- Multi-line specifiers were invisible to a line-by-line scan.
- The guard was per FILE, not per JOB. Each job has its own runner, so one job
  using the shared action says nothing about its siblings. Workflows are parsed
  with `yaml` now, and one that fails to parse fails the suite.
- `moduleGraph()` recorded a path before proving it readable, which made the
  "every entrypoint exists" test echo its own argument back.
- CodeQL `js/redos` (severity error) on the flag-tolerant entrypoint regex;
  replaced with a tokenizer.

Rejected: Gemini's claim that the guard test is absent from the
`github-workflows` domain's `tests` array. It is the 4th entry, added by the
hotfix — the finding reads the `paths` diff and infers the rest.

**The lesson worth keeping** is that the hand audit in F3 and the machine
disagreed, and the machine was right twice: first about the five workflows
reaching `@upstash/redis`, then about the `article-types` subtree no one had
looked at. A rule whose premise is a claim about code that keeps changing
cannot be maintained in prose.

## Not in scope — but diagnosed, because it blocked the merge

`tests/season-ledger.test.ts` was red on main, which held this PR. Pre-existing
and unrelated (the test reads only `data/**`), but worth writing down because
the diagnosis went three layers deep and the fix was attempted and REVERTED.

1. `.github/workflows/schefter-trade-speculation.yml` runs
   `compute-franchise-history.mjs`, which writes `franchise-history.json` AND
   `season-ledger.json` in one run, off the same parsed standings — deliberately,
   so they cannot drift. Its `--files` commit list named only the first. Every
   daily run since 2026-09-04 committed a fresh history against a frozen ledger.
2. Adding the ledger to that list and regenerating DOES fix the test, and proves
   the emitter is innocent: `franchise-history.json` comes back byte-identical
   apart from `generatedAt`. Only the ledger was stale.
3. But `division-strength.json` derives from the ledger and is recomputed ONLY
   by `fetch-owner-names.yml` (manual, `if: inputs.write`). Refreshing the
   ledger makes it stale, and `tests/division-strength-data.test.ts` compares
   the two per-team. So the one-line fix trades one red test for another.
4. And regenerating `division-strength.json` produces INTERNALLY INCONSISTENT
   output — ~12k changed lines, its own cross-division sums failing to
   reconcile (`East: 432-508 vs 429-505`), an empty 2026 division, and a
   division named `West` where `East` is expected. That is a bug in
   `compute-division-strength.mjs` against today's inputs, not staleness.

So three derived artifacts must move together and only one of the three has a
daily writer. The whole excursion was reverted; this PR touches zero data
files. Fixing it properly means fixing the generator first, then giving the
trio a single writer — not adding a filename to a glob.

(The check went green on its own before merge, when a cron refreshed main's
data. That is luck, not a fix — the coupling is unchanged.)

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
