#!/usr/bin/env bash
# PostToolUse hook: run Roger reminder-window tests when Roger-relevant files
# are edited. Blocks the tool via non-zero exit if tests fail so regressions
# surface immediately.
#
# Paths guarded (match = run tests):
#   scripts/schefter-scan.mjs
#   scripts/compute-league-events.mjs
#   scripts/lib/roger-reminder-window.mjs
#   src/data/theleague/league-year-config.ts
#   src/data/theleague/nfl-draft-dates-fetched.json
#   tests/roger-reminder-window.test.ts
#
# Silent no-op if:
#   - the edited file isn't one of the guarded paths
#   - node_modules/.bin/vitest isn't installed (CI clone before install, etc.)
#   - jq isn't available
#
# Stdin: Claude Code hook JSON
# Stdout: vitest output (visible to Claude on failure)
# Exit: 0 = no-op or tests pass, non-zero = tests failed

set -u

command -v jq >/dev/null 2>&1 || exit 0

file_path=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$file_path" ] || exit 0

case "$file_path" in
  */scripts/schefter-scan.mjs \
  | */scripts/compute-league-events.mjs \
  | */scripts/lib/roger-reminder-window.mjs \
  | */src/data/theleague/league-year-config.ts \
  | */src/data/theleague/nfl-draft-dates-fetched.json \
  | */tests/roger-reminder-window.test.ts) ;;
  *) exit 0 ;;
esac

# Resolve repo root from this script's location so the hook runs regardless
# of the caller's cwd.
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_root" || exit 0

[ -x node_modules/.bin/vitest ] || exit 0

# Run only the one fast test file — keeps the feedback loop tight.
exec node_modules/.bin/vitest run tests/roger-reminder-window.test.ts
