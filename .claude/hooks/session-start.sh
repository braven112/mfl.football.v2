#!/usr/bin/env bash
# SessionStart hook: prepare a Claude Code on the web container.
#
# A cloud session starts from a fresh clone: no node_modules, no .env.local.
# That is not just "slow first command" — it silently DISABLES this repo's two
# safety nets, because both bail out when vitest is missing:
#   .claude/hooks/pre-push-check.sh    (test gate before every git push)
#   .claude/hooks/roger-reminder-test.sh (Roger reminder-window regression gate)
# So a cloud session could push untested code and never see a gate fire.
#
# Local sessions already have both, so this is a no-op outside the web.
#
# Never exits non-zero: a failed env pull must not block the session from
# starting. Failures are reported to the transcript instead.

set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo_root" || exit 0

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
if [ -x node_modules/.bin/vitest ]; then
  echo "session-start: node_modules already present."
else
  echo "session-start: installing dependencies with pnpm…"
  # --frozen-lockfile so a drifted package.json can't leave a dirty worktree.
  if ! pnpm install --frozen-lockfile 2>&1 | tail -5; then
    echo "session-start: frozen install failed, retrying unfrozen…"
    pnpm install 2>&1 | tail -5 || echo "session-start: WARNING pnpm install failed — test gates are OFF."
  fi
fi

# ---------------------------------------------------------------------------
# 2. Environment (.env.local)
# ---------------------------------------------------------------------------
# astro.config.ts hydrates process.env from .env/.env.local at startup. Without
# it the dev server mints a random JWT secret per restart (forged auth cookies
# don't survive) and every Upstash/KV write path 503s, so drafts, /ri and /cr
# cannot be verified end to end.
#
# IDs below are not secrets — only VERCEL_TOKEN is, and it comes from the
# environment settings on claude.ai. Without that token this step is skipped
# and the session still works for anything that doesn't need real env.
export VERCEL_ORG_ID="${VERCEL_ORG_ID:-team_9LcVP5jcAzXq3kKEZKU4qM84}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_Ab677jUnJXlKpHmVLaAYeJIbdG9E}"

if [ -s .env.local ]; then
  echo "session-start: .env.local already present."
elif [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "session-start: VERCEL_TOKEN not set — skipping 'vercel env pull'."
  echo "session-start: dev server auth + KV writes will NOT work this session."
  echo "session-start: see docs/claude/rules/cloud-environment.md to enable."
else
  echo "session-start: pulling development env from Vercel…"
  if pnpm dlx vercel@latest env pull .env.local \
       --environment=development --yes --token="$VERCEL_TOKEN" >/dev/null 2>&1; then
    echo "session-start: .env.local pulled ($(grep -c '=' .env.local 2>/dev/null || echo 0) vars)."
  else
    echo "session-start: WARNING 'vercel env pull' failed (expired token?)."
    echo "session-start: dev server auth + KV writes will NOT work this session."
  fi
fi

exit 0
