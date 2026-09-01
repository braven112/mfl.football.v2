# Cloud environment (Claude Code on the web)

Rules for sessions running in the **remote** container (claude.ai/code, the
desktop app's cloud sessions, GitHub-triggered runs) rather than on Brandon's
machine. Everything here is a difference from local, and every difference has
bitten or would have.

Detect it with `CLAUDE_CODE_REMOTE=true` — the env var is set in the container
and absent locally.

## The container starts empty, and that turns the safety nets OFF

A cloud session is a fresh clone. No `node_modules`, no `.env` / `.env.local`.
The dangerous part is not slowness, it's silence: **both of this repo's test
gates no-op when vitest is missing, by design.**

| Gate | File | Bails when |
|---|---|---|
| Pre-push test gate | `.claude/hooks/pre-push-check.sh` | `node_modules/.bin/vitest` absent → prints a warning to stderr and `exit 0` |
| Roger reminder gate | `.claude/hooks/roger-reminder-test.sh` | same |

Those bail-outs are correct for a CI clone, but they meant every cloud session
could edit Roger's reminder window and push, with neither gate ever firing.
`.claude/hooks/session-start.sh` (SessionStart, registered in
`.claude/settings.json`) is what closes that hole — it installs dependencies
before the session gets control, so the gates are live.

**Consequence to expect:** pushing from a cloud session now runs the full unit
suite first, exactly like local. That is the point; don't route around it.

Measured in the container: 290 files / 7452 tests / **~55s**. The pre-push hook
is registered with `timeout: 300` for that reason — a ~5x margin. At the old
120s a slower or colder container could push the suite past the limit, and a
hook *timeout* does not look like a test failure: the push dies without naming
a broken test. If that ever happens again, check the hook timeout before
hunting for one.

## The SessionStart hook

`.claude/hooks/session-start.sh` runs **synchronously** at session start and
does two things, both idempotent, both no-ops when `CLAUDE_CODE_REMOTE` is
unset:

1. `pnpm install --frozen-lockfile` (falls back to an unfrozen install).
   `--frozen-lockfile` so a drifted `package.json` can't hand the session a
   dirty worktree it didn't create.
2. `vercel env pull .env.local --environment=development`, **only if
   `VERCEL_TOKEN` is set**.

It never exits non-zero. A failed env pull must not stop the session from
starting — it warns instead, and the warning lands in the transcript so the
session knows what it does not have.

Synchronous, not async: async saves a few seconds of startup but reintroduces
the exact race the hook exists to remove (a test run that beats the install).
Install is ~13s from cold; that is not worth a race.

## Environment variables — set on the environment, not in the repo

Set these in the environment's settings on claude.ai (Settings → the
environment used by these sessions). They reach the container as real env vars.

| Variable | Without it | Secret? |
|---|---|---|
| `VERCEL_TOKEN` | No `.env.local`. Dev server mints a **random JWT secret per restart**, so forged auth cookies don't survive one; every Upstash/KV write path 503s. `/verify` and `/dev` can't check anything auth- or KV-shaped — drafts POST, `/ri`, `/cr`, rankings sync. | **Yes** |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Nothing — the hook hardcodes them as defaults. | No |
| `GEMINI_API_KEY` | `scripts/gemini-ask.mjs` is dead, so bulk-context questions fall back to reading the corpus in-session — precisely the cost CLAUDE.md added it to avoid. Quota is shared with `pr-external-review.yml`. | Yes |
| `MFL_USERNAME` / `MFL_PASSWORD` / `MFL_API_KEY` / `MFL_USER_ID` | Reads work anonymously; no MFL **write** path can be exercised (lineups, contracts, trade block, waiver order). | Yes, and they mutate the live league |
| `ANTHROPIC_API_KEY` | Schefter/Roger generation scripts can't run. | Yes |
| `GROUPME_*` | Reminder/broadcast send paths can't be exercised end to end. | Yes |

`.vercel/` is gitignored and absent in a fresh clone, so the hook passes
`VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` through the environment rather than
running `vercel link`. Neither ID is a secret.

## What is already fine — don't re-diagnose it

Verified in the container, so no environment change is needed for any of it:

- **Egress is open.** MFL (`api.myfantasyleague.com`, the `wwwNN` hosts, 302
  redirects intact), ESPN, npm, Vercel, the Gemini API host all answer.
  A bare `https://api.myfantasyleague.com/` returns **403 from MFL itself, not
  from the proxy** — a real API path returns 200. Don't read that 403 as an
  egress-policy block; check a real path before reporting one.
- **The full repo is there**, including `data/` (173 MB) and `src/data/` (13 MB).
- **Chromium + Playwright** are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
  Never run `playwright install`; the `/verify` screenshot flow works as written.
- **Node 22 + pnpm 10**, and git push credentials for `braven112/mfl.football.v2`.
- **MCP servers**: GitHub, Vercel, Gmail, Drive. `gh` CLI is NOT available —
  use the `mcp__github__*` tools.

## Repo scope

GitHub access is scoped per session, and these sessions get
`braven112/mfl.football.v2` only. Another repo needs `add_repo` mid-session,
or it must be granted at https://claude.ai/admin-settings/claude-tag.
