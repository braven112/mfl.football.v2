# CLAUDE.md

Guidance for Claude Code sessions working in this repo. Keep this short; add
entries for gotchas that have bitten us and would bite a future session too.

## Project basics

- **Framework:** Astro (SSR + SSG). React for client-hydrated islands.
- **Package manager:** pnpm (not npm). Scripts: see `package.json`.
- **Unit tests:** vitest. Run one file: `pnpm vitest run path/to/foo.test.ts`.
- **Prebuild:** `scripts/prebuild.mjs` runs build steps + network fetches in
  parallel. Add new build-time fetches there.

## Feature flags — code, not GitHub Actions variables

Do not introduce new `vars.*` references in workflows as feature gates
(`SCHEFTER_FOO_ENABLED`, etc.). Editing a GitHub variable is never easier
than editing code in this repo, and the indirection just splits the
source of truth across two places. To disable a scheduled job, comment
out (or delete) its `cron:` line. To gate behavior, use a `const` in the
script itself.

A few legacy vars predate this rule (`SCHEFTER_RUMOR_MILL_ENABLED`,
`SCHEFTER_TRADE_OFFER_RUMORS_ENABLED`). Don't add more, and prefer
moving the existing ones into code if you're already touching the file.

## Roger date-handling gotchas

There are **two** independent code paths named "Roger". Both have hallucinated
event dates in the past. Fixing one does not fix the other.

1. **Ask Roger (rules Q&A chatbot)** — `src/pages/api/rules-qa.ts`. LLM-backed.
   The system prompt is split into two blocks: a static cached block with the
   constitution, and a per-request block that injects today's Pacific-Time
   date. **Never remove the date block**, and keep it in a separate system
   array entry so the constitution block stays cache-eligible.

2. **GroupMe reminder poster** — `scripts/schefter-scan.mjs`. Template-based,
   not LLM. Fires at 14d / 7d / 2d / day-of touches before major events. Two
   rules that MUST hold:

   - The reminder window is asymmetric: fire on the target day or one day
     late, **never early**. The shared helper is
     `scripts/lib/roger-reminder-window.mjs#shouldFireReminder`. Don't
     reinvent it inline — `tests/roger-reminder-window.test.ts` locks it in.

   - `event.daysUntil` must be a calendar-day diff (midnight-to-midnight),
     not `Math.ceil` of a timestamp delta. Use
     `scripts/lib/roger-reminder-window.mjs#calendarDaysUntil`. `Math.ceil`
     on a sub-day delta rounds "tomorrow evening" up to 1 and combines with
     a permissive window to post "TODAY" a day early.

Historical note: both bugs fired together in April 2026 — Roger posted
"TODAY: NFL Draft" on Wednesday when the draft was Thursday. The post-mortem
is the reason this section exists.

## NFL Draft date source of truth

- **Authoritative:** `src/data/theleague/nfl-draft-dates-fetched.json` —
  populated by `scripts/fetch-nfl-draft-date.mjs` (ESPN core API) during
  prebuild. This file wins.
- **Fallback:** hand-maintained `HARDCODED_OVERRIDES` in
  `src/data/theleague/league-year-config.ts`. Used when the fetched JSON has
  no entry for a year (offline builds, new year not yet announced).
- **Consumers:** `league-year-config.ts` merges both. `compute-league-events.mjs`
  reads the dates to produce `resolved-events.json`, which the schefter-scan
  reads to decide which reminders to fire.

Never hardcode a draft date in a third place — update the fetched JSON or the
fallback config.

## Edit-time safety net

`.claude/settings.json` runs `.claude/hooks/roger-reminder-test.sh` on every
Write/Edit/MultiEdit to any Roger-related file. The hook runs the
reminder-window vitest suite and blocks the tool call if it fails. If you
edit one of those files and don't see a test run, `node_modules` probably
isn't installed — run `pnpm install`.

## Daily audit

`.github/workflows/roger-date-audit.yml` runs daily. It runs the reminder-
window tests and fetches the ESPN draft date; if ESPN disagrees with the
committed `nfl-draft-dates-fetched.json`, the workflow fails so the drift
surfaces in the Actions tab. To accept a new date, run
`pnpm fetch:nfl-draft-date` locally and commit the change.

## Merge conflicts — always rebase, resolve autonomously

Only Brandon and Claude commit to this repo, and conflicts are almost
always one of three patterns. **Default to `git rebase origin/main` (never
merge).** Do not stop and ask before resolving — fix it, run the relevant
tests, push, and report what you did.

Resolution rules by file pattern:

1. **`package.json`** — union both sides. New deps from main + new deps
   from the branch should both end up in the file. `.gitattributes`
   declares `merge=union` so this happens automatically; if union picks
   up duplicate entries (same key on both sides), drop the older version
   spec and keep the newer.
2. **`pnpm-lock.yaml`** — never hand-resolve. After `package.json` settles,
   run `pnpm install` to regenerate the lock; commit the regenerated file
   as part of the resolution.
3. **Auto-generated data files** (`src/data/theleague/schefter-feed.json`,
   `data/<league>/mfl-feeds/**`, `src/data/theleague/post-history.json`,
   any `*-feed.json` or `*.lock`) — prefer `--theirs` (incoming main).
   These are written by cron jobs; the branch's snapshot is stale by
   definition. Do not try to merge content row-by-row.
4. **Source code (`scripts/`, `src/`, `tests/`)** — read both sides,
   integrate the intent. New imports / new helpers stack additively. If
   the same function body changed on both sides, keep main's structural
   change and re-apply the branch's behavioral change on top. Run
   `pnpm test:unit` (or the targeted test file) after every non-trivial
   resolution.
5. **CLAUDE.md / docs** — additive. Both sides' new sections survive,
   reordered if needed. Never drop a section.

After every resolution, before pushing:
- `pnpm test:unit` must pass at the same baseline as pre-rebase (compare
  failure count — pre-existing failures are OK; new failures block).
- `node --check` every `.mjs` you touched.
- Force-push with lease: `git push --force-with-lease`. Never plain
  `--force` on a shared branch.

`git rerere` is enabled (see `.git/config`); identical conflicts on
re-rebase replay automatically. Do not turn it off.
