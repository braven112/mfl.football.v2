Push the current branch, create a PR, gather advisory reviews (Claude + Codex in-session, Gemini + CodeQL + Copilot on the PR), adjudicate the findings yourself, auto-approve if nothing confirmed-critical remains, enable auto-merge, then monitor until the PR is merged.

**Reviewer lineup and what each costs.** Every default reviewer here is either a subscription you already hold or free tier. Exactly one route bills per token — the Codex API fallback in step 5a — and it only engages when a key is deliberately configured. Never make a metered reviewer the default.

| Reviewer | Where | Lens | Cost |
|---|---|---|---|
| Claude | in-session | correctness + cross-cutting (step 5) | Claude subscription |
| Codex | in-session, `codex` CLI (laptop) | correctness & security | ChatGPT Pro |
| ↳ same lens, API fallback (cloud) | in-session, needs `OPENAI_API_KEY` | correctness & security | **billed per token** |
| Gemini | CI | cross-cutting consistency | Gemini API free tier |
| CodeQL | CI | static security analysis | free (public repo) |
| Copilot | CI | line-level defects | included |

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

**Also cover the cross-cutting lens yourself.** The external reviewers run on free-tier quota and may not run at all, so do not assume Gemini covered this:
- Call sites the change missed — if a signature, contract or return shape changed, are ALL callers updated?
- Half-applied refactors: a pattern introduced in one file but not its siblings.
- **The two-league page pairs drifting apart.** TheLeague and AFL have near-identical sibling pages (`theleague/players.astro` / `afl-fantasy/players.astro`, both lineup pages, both draft predictors). A fix applied to one and not the other is a recurring bug class here, and it is invisible in a diff that only touches one of them.
- Registries a new page must be added to: `src/data/page-directory.json` (10+ tags) and `src/data/whats-new.json`.

### 5a. Codex reviewer — correctness & security lens

This lens has two routes to the same place. **Probe for the capability, never guess from the environment** — "am I in the cloud?" is not a question with a reliable answer, and every wrong guess costs a whole lens.

**Tier 1 — the `codex` CLI (free, laptop).** It authenticates against a ChatGPT Pro subscription (`auth_mode: chatgpt`), so it costs nothing, but only where the CLI exists and is authed:

```bash
codex --version 2>/dev/null && python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.codex/auth.json')))['auth_mode'])" 2>/dev/null
```

If both succeed → run the `codex:codex-rescue` agent with the correctness-and-security lens: "You are a senior code reviewer. Review this diff for bugs, logic errors, security issues, and missed edge cases — null/undefined, off-by-one, inverted conditions, unhandled rejections, injection, races, edge cases. Do not comment on style. List findings as Critical / Important / Suggestions with `path:line`. If you find nothing, say NO FINDINGS." Report **"Codex ✓ (CLI)"**.

**Tier 2 — the OpenAI API fallback (billed, works headless).** The plugin the `codex:codex-rescue` agent comes from is installed on a laptop, not in the Claude cloud sandbox, and its OAuth cannot complete without a browser. So when tier 1 is unavailable, run the same lens through the reviewer script, which is raw `fetch` + an API key and behaves identically anywhere:

```bash
node scripts/pr-review-external.mjs --providers openai --section-only --base origin/main
```

- `--section-only` prints the findings to stdout and **posts nothing**. That is deliberate: the sticky PR comment belongs to `pr-external-review.yml`, and an in-session run that wrote to it would replace CI's Gemini section with an openai-only body.
- Read the findings straight into your step 7 adjudication, exactly as you would the agent's. Report **"Codex ✓ (API fallback)"**.
- With no `OPENAI_API_KEY` in the environment the script exits 0 having reviewed nothing. **Do not read that as a pass** — see the status line below.

**Tier 3 — neither.** Record **"Codex: did not run (no CLI, no API key)"** and continue.

**Read the status line, not the prose.** Every run of the script ends with `EXTERNAL_REVIEW_STATUS: ok | degraded | skipped`. Only `ok` is a review that happened; `skipped` and `degraded` are tier 3.

> **This reporting is the whole point.** The original bug was not that Codex ran locally — it was that when it silently no-opped, `/live` counted it as a clean pass and coverage dropped to Claude alone with nobody noticing. A loudly-absent reviewer is fine. A silently-absent one is not. Never write "Codex: 0 findings" when you did not run it, and never claim the fallback ran on a `skipped` status.

Do **not** make Codex a default CI reviewer: the OpenAI API has no free tier and a ChatGPT subscription grants no API credit, so a CI Codex reviewer on an unfunded key can only ever fail. `pr-external-review.yml` accepts `providers: gemini,openai` on `workflow_dispatch` for the case where a funded key exists — that is opt-in per run, on purpose.

### 6. Collect the external reviewer (Gemini)

`.github/workflows/pr-external-review.yml` runs on every PR push and posts a sticky comment with the external reviewers' findings, under `## Critical` / `## Important` / `## Suggestions` headings.

**This reviewer is best-effort.** It runs on free-tier API quota, so a 429 is routine and the job deliberately does NOT fail when it happens. If no comment was posted, the reviewer simply didn't run — say so, treat the lens as uncovered by anyone but you (step 5), and proceed. Do not wait on it indefinitely and do not treat its absence as a problem to fix.

Wait briefly for the run, then fetch it:

```bash
gh run list --workflow=pr-external-review.yml --branch "$(git branch --show-current)" --limit 1
gh pr view <PR_NUMBER> --json comments --jq '.comments[] | select(.body | contains("<!-- external-pr-review -->")) | .body'
```

If the workflow is still running, give it one `gh run watch`; if it's quota-blocked or no comment appears, move on.

Three states that are **not** a clean pass, and must be reported rather than counted as zero findings:
- "⚠️ **Reviewer failed to run**" — usually a 429. That reviewer reviewed nothing.
- "Skipped — `GEMINI_API_KEY` not set" — no key configured.
- No comment at all — the workflow skipped because nothing was configured.

In every one of those cases the honest line is "Gemini: did not run", never "Gemini: clean".

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
  Claude ✓   Codex ✓ (API fallback)   Gemini ✓   CodeQL ✓   Copilot ✓
Decision: <Proceeding / Blocked on N confirmed critical>
```

Rules for the summary:
- Use `did not run` for any reviewer that errored or was skipped. A failed
  reviewer and a clean reviewer must never render identically.
- Say which Codex route ran — `(CLI)` or `(API fallback)` — because they cost
  different things and only one of them spends money.
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

Pushing the fixes re-triggers the external-review workflow and Copilot, so re-fetch both (step 6 and 6a) against the new commit and adjudicate the new round the same way.

Loop until you have no confirmed unfixed findings. **A reviewer re-raising something you already rejected with a reason does not restart the loop** — note it and move on, otherwise a stubborn false positive blocks the PR forever.

### 8. Auto-approve the PR

If no **confirmed** Critical issues:
```bash
gh pr review <PR_NUMBER> --approve --body "Reviewed by Claude Code, with advisory review from Gemini/Codex/Copilot — no confirmed critical issues. CI must pass before merge."
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
