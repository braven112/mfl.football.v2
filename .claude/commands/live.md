Push the current branch, create a PR, run a code review, auto-approve if the review passes, enable auto-merge, then monitor until the PR is merged.

## Steps

### 1. What's New and Insights

Before anything ships, run both documentation checks:

1. **Run `/update-whats-new`** — evaluates whether the changes need a What's New entry or changelog item and writes it. If a screenshot is still needed, flag it to the user but don't block.

2. **Run `/update-insights`** — reviews what was built and records any learnings to the insight files.

Both checks are lightweight and non-blocking — if nothing needs updating they say so and we move on.

### 2. Verify there's something to push

Run `git status` and `git log main..HEAD --oneline`. If there are no commits ahead of main, tell the user there's nothing to ship and stop.

If there are uncommitted changes, stage and commit them first using the repo's commit style (conventional commits, short imperative subject, Co-Authored-By trailer).

Skip these data sync files when staging — they're noise:
- `data/theleague/live-*`
- `data/theleague/mfl-feeds/`
- `src/data/salary-history/`
- `src/data/theleague/mfl-player-salaries-*`

### 2. Push the branch

```bash
git push -u origin HEAD
```

### 3. Create the PR (or find the existing one)

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

### 4. Run code review

Use the `/code-review` skill to review the diff for this branch. Pass `--comment` so findings are posted as inline PR comments.

If the review surfaces **critical bugs** (not style/nitpick findings), tell the user what was found, stop the auto-approve step, and ask whether to proceed anyway.

### 5. Auto-approve the PR

If the review passed (no critical bugs):
```bash
gh pr review <PR_NUMBER> --approve --body "Reviewed by Claude Code — no critical issues found. CI must pass before merge."
```

### 6. Enable auto-merge

```bash
gh pr merge <PR_NUMBER> --auto --squash
```

This queues the merge — GitHub will execute it automatically once the `Tests` CI check passes.

### 7. Monitor until merged

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

  # Check for failed CI
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

### 8. Report

When the PR is merged, print:
- The PR URL (clickable)
- The squash commit SHA
- "Deployed to main ✓"

If CI failed, print the failing check names and tell the user to fix and re-run `/live`.
