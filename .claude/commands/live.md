Push the current branch, create a PR, gather advisory reviews (Claude + Codex in-session, CodeQL + Copilot on the PR, Gemini on request), adjudicate the findings yourself, auto-approve if nothing confirmed-critical remains, enable auto-merge, then monitor until the PR is merged.

**Reviewer lineup and what each costs.** No reviewer here bills money; every one is either a subscription you already hold or free tier. Never add one that needs a funded API key.

| Reviewer | Where | Lens | Cost |
|---|---|---|---|
| Claude | in-session | correctness (5) + **cross-cutting (5b)** | Claude subscription |
| Codex | in-session, **laptop only** | correctness & security | ChatGPT Pro |
| CodeQL | CI | static security analysis | free (public repo) |
| Copilot | CI | line-level defects | included |
| Gemini | CI, **on request only** (step 6) | cross-cutting, second opinion | Gemini API free tier |

**Gemini is opt-in as of Aug 2026, and you are the reason that is safe.** It
used to run on every push and mostly failed — PRs #639, #644 and #646 each came
back `503 model currently experiencing high demand` within four hours, so the
free tier plainly could not carry a per-push reviewer. Two consequences you
must hold onto:

- **Step 5b is not optional and not a fallback.** The cross-cutting lens is now
  *yours* on every PR, whether or not Gemini is asked. Do not treat requesting
  Gemini as a way to skip it.
- **Ask for Gemini when it would add something, not by reflex.** It is a second
  opinion on the diffs where a missed call site is most likely, and used
  sparingly it has quota left to actually answer. Step 6 has the criteria.

## Steps

### 1. What's New and Insights

Before anything ships, run both documentation checks:

1. **Run `/update-whats-new`** — evaluates whether the changes need a What's New entry or changelog item and writes it. If a screenshot is still needed, flag it to the user but don't block.
2. **Run `/update-insights`** — reviews what was built and records any learnings to the insight files.

Both are non-blocking — if nothing needs updating they say so and move on.

### 2. Verify there's something to push

Run `git status` and `git log main..HEAD --oneline`. If there are no commits ahead of main, tell the user there's nothing to ship and stop.

If there are uncommitted changes, stage and commit them first using the repo's commit style (conventional commits, short imperative subject, Co-Authored-By trailer).

Skip these data sync files when staging — they're noise:
- `data/theleague/live-*`
- `data/theleague/mfl-feeds/`
- `src/data/salary-history/`
- `src/data/theleague/mfl-player-salaries-*`

### 3. Push the branch

```bash
git push -u origin HEAD
```

### 4. Create the PR (or find the existing one)

Check if a PR already exists for this branch:
```bash
gh pr view --json number,url,state 2>/dev/null
```

