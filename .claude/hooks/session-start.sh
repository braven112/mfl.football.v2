#!/usr/bin/env bash
# SessionStart hook: make sure the session has working dependencies.
#
# WHY THIS EXISTS. A cloud session (claude.ai/code, GitHub Actions, any fresh
# container) clones the repo and nothing else — there is no node_modules. Two
# safety nets are quietly load-bearing on its presence:
#
#   1. .claude/hooks/pre-push-check.sh runs the suite before a push. Without
#      vitest it used to warn on stderr and exit 0, so the 2026-09-08 roster
#      hotfix was pushed with no gate at all and nobody noticed. It now blocks
#      instead, which is only tolerable because this hook makes the block rare.
#   2. .claude/hooks/path-guard.mjs runs a domain's guard tests on every edit.
#      CLAUDE.md notes a missing node_modules is its ONE silent-skip case.
#
# So an uninstalled session is one whose two mechanical memories are both off.
#
# Runs synchronously: the point is that the deps exist before any work starts,
# and the install is ~20s and cached in the container image afterwards. It
# no-ops in milliseconds once they are present, which is every local session.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}" || exit 0

# Idempotent: vitest is the binary both safety nets actually need, so its
# presence is the honest check — a node_modules/ directory can exist and still
# be a half-finished install.
if [ -x node_modules/.bin/vitest ]; then
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "⚠️  session-start: pnpm not on PATH — dependencies not installed." >&2
  echo "   The pre-push test gate and the path-guard edit hook will not run." >&2
  exit 0
fi

echo "Installing dependencies (no node_modules in this clone)…" >&2

# Plain `pnpm install`, not `--frozen-lockfile`: the container caches the
# result, and a lockfile drift should not leave a session with no test runner.
if pnpm install >&2; then
  echo "✅ Dependencies installed — pre-push gate and path-guard are live." >&2
else
  echo "‼️  pnpm install failed. Tests, the pre-push gate and path-guard will" >&2
  echo "   not run until it succeeds. Try 'pnpm install' manually." >&2
fi

# Never block a session on this: a failed install is a degraded session, not an
# unusable one.
exit 0
