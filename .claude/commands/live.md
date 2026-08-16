Push the current branch, create a PR, gather advisory reviews from Gemini, Codex and Copilot (on the PR) alongside Claude's own (in-session), adjudicate the findings yourself, auto-approve if nothing confirmed-critical remains, enable auto-merge, then monitor until the PR is merged.

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

This is the only reviewer you invoke in-session. Gemini and Codex now run in CI (step 6) — **do not** spawn `codex:codex-rescue` here.

> **Why they moved.** Those reviewers wrap CLIs that authenticate interactively against a personal subscription. That works on a laptop and cannot work headless, so in the Claude cloud workflow the Codex subagent would silently no-op and coverage would quietly drop to Claude alone. In CI they authenticate by repo secret, so coverage is identical no matter where `/live` was launched.

### 6. Collect the external reviewers (Gemini + Codex)

`.github/workflows/pr-external-review.yml` runs on every PR push and posts a single sticky comment containing both reviewers' findings, under `## Critical` / `## Important` / `## Suggestions` headings.

Wait for the run to finish, then fetch it:

```bash
gh run list --workflow=pr-external-review.yml --branch "$(git branch --show-current)" --limit 1
gh pr view <PR_NUMBER> --json comments --jq '.comments[] | select(.body | contains("<!-- external-pr-review -->")) | .body'
```

If the workflow hasn't completed yet, wait for it (`gh run watch`) rather than proceeding — skipping it is what the move to CI was meant to prevent.

Two states that are **not** a clean pass, and must be surfaced to the user rather than counted as zero findings:
- A section reading "⚠️ **Reviewer failed to run**" — that reviewer did not review anything.
- A section reading "Skipped — `GEMINI_API_KEY` not set" — the secret is missing.

### 6a. Collect GitHub Copilot review feedback

Copilot auto-reviews most PRs and adds inline comments separately from the reviewers above. Fetch its findings so they're factored into the same decision:

```bash
gh pr view <PR_NUMBER> --json reviews --jq '.reviews[] | select(.author.login == "copilot-pull-request-reviewer") | .body' | head -200
gh api repos/<owner>/<repo>/pulls/<PR_NUMBER>/comments --jq '[.[] | select(.user.login == "Copilot") | {path: .path, line: .line, body: .body}]'
```

Each Copilot inline comment counts as a finding. Classify each by your own judgment (Critical / Important / Suggestion) since Copilot doesn't label severity — use the same bar the other reviewers would.

If no Copilot review has appeared yet (it can lag a minute), retry once after 30 seconds. If still nothing, note "Copilot: no review posted" and proceed.

### 7. Adjudicate the findings

**You are the decision maker. Gemini, Codex and Copilot are advisors.**

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
  Claude ✓   Gemini ✓   Codex did not run   Copilot ✓
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
