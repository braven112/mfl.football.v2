# Claude Session History

> A running log of all Claude Desktop sessions for this project.
> Organized chronologically so future sessions can reference past work.
> Last updated: 2026-03-25

---

## Session 5 — Freeze State & Salary Snapshot Fix (PR #69)

- **Date:** 2026-03-24 (afternoon)
- **Session URL:** https://claude.ai/code/session_01QQVa4BKN8bWQn1TcosBjCe
- **PR:** #69
- **Branch:** merged to master
- **Commit:** `932fff2`

### What was done

Fixed a bug where the salary averages script failed to carry forward freeze state when the league year advanced from 2025 to 2026. The `frozenWeek` / `lockedWeek` was always null during the offseason because the season state file still referenced the previous year. Added cross-year offseason detection with a `carriedFrom` marker that:

- Carries forward the freeze state across the year boundary
- Prevents the safety check from erroneously clearing the freeze
- Auto-clears the carried-forward freeze when real game scores are detected in the new season

### Files modified

- `scripts/update-salary-averages.mjs`
- `src/data/mfl-season-state-theleague.json`

### Key context

- This was a follow-up to Session 4 — the stale Redis fix surfaced this edge case
- The `carriedFrom` property in season state is the key mechanism

---

## Session 4 — Stale Redis & Frozen Roster Fix (PR #68)

- **Date:** 2026-03-24 (morning)
- **Session URL:** https://claude.ai/code/session_01DkYdfNJbvn9HvwVFBTzMmR
- **PR:** #68
- **Branch:** merged to master
- **Commits:** `d141ce0` (3 squashed commits)

### What was done

Three interrelated fixes for data freshness issues:

1. **Await Redis cache refresh on Vercel serverless** — The SWR (stale-while-revalidate) pattern used fire-and-forget background refreshes that never completed because Vercel kills the function after the response is sent. Fixed by awaiting all cache refreshes inline with concurrent request deduplication via an in-flight promise map.

2. **Prevent premature season freeze from stale MFL weeklyResults** — MFL's weeklyResults API returned stale week 17 data from the previous season, causing the salary script to freeze 2026 at week 13 on Feb 26 (locking in a 16-player roster instead of 28). Fixed `detectLatestWeek()` to count only weeks with actual scored matchups, plus a safety check to clear stale freeze state.

3. **Show newly signed/traded players on league-summary** — Players in Redis but not in the static salary file were silently skipped. Now looks up metadata from the raw MFL players feed so newly acquired players appear immediately.

### Files modified

- `scripts/update-salary-averages.mjs`
- `src/data/mfl-season-state-theleague.json`
- League summary page data layer

### Key context

- Root cause: Vercel serverless functions terminate after response — no background work
- The in-flight promise map pattern for deduplication is reusable
- `detectLatestWeek()` now requires actual scored matchups, not just data presence

---

## Session 3 — Trade Alerts, Search Directory, Cut Player (Marathon Session)

- **Date:** 2026-03-23 (afternoon–late night, ~3:30 PM – 11:35 PM)
- **Session URL:** Not recorded in commits (pre-dates session URL convention)
- **Branch:** master (direct commits)
- **Commits:** 19 commits from `f1e0c08` through `7bf2f15`

### What was done

Massive feature session covering multiple major features:

#### Trade Alert System (5 commits)
- `5dd7739` — Core trade alert: nav icon with red badge, modal with player lockups, auto-popup on page load
- `0fb6709` — Empty state modal ("No Pending Trades" with Trade Builder CTA), a11y improvements (role="alert", aria-live="polite")
- `128dc72` — Commissioner trade approval: "Pending Approval" section, Approve/Veto/Dismiss actions, `?commish=1` API param
- `251bc84` — Fixed trade bait auth: `mflFetch()` instead of raw `fetch()` to preserve auth cookies on MFL's 302 redirect
- `e19d7b4` — Cleanup: deleted 4 dead prototype pages, fixed stale tests for mfl-contract-writer and trade-bait-security

#### Search / Page Directory (3 commits)
- `d7d41c4` — Searchable page directory at `/theleague/search` with 15-75 keyword tags per page derived from actual content
- `92bebf6` — Hidden page filtering: pages tagged "hidden" excluded for non-admin users
- `5f4e774` — Renamed "Directory" to "Search" in What's New

#### Cut Player (1 commit)
- `f1e0c08` — Wired up Cut Player button in CDM via MFL's `fcfsWaiver` endpoint with two-click inline confirmation

#### Activity Page Enhancements (2 commits)
- `de12318` — Transaction leaderboard (trades, FA moves, auction wins per owner), sort By Owner by views
- `7bf2f15` — Tightened roster header spacing on desktop

#### Build Skin Skill (3 commits)
- `174f41f` — New `/build-skin` skill for MFL CSS theme generation
- `275c127` — Simplified the skill to match actual workflow (was over-engineered)
- `2336d79` — Added variable promotion workflow for when a value isn't a CSS variable yet