If no PR exists, create one:
```bash
gh pr create --title "<imperative subject from latest commit>" --body "$(cat <<'EOF'
## Summary
<bullet points from commits on this branch vs main>

## Test plan
- [ ] CI passes
- [ ] Manual smoke test on Vercel preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR number and URL. Print the PR URL as a clickable link.

### 5. Run the Claude code review

**Claude (`/code-review` skill):**
- Run `/code-review --comment` to review the diff and post inline PR comments
- Focus: correctness bugs, design token compliance, CLAUDE.md guideline adherence, TypeScript safety

### 5a. Codex reviewer (local only, free)

The `codex` CLI authenticates against a ChatGPT Pro subscription (`auth_mode: chatgpt`), so it costs nothing to run — but only where the CLI exists and is authed, which is a laptop and not the Claude cloud sandbox.

Check first, and do not assume:

```bash
codex --version 2>/dev/null && python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.codex/auth.json')))['auth_mode'])" 2>/dev/null
```

- **If both succeed** → run the `codex:codex-rescue` agent with the correctness-and-security lens: "You are a senior code reviewer. Review this diff for bugs, logic errors, security issues, and missed edge cases — null/undefined, off-by-one, inverted conditions, unhandled rejections, injection, races, edge cases. Do not comment on style. List findings as Critical / Important / Suggestions with `path:line`. If you find nothing, say NO FINDINGS."
- **If either fails** → record **"Codex: did not run (CLI unavailable)"** and continue.

> **This reporting is the whole point.** The original bug was not that Codex ran locally — it was that when it silently no-opped, `/live` counted it as a clean pass and coverage dropped to Claude alone with nobody noticing. A loudly-absent reviewer is fine. A silently-absent one is not. Never write "Codex: 0 findings" when you did not run it.

Do **not** put Codex in CI: the OpenAI API has no free tier and a ChatGPT subscription grants no API credit, so a CI Codex reviewer can only ever 429.

### 5b. Claude's cross-cutting pass (mandatory — this is the lens Gemini used to hold)

Run this as a **separate pass over the diff**, after the correctness review
above and with the same seriousness. Do not fold it into step 5 and do not skip
it because you plan to request Gemini in step 6 — Gemini is a second opinion on
this lens, never the holder of it.

This lens is the one that most needs the repo in front of it, which is exactly
why it transfers to you cleanly: "you missed a call site" is unanswerable
without knowing what the call sites are, and unlike an API reviewer you can go
read them. **Grep, don't infer** — every item below is a search you can
actually run, and a claim that all callers were updated is only worth anything
if you enumerated them.

- **Call sites the change missed.** If a function's signature, contract or
  return shape changed, grep for every caller and confirm each one. Name the
  count in your adjudication ("7 callers, all updated") so the claim is
  checkable rather than asserted.
- **Half-applied refactors** — a pattern introduced in one file but not its
  siblings. If the diff establishes a new way of doing something, search for
  the old way and say whether the leftovers are deliberate.
- **The two-league page pairs drifting apart.** TheLeague and AFL have
  near-identical sibling pages (`theleague/players.astro` /
  `afl-fantasy/players.astro`, both lineup pages, both draft predictors). A fix
  applied to one and not the other is a recurring bug class here, and it is
  **invisible in a diff that only touches one of them** — so this check cannot
  be done from the diff alone. Run `node scripts/sibling-drift.mjs` for the
  complete twin list (or launch the `sibling-drift-checker` agent, which runs
  it and reads each UNCHANGED twin against the diff), then open the sibling.
- **Registries and declarations the change should have updated:**
  `src/data/page-directory.json` (10+ tags) for any new page,
  `src/data/whats-new.json` for user-facing work, `defaultRankingSources` and
  `rankings-scope.ts` for a new league, `relatedLinks` for a new Schefter
  article type.
- **Docs and guard tests that encode the rule being changed.** If the diff
  changes behavior a `tests/` guard pins or a `docs/claude/rules/` doc
  describes, both should move with it. A guard test that still passes because
  the diff worked *around* it is a finding.
- **Contradictions with conventions visible elsewhere in the diff.**

Report the result in the step 7 adjudication table as a reviewer in its own
right (`Claude (cross-cutting)`), with its own findings. If it found nothing,
say what you checked — "cross-cutting: clean" with no evidence is the failure
mode this step exists to prevent.

### 6. Request the external reviewer (Gemini) — only when it earns its keep

`.github/workflows/pr-external-review.yml` no longer runs on push. It runs when
you dispatch it, and posts a sticky comment with findings under
`## Critical` / `## Important` / `## Suggestions` headings.

**Decide, then say what you decided.** Request Gemini when the diff has the
shape where a second pair of eyes on the cross-cutting lens has somewhere to
look — that is, when **any** of these hold:

- A shared function's signature, contract or return shape changed.
- A rename or pattern sweep touching **5+ files**.
- It edits a registry or config read from many places
  (`leagues-data.mjs`, `rankings-scope.ts`, `league-year.ts`, auth utils).
- One half of a two-league sibling pair changed.
- The diff is large: **15+ files** or **800+ changed lines**.

Skip it — and this is the normal case — for a single-file change, a
style/copy tweak, docs, data, tests only, or a self-contained new page with no
shared-code edits. There is nothing for a cross-cutting reviewer to find in a
diff with no second file in it, and every skipped run is quota left for a diff
that needs it.

If you are requesting it, dispatch it **early** — right after step 4, so it
runs while you do steps 5 and 5b, rather than making the PR wait on it:

```bash
gh workflow run pr-external-review.yml -f pr=<PR_NUMBER>
```

Then collect it here:

```bash
gh run list --workflow=pr-external-review.yml --limit 1
gh pr view <PR_NUMBER> --json comments --jq '.comments[] | select(.body | contains("<!-- external-pr-review -->")) | .body'
```

Give it **one** `gh run watch` if it is still going. Do not wait on it
indefinitely, and never hold the PR for it — you already own this lens.

**States that are not a clean pass**, and must be reported rather than counted
as zero findings:

| What the comment says | Report it as |
|---|---|
| ⚠️ failed to run (**transient**) | `Gemini: did not run — API unavailable` |
| ⛔ failed to run (**permanent**) | `Gemini: did not run — misconfigured`, **and fix it**: a dead model id or bad key is a real bug in this repo, not weather |
| Skipped — `GEMINI_API_KEY` not set | `Gemini: did not run — no key` |
| No comment at all | `Gemini: not requested` (only valid if you chose to skip it — otherwise the dispatch failed) |

