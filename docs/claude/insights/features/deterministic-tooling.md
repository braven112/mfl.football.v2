# Deterministic Tooling

The skills, agents, hooks and scripts that turn this repo's prose rules into
things a script does the same way every time. Companion to
`docs/claude/rules/README.md` ("a test is checked, prose is skimmed") and to
CLAUDE.md "Prefer the mechanical path".

## 2026-09-05 - Rules That Live Only as Prose Are the Non-Determinism

**Context:** An audit of how work actually happens here found 4,400 lines of
rules docs, ~20 hand-rolled scan guards each written AFTER its bug shipped,
five near-identical `*-clientrouter.test.ts` suites written one page at a
time in a single week, a hotfix doc naming sibling-page drift as a recurring
bug class, and an edit-time hook that guarded exactly one domain (Roger). The
pattern: most rules were things an agent was asked to remember, and only some
had a mechanism behind them.

**What was built, and the decision behind each:**

| Thing | Replaces | Load-bearing decision |
|---|---|---|
| `.claude/hooks/path-guard.mjs` + `path-guard.json` | `roger-reminder-test.sh` (one domain) | Domain map is DATA; `tests/path-guard-map.test.ts` fails on a dead glob, a missing test/doc, or a rules doc nothing routes to. Trap lines are read from the CLAUDE.md table, not copied, so they cannot drift. Rules context injects ONCE per domain per session (tmpdir marker) so it does not nag. |
| `/guard-test` + `tests/helpers/scan-guard.ts` | 150-line hand-rolled scanners | Three shapes (forbidden / required / ratchet) cover nearly every rule. Stale allowlist entries FAIL — a guard that silently widens is worse than none. Mutation check is mandatory: a guard never seen red is a guess. |
| `/ratchet` + `scripts/ratchet.mjs` + `scripts/lib/ratchet-measures.mjs` | hand-editing three baseline fixtures | The test and the retightening tool share ONE measurement module; `--write` only ever tightens. |
| `/rebase` + `scripts/resolve-rebase-conflicts.mjs` | the CLAUDE.md prose checklist | Under a rebase `--ours` is MAIN. The old prose said "prefer `--theirs` (incoming main)", which is merge wording and takes the branch's stale feed over the cron's live one. Fixed in CLAUDE.md; the classifier reads generated-file patterns from `.gitattributes` so there is one source of truth and no league-path literal. |
| `/new-page` + `scripts/scaffold-page.mjs` | copying one league's page into the other | The three page rules (shared component, gate in the route, directory entry with 10+ tags) are GENERATED. Refuses <10 tags rather than padding — placeholders pass the test and defeat the registry. |
| `/new-cron` + `scripts/scaffold-workflow.mjs` | reading three docs before writing a workflow | `const ENABLED` instead of `vars.*`; `--season-gated` wires `isSeasonWindowOpen`; writes go through `writeJsonIfChanged`. |
| `/rollover-check` + `scripts/rollover-check.ts` | testing with the system clock | Expected years are IMPORTED from `league-year.ts`; re-porting the formula is how the double-advance shipped in five files. |
| `tests/clientrouter-init-ratchet.test.ts` | the sixth `*-clientrouter.test.ts` | Generic scan for DOMContentLoaded-only init in bundled scripts; 19 pre-existing offenders pinned as a shrink-only baseline. `is:inline` exempt. |
| `tests/workflow-feature-flag-guard.test.ts` | the "Feature flags" paragraph | First `/guard-test` output; legacy Schefter gates pinned to their two files so they cannot spread. |
| `sibling-drift-checker` agent + `scripts/sibling-drift.mjs` | "open the sibling" from memory | The script enumerates every twin (page and league-scoped component) with MISSING / UNCHANGED / ALSO CHANGED; the agent's only job is the judgment per UNCHANGED row, cited by line. |
| `guard-gap-auditor` agent + `scripts/guard-gap.mjs` | re-reading a rules doc to guess coverage | Script lists rule-shaped lines, `Guard:` declarations, and citing tests; agent matches and ranks gaps for `/guard-test`. |
| `clientrouter-lifecycle-auditor` agent | debugging "dead after navigation" from scratch | Four rules, fixed table; explicitly forbids the `{ once: true }` non-fix the insights already documented. |
| `mfl-fixture-recorder` agent + `scripts/record-mfl-fixture.mjs` | pasting a browser response into `tests/fixtures/` | Arrays sorted by a stable key (id → player → franchise → week → name) so re-recording an unchanged league is byte-identical; sorting is for FIXTURES only, never live feeds (standings order is official). |

**Insight 1 — the hook found real mistakes during its own build.** Three
times while writing these files the reference guard (`claude-md-references`)
fired through the new hook on a placeholder citation or a nonexistent doc
path. Each would have shipped silently under the old one-domain hook. That
is the argument for edit-time guards in one sentence.

**Insight 2 — make the shared thing pure and test it; make the CLI thin.**
Every script here has a pure core (`classifyConflict`, `newPageWarnings`,
`canonicalizeForFixture`, `collectClientRouterOffenders`) with a test, and a
CLI that only does I/O. The agents are told to run the CLI first and judge
second. That split is what makes the "agent" outputs repeatable: the
enumeration cannot vary, only the verdict per row can.

**Insight 3 — a ratchet is the right shape for a rule with pre-existing
debt.** Nineteen files init on DOMContentLoaded today. A hard-fail guard would
have needed a 19-entry allowlist that reads as permission; a shrink-only
baseline reads as a to-do list and fails the moment the twentieth appears.

**Watch for:** the per-domain hook suites must stay fast (1–4 s each today).
A slow suite added to `path-guard.json` taxes every edit in that domain; put
it in CI and keep the edit-time set to scan guards and pure-function tests.
And `path.matchesGlob` is what the map uses — a glob that matches nothing is
caught by the validator, but a glob that matches too MUCH (`src/**`) just
makes every edit slow, which nothing catches except noticing.

Guard: `tests/path-guard-map.test.ts`, `tests/scan-guard-helper.test.ts`,
`tests/rebase-conflict-classifier.test.ts`, `tests/clientrouter-init-ratchet.test.ts`,
`tests/mfl-fixture-canonicalize.test.ts`, `tests/workflow-feature-flag-guard.test.ts`.
