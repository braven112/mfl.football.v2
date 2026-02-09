#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [max_iterations] [ai_provider]
# Examples:
#   ./ralph.sh 10 gemini
#   ./ralph.sh 10 claude
#   AI_PROVIDER=claude ./ralph.sh 10

set -eo pipefail

MAX_ITERATIONS=${1:-10}
AI_PROVIDER=${2:-${AI_PROVIDER:-gemini}}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
ITERATION_TIMEOUT_SECONDS=${ITERATION_TIMEOUT_SECONDS:-900} # 15 minutes default
MAX_CONSECUTIVE_IDENTICAL_FAILURES=3
CODEX_FLAGS=${CODEX_FLAGS:-}

TIMEOUT_CMD="$(command -v gtimeout || command -v timeout || true)"

# Validate AI provider
if [[ "$AI_PROVIDER" != "gemini" && "$AI_PROVIDER" != "claude" && "$AI_PROVIDER" != "codex" ]]; then
  echo "Error: AI_PROVIDER must be 'gemini', 'claude', or 'codex', got: $AI_PROVIDER"
  exit 1
fi

# Ensure we are inside a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Ralph must be run inside a git repository."
  exit 1
fi

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")
  
  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"
    
    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Enforce branch safety (never operate on main/master; auto-switch/create PRD branch)
PRD_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
if [ -z "$PRD_BRANCH" ]; then
  echo "Error: branchName missing in $PRD_FILE"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$PRD_BRANCH" ]; then
  if git show-ref --verify --quiet "refs/heads/$PRD_BRANCH"; then
    echo "Switching to PRD branch: $PRD_BRANCH"
    git switch "$PRD_BRANCH"
  else
    echo "Creating and switching to PRD branch: $PRD_BRANCH"
    git switch -c "$PRD_BRANCH"
  fi
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
fi

if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "Refusing to run Ralph on $CURRENT_BRANCH. Please use a feature branch (PRD branch: $PRD_BRANCH)."
  exit 1
fi

# Track current branch
echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"
echo "Using AI Provider: $AI_PROVIDER"
if [ -n "$TIMEOUT_CMD" ]; then
  echo "Iteration timeout: ${ITERATION_TIMEOUT_SECONDS}s (using $TIMEOUT_CMD)"
else
  echo "Warning: timeout command not found; iterations will not auto-timeout."
fi

CONSECUTIVE_FAILURES=0
LAST_FAILURE_SNIPPET=""

get_target_story() {
  jq -r '
    .userStories
    | map(select(.passes == false))
    | sort_by(.priority)
    | .[0] // empty
  ' "$PRD_FILE"
}

run_ai_iteration() {
  local prompt_content
  prompt_content=$(cat "$SCRIPT_DIR/prompt.md")
  local ai_cmd=()
  if [[ "$AI_PROVIDER" == "gemini" ]]; then
    ai_cmd=(gemini "$prompt_content" --yolo)
  elif [[ "$AI_PROVIDER" == "claude" ]]; then
    ai_cmd=(claude "$prompt_content" --dangerously-skip-tool-approval)
  else
    # Codex: allow optional flags through CODEX_FLAGS (e.g., auto-approval)
    ai_cmd=(codex "$prompt_content")
    if [ -n "$CODEX_FLAGS" ]; then
      # shellcheck disable=SC2206
      ai_cmd+=($CODEX_FLAGS)
    fi
  fi

  local log_file
  log_file=$(mktemp)
  local exit_code

  set +e
  if [ -n "$TIMEOUT_CMD" ]; then
    "${TIMEOUT_CMD}" "${ITERATION_TIMEOUT_SECONDS}s" "${ai_cmd[@]}" 2>&1 | tee "$log_file"
    exit_code=${PIPESTATUS[0]}
  else
    "${ai_cmd[@]}" 2>&1 | tee "$log_file"
    exit_code=${PIPESTATUS[0]}
  fi
  set -e

  local output
  output=$(cat "$log_file")
  rm -f "$log_file"

  echo "$output"
  return "$exit_code"
}

assert_story_completed() {
  local target_id="$1"
  local target_title="$2"
  if [ -z "$target_id" ]; then
    return 0
  fi
  local passed
  passed=$(jq -r --arg id "$target_id" '
    .userStories
    | map(select(.id == $id))
    | .[0].passes // false
  ' "$PRD_FILE")

  if [[ "$passed" != "true" ]]; then
    echo "Story $target_id ($target_title) still marked as incomplete after iteration."
    return 1
  fi
  return 0
}

for i in $(seq 1 $MAX_ITERATIONS); do
  TARGET_STORY_JSON=$(get_target_story)
  TARGET_STORY_ID=$(echo "$TARGET_STORY_JSON" | jq -r '.id // empty')
  TARGET_STORY_TITLE=$(echo "$TARGET_STORY_JSON" | jq -r '.title // empty')

  if [ -z "$TARGET_STORY_ID" ]; then
    echo "All user stories are already passing."
    exit 0
  fi

  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($AI_PROVIDER) - Target: $TARGET_STORY_ID - $TARGET_STORY_TITLE"
  echo "═══════════════════════════════════════════════════════"

  OUTPUT=$(run_ai_iteration)
  EXIT_CODE=$?

  # Check for completion signal even if exit code is non-zero
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph reported completion."
    exit 0
  fi

  if [ "$EXIT_CODE" -ne 0 ]; then
    FAILURE_SNIPPET=$(echo "$OUTPUT" | tail -n 20 | sed 's/[[:cntrl:]]//g')
    if [ "$FAILURE_SNIPPET" = "$LAST_FAILURE_SNIPPET" ]; then
      CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    else
      CONSECUTIVE_FAILURES=1
    fi
    LAST_FAILURE_SNIPPET="$FAILURE_SNIPPET"
    echo "AI provider exited with code $EXIT_CODE."
    echo "Failure snippet (last 20 lines):"
    echo "$FAILURE_SNIPPET"
    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_IDENTICAL_FAILURES" ]; then
      echo "Encountered the same failure $CONSECUTIVE_FAILURES times. Stopping."
      exit "$EXIT_CODE"
    fi
    echo "Continuing to next iteration (failure count: $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_IDENTICAL_FAILURES)..."
    sleep 2
    continue
  fi

  CONSECUTIVE_FAILURES=0
  LAST_FAILURE_SNIPPET=""

  if ! assert_story_completed "$TARGET_STORY_ID" "$TARGET_STORY_TITLE"; then
    echo "Story guardrail failed: $TARGET_STORY_ID is still open. Stopping to avoid false progress."
    exit 1
  fi
  
  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