#### Other Fixes (5 commits)
- `ca2d844` — Player age display fix: birthdate wasn't being passed through sub-components
- `4185c07` — Redis roster cache overlay for near-real-time league summary data during auction
- `af7a9cb` — Removed blob migration from contract storage (all data now in Redis)
- `4636238` — Standardized logo to 45px and nav icons to 24px across all pages
- `25a65a0` — Added Dismiss button for pending declarations

### Key context

- MFL auth gotcha: `api.myfantasyleague.com` 302-redirects to `www49`, and Node.js undici strips Cookie headers on cross-origin redirects — must use `mflFetch()` for all authenticated calls
- Cut Player uses MFL's `fcfsWaiver` endpoint (not an obvious name)
- Commissioner trades use `FRANCHISE_ID=0000` to fetch all league trades

---

## Session 2 — Contract Declarations & Fonts

- **Date:** 2026-03-23 (late morning – early afternoon, ~10:45 AM – 1:20 PM)
- **Session URL:** Not recorded in commits
- **Branch:** master (direct commits)
- **Commits:** 6 commits from `7e1288b` through `15195ed`

### What was done

#### Contract Declaration Fixes (4 commits)
- `2dec477` — Enforced contract declaration deadlines server-side, removed confusing strikethrough styling on expired deadlines
- `3caa3ac` — Fixed editorial styling on inline confirm buttons (`:global()` wrapper for dynamically created elements)
- `15195ed` — Used primary (navy) buttons instead of green/red, auto-migrate blob declarations to Redis on cold start, removed manual migration UI
- `25a65a0` — Added Dismiss button for stale pending declarations

#### Astro 6 Upgrade (2 commits)
- `7e1288b` — Upgraded Astro 5.15 → 6.0.8 with Fonts API (self-hosted Vend Sans), queued rendering, `ViewTransitions` → `ClientRouter` rename
- `cd55f26` — Added Font component to all layouts (was only in TheLeagueLayout), added CSS var fallback

### Key context

- Astro 6 renames: `ViewTransitions` → `ClientRouter`
- Font component must be in ALL layouts (root, login, league) or `--font-vend-sans` is undefined
- Contract data fully migrated from Vercel Blob to Redis — no more blob references

---

## Session 1 — Activity Page & Initial Setup

- **Date:** 2026-03-23 (morning, ~10:18 AM – 10:28 AM)
- **Session URL:** Not recorded in commits
- **Branch:** master (direct commits)
- **Commits:** 2 commits `2e40c86` and `4b3aaf4`

### What was done

- `2e40c86` — Added `color` field to all 16 teams in `theleague.config.json` as canonical source for chart colors, updated `team-colors.ts` to read from config
- `4b3aaf4` — Switched nav/What's New icon from "goals" to "activity" (dedicated sprite), replaced placeholder screenshot

### Key context

- Team colors are now in `theleague.config.json`, not hardcoded in `team-colors.ts`
- This was likely the start of the Owner Activity page feature

---

## Session Index (Quick Reference)

| # | Date | Session ID | Summary | PR |
|---|------|-----------|---------|-----|
| 5 | 2026-03-24 PM | `session_01QQVa4BKN8bWQn1TcosBjCe` | Freeze state carry-forward fix | #69 |
| 4 | 2026-03-24 AM | `session_01DkYdfNJbvn9HvwVFBTzMmR` | Stale Redis + frozen roster fix | #68 |
| 3 | 2026-03-23 PM | _(not recorded)_ | Trade alerts, search, cut player, build-skin | — |
| 2 | 2026-03-23 midday | _(not recorded)_ | Contract declarations, Astro 6 upgrade | — |
| 1 | 2026-03-23 AM | _(not recorded)_ | Activity page colors & icons | — |

---

## Searchable Tags

`trade-alert` `trade-bait` `mflFetch` `auth-cookie` `302-redirect` `commissioner`
`cut-player` `fcfsWaiver` `page-directory` `search` `hidden-pages` `admin-only`
`build-skin` `scss` `css-variables` `variable-promotion`
`contract-declarations` `deadline-enforcement` `blob-to-redis` `migration`
`astro-6` `fonts-api` `vend-sans` `ClientRouter` `queued-rendering`
`redis-cache` `SWR` `serverless` `in-flight-promise` `deduplication`
`salary-averages` `freeze-state` `carriedFrom` `detectLatestWeek` `offseason`
`team-colors` `theleague-config` `activity-page` `transaction-leaderboard`
`player-age` `birthdate` `logo-size` `nav-icons` `inline-confirm`

---

## How to Use This File

- **Lost a session?** Search the Session Index table or Searchable Tags above
- **Need context for a bug?** Check the "Key context" sections — they capture gotchas and patterns
- **New session?** Add an entry at the top following the template above
- **Session URLs** are now included in git commit messages (started with Sessions 4 & 5)
