#!/usr/bin/env bash
# PreToolUse hook: run the test suite before any `git push` issued through
# Claude's Bash tool. Blocks the push if tests fail, so broken code never
# leaves the machine.
#
# THIS IS NOT A GIT HOOK. It is wired in .claude/settings.json under
# PreToolUse/matcher "Bash" and receives the tool payload on stdin; it never
# lives at .git/hooks/pre-push, and looking for it there (or for
# core.hooksPath) will always come up empty. That mis-reading cost a session
# during the 2026-09-08 roster outage follow-up.
#
# FAIL CLOSED. "The tests are not installed" and "the tests passed" must not be
# the same outcome for a gate. Until 2026-09-08 a missing vitest printed a
# warning to stderr and exited 0 — and since a fresh cloud clone has no
# node_modules at all, that made this gate a silent no-op in exactly the
# sessions that most needed it. A push with no deps now BLOCKS (exit 2).
# .claude/hooks/session-start.sh installs the deps so it rarely comes up.
#
# A failing suite now blocks too. It always CLAIMED to ("Blocks the push if
# tests fail"), but it ended `vitest run || exit 1`, and only exit 2 blocks a
# Claude Code tool call — any other non-zero code is a NON-blocking error, so
# the push went through regardless. CLAUDE.md's "pre-existing failures are OK"
# policy is honored by the escape hatch below, not by the gate being quietly
# off.
#
# Deliberate escape hatch: SKIP_PRE_PUSH_TESTS=1 skips the gate. Skipping
# should be a decision someone makes, not something that happens quietly.
#
# Exit codes are Claude Code's, not the shell's usual meanings:
#   0 = allow the tool call    2 = block it, stderr goes back to Claude

set -u

payload=$(cat)

# Read the command out of the payload. jq preferred; node is the fallback so a
# machine without jq is not silently ungated. If NEITHER exists we cannot tell
# a push from an `ls`, and blocking every Bash call is worse than the gap —
# that is the one case that still exits 0.
if command -v jq >/dev/null 2>&1; then
  bash_command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  bash_command=$(printf '%s' "$payload" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        process.stdout.write(String(JSON.parse(s)?.tool_input?.command ?? ""));
      } catch {
        process.stdout.write("");
      }
    });
  ' 2>/dev/null)
else
  echo "⚠️  pre-push gate: neither jq nor node available; cannot inspect the command." >&2
  exit 0
fi

[ -n "$bash_command" ] || exit 0

# Match a real INVOCATION, not the words appearing anywhere in the payload.
# A plain `case ... in *git push*` fires on any command that merely MENTIONS it —
# a heredoc writing documentation about this very hook is enough, and it was
# (this file's own rewrite tripped it). Harmless when the gate exited 0
# silently; now that it blocks, a false positive costs a full suite run and a
# dead command. So the phrase has to start a line or follow a shell separator.
printf '%s' "$bash_command" \
  | grep -Eq '(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+push([[:space:]]|$)' \
  || exit 0

# Escape hatch, read from the COMMAND TEXT and not only the environment: hooks
# are spawned by Claude Code, not by the shell running the command, so an
# inline `VAR=1 <cmd>` never reaches this process. Writing
# `SKIP_PRE_PUSH_TESTS=1 git push …` reads naturally AND is visible here, which
# is what makes the hatch usable from inside a session at all. The env check
# stays for anything invoking this script directly.
case "$bash_command" in
  *SKIP_PRE_PUSH_TESTS=1*)
    echo "⏭️  SKIP_PRE_PUSH_TESTS=1 — pushing without running the suite." >&2
    exit 0
    ;;
esac

if [ "${SKIP_PRE_PUSH_TESTS:-}" = "1" ]; then
  echo "⏭️  SKIP_PRE_PUSH_TESTS=1 — pushing without running the suite." >&2
  exit 0
fi

repo_root=$(cd "$(dirname "$0")/../.." && pwd) || exit 0
cd "$repo_root" || exit 0

if [ ! -x node_modules/.bin/vitest ]; then
  cat >&2 <<'MSG'
⛔ Pre-push gate BLOCKED: vitest is not installed, so the suite cannot run.

   An ungated push is what this hook exists to prevent, so a missing test
   runner blocks rather than passes silently.

   Fix it:      pnpm install
   Or override: SKIP_PRE_PUSH_TESTS=1 git push -u origin <branch>
MSG
  exit 2
fi

echo "Running tests before push…"
node_modules/.bin/vitest run || exit 2