The honest line is always "Gemini: did not run", never "Gemini: clean". But
note the asymmetry the retry logic now surfaces: a **transient** failure is
weather and you proceed on your own cross-cutting pass; a **permanent** one is
a broken tool that will keep failing for every future PR until someone fixes
it, so fix it in this PR or open an issue. Do not shrug at the second kind
because the first kind is common.

### 6a. Collect GitHub Copilot review feedback

Copilot auto-reviews most PRs and adds inline comments separately from the reviewers above. Fetch its findings so they're factored into the same decision:

```bash
gh pr view <PR_NUMBER> --json reviews --jq '.reviews[] | select(.author.login == "copilot-pull-request-reviewer") | .body' | head -200
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments --jq '[.[] | select(.user.login == "Copilot") | {path: .path, line: .line, body: .body}]'
```

Each Copilot inline comment counts as a finding. Classify each by your own judgment (Critical / Important / Suggestion) since Copilot doesn't label severity — use the same bar the other reviewers would.

If no Copilot review has appeared yet (it can lag a minute), retry once after 30 seconds. If still nothing, note "Copilot: no review posted" and proceed.

### 6b. Collect CodeQL findings

`.github/workflows/codeql.yml` runs static security analysis on every PR (free — this repo is public). It covers the injection / traversal / tainted-flow class that the Codex reviewer would have held.

```bash
gh pr checks <PR_NUMBER> | grep -i codeql
gh api repos/{owner}/{repo}/code-scanning/alerts \
  --jq '[.[] | select(.state=="open") | {rule: .rule.id, sev: .rule.severity, path: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}]'
```

CodeQL findings are machine-generated and precise about *what* they matched, but not about whether it matters here — adjudicate them like any other advisory finding in step 7. If the alerts API returns 403/404, note "CodeQL: not available" and move on rather than chasing scopes.

### 7. Adjudicate the findings

**You are the decision maker. Codex, Gemini, CodeQL and Copilot are advisors.**

Their findings are input, not verdicts. None of them can see `CLAUDE.md`, the
guard tests, or the history behind a deliberate-looking oddity, so they will
confidently flag intentional patterns as bugs — `preserveFeedOrder: true` reads
as a missing sort, the quiet-day GroupMe skip reads as a dropped notification,
the pinned `stripLinkAdjacentPunctuation` call sites read as an unfinished
refactor. A confident wrong "Critical" must not be able to stop a merge on its
own say-so.

So do not tally severities and act on the total. Assess each finding yourself:

1. **Is it real?** Read the code it points at. Reproduce the claim mentally
   against actual behavior — do not accept it because it is stated confidently
   or because two reviewers said it.
2. **Does the repo already answer it?** A rule in `CLAUDE.md` or a guard test
   may make it a non-issue. If so, that's a rejection with a reason.
3. **Then assign YOUR severity.** A reviewer's label is a suggestion. Findings
   you have confirmed get your severity; findings you reject get none.

Be genuinely open here — an outside reviewer questioning a premise is the
point, not noise. Several of this repo's worst bugs were rules that were
themselves wrong. "CLAUDE.md says so" is a reason to check the rule, not
automatically to dismiss the finding.

**Watch for knowledge-cutoff findings specifically.** The advisory models have
older training data than this repo's dependencies. On PR #544 Gemini filed two
CRITICAL findings claiming `actions/checkout@v6` and `actions/setup-node@v6`
do not exist and "only exist up to v4" — while running inside a job whose own
Checkout step had just succeeded on v6, in a repo that uses v6 in 29 places.
Under the old tally-the-severities rule those two would have blocked the merge.
Any finding of the form "X does not exist" or "X is not a valid version" needs
a check against reality (does it run? is it already used elsewhere?) before it
counts for anything.

Present your adjudication, showing rejections as well as accepts — a rejected
finding the user disagrees with is exactly what they need to see:

```
Review Adjudication
──────────────────────────────────────────────────
Confirmed
  [Critical]  <finding>                    (Gemini, Copilot)
  [Important] <finding>                    (Codex)
Rejected
  <finding>  — <why it isn't a problem>    (Gemini)
Reviewers
  Claude ✓   Claude cross-cutting ✓ (7 callers checked, both league pages)
  Codex did not run (cloud)   CodeQL ✓   Copilot ✓
  Gemini not requested (single-file change)
Decision: <Proceeding / Blocked on N confirmed critical>
```

