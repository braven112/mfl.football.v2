#!/usr/bin/env bash
# PreToolUse hook: run tests before any git push command via Claude's Bash tool.
# Blocks the push if tests fail so broken code never leaves the machine.
#
# Silent no-op if:
#   - jq isn't available
#   - the Bash command isn't a git push
#   - vitest isn't installed

set -u

command -v jq >/dev/null 2>&1 || exit 0

bash_command=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$bash_command" ] || exit 0

case "$bash_command" in
  *git\ push*) ;;
  *) exit 0 ;;
esac

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_root" || exit 0

if [ ! -x node_modules/.bin/vitest ]; then
  echo "⚠️  vitest not found — skipping pre-push test gate. Run pnpm install first." >&2
  exit 0
fi

echo "Running tests before push…"
node_modules/.bin/vitest run || exit 1
