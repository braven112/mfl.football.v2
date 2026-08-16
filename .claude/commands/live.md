Push the current branch, create a PR, gather reviews from Claude (in-session) plus Gemini, Codex and Copilot (on the PR), auto-approve if all pass, enable auto-merge, then monitor until the PR is merged.

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

### 7. Evaluate review results

Tally findings across ALL FOUR reviewers:

- **Any Critical findings** → present the findings to the user, stop auto-approve, ask: "Fix these before merging?" Do not proceed until user confirms.
- **Important findings only** → summarize them, note they should be addressed soon, but proceed with auto-approve.
- **Suggestions / clean pass** → proceed directly.

**When fixing findings, fix all Critical + Important + Suggestions in one batch** — don't punt suggestions to follow-up. The user expects a clean PR before merge, not a backlog of "should fix soon" notes. Only defer if the user explicitly opts to ship-as-is.

Show a brief summary table:

```
Review Results
─────────────────────────────
Claude:   [Critical: N | Important: N | Suggestions: N]
Gemini:   [Critical: N | Important: N | Suggestions: N]
Codex:    [Critical: N | Important: N | Suggestions: N]
Copilot:  [Critical: N | Important: N | Suggestions: N]
Decision: [Proceeding / Blocked on N critical issue(s)]
```

Use `did not run` rather than `0` for any reviewer that errored or was skipped — a failed reviewer and a clean reviewer must never render identically.

### 7a. Re-review loop after fixes

If you applied fixes for Critical/Important findings, re-run the Claude reviewer on the new commit to confirm:
1. All prior findings are now FIXED
2. No new issues introduced by the refactor

Pushing the fixes re-triggers the external-review workflow and Copilot, so re-fetch both (step 6 and 6a) against the new commit. Loop until all four reviewers are clean OR the user explicitly waives a remaining finding.

### 8. Auto-approve the PR

If no Critical issues from any reviewer:
```bash
gh pr review <PR_NUMBER> --approve --body "Reviewed by Claude Code + Gemini + Codex — no critical issues found. CI must pass before merge."
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
- All Critical/Important findings from Claude, Gemini, Codex, AND Copilot are resolved
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

If CI failed, print the failing check names and tell the user to fix and re-run `/live`.