Rules for the summary:
- Use `did not run` for any reviewer that errored or was skipped. A failed
  reviewer and a clean reviewer must never render identically.
- Attribute each finding to the reviewer(s) that raised it, so a reviewer that
  is consistently wrong becomes visible over time.

Then:

- **Confirmed Critical** → present them, stop auto-approve, ask the user to
  confirm before proceeding.
- **Confirmed Important** → fix them in this PR.
- **Suggestions** → these are opt-in. Recommend the ones you'd take and say
  why; apply them if the user agrees or if they're clearly right and trivial.
  Do not silently adopt a reviewer's whole suggestion list.
- **All rejected / clean** → proceed, but still show what was rejected.

The user has the final say over you, as you have over the advisors. If they
disagree with an adjudication, theirs wins.

### 7a. Re-review loop after fixes

If you applied fixes for confirmed findings, re-run the Claude reviewer on the new commit to confirm:
1. All confirmed findings are now FIXED
2. No new issues introduced by the refactor

Pushing the fixes re-triggers Copilot, so re-fetch it (step 6a) against the new
commit and adjudicate the new round the same way. It does **not** re-trigger the
external reviewer any more — that one is dispatch-only. Re-request it (step 6)
only if your fixes were themselves broad enough to meet the step 6 criteria;
a one-line fix to a finding does not need a fresh external review. Re-run your
own cross-cutting pass (step 5b) over the fix either way — a fix that updates
one call site and not its siblings is the exact bug class that pass exists for.

Loop until you have no confirmed unfixed findings. **A reviewer re-raising something you already rejected with a reason does not restart the loop** — note it and move on, otherwise a stubborn false positive blocks the PR forever.

### 8. Auto-approve the PR

If no **confirmed** Critical issues:
```bash
gh pr review <PR_NUMBER> --approve --body "Reviewed by Claude Code (correctness + cross-cutting), with advisory review from Copilot/CodeQL — no confirmed critical issues. CI must pass before merge."
```

### 9. Enable auto-merge

```bash
gh pr merge <PR_NUMBER> --auto --squash
```

GitHub will merge automatically once the `Tests` CI check passes.

**Self-authored PR fallback.** GitHub blocks self-approval, so for a PR you opened, auto-merge can sit in `mergeable_state: "blocked"` even when all required checks pass. After every Copilot finding is resolved and every required check is green (`Tests` SUCCESS, `Vercel` SUCCESS, etc.), force the squash-merge with admin rights:

```bash
gh pr merge <PR_NUMBER> --squash --admin
```

Only do this when:
- All findings you CONFIRMED (from any reviewer) are resolved — rejected findings, with their reasons recorded, do not block
- Every required status check is SUCCESS
- The user has authorized the admin merge (either explicitly this session or via standing instruction)

Never `--admin` merge with failing checks or unresolved Critical findings — that's the whole point of branch protection.

### 10. Monitor until merged

Poll every 30 seconds until the PR is merged or a check fails:

```bash
while true; do
  STATE=$(gh pr view <PR_NUMBER> --json state,mergeable,statusCheckRollup --jq '{state:.state, mergeable:.mergeable, checks:.statusCheckRollup}')
  PR_STATE=$(echo "$STATE" | jq -r '.state')

  if [ "$PR_STATE" = "MERGED" ]; then
    echo "✓ PR merged."
    break
  fi

  if [ "$PR_STATE" = "CLOSED" ]; then
    echo "PR was closed without merging."
    break
  fi

  FAILED=$(echo "$STATE" | jq -r '.checks // [] | map(select(.conclusion == "FAILURE")) | length')
  if [ "$FAILED" -gt 0 ]; then
    echo "CI failed — stopping monitor. Fix and re-run /live."
    gh pr view <PR_NUMBER> --json statusCheckRollup --jq '.statusCheckRollup[] | select(.conclusion == "FAILURE") | "\(.name): \(.conclusion)"'
    break
  fi

  PENDING=$(echo "$STATE" | jq -r '.checks // [] | map(select(.conclusion == null or .conclusion == "PENDING" or .conclusion == "IN_PROGRESS")) | length')
  echo "Waiting… ($PENDING check(s) still running)"
  sleep 30
done
```

### 11. Report

When the PR is merged, print:
- The PR URL (clickable)
- The squash commit SHA
- "Deployed to main ✓"
- Any findings you REJECTED during adjudication, one line each. They shipped
  unaddressed on your judgement, so the user gets a last look at that call.

If CI failed, print the failing check names and tell the user to fix and re-run `/live`.
