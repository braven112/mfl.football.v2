---
slug: schefter-once-per-season-dedupe
status: shipped
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1098
hotfix_sha: 1ec6334
followup_issue: 1100
followup_pr: PLACEHOLDER_PR
followup_shipped: 2026-09-15
followup_session:
---

# Follow-up: Schefter re-posted the 2026 schedule release mid-season

## What broke

On 2026-09-15 at 20:48 UTC, Schefter posted TheLeague's 2026 schedule-release column to
GroupMe again, six days after NFL kickoff (Wed Sep 9). The real column had gone
out on Aug 23 (`d4dca5080e`). The duplicate is commit `b2a588f8c5`.

## What the hotfix did

Forward fix, PR #1098.

- `scripts/article-utils/feed-writer.mjs`: `isDuplicate` now also reads every
  `schefter-archive/*.json` shard beside the feed, and **fails closed** when a
  shard can't be parsed. Before, it read only the live feed. The weekly archiver
  (`scripts/archive-schefter-feed.mjs`, 300-post cap) had moved the Aug 23 post
  into `src/data/theleague/schefter-archive/2026.json` at 14:57 UTC, so the
  18:00 cron read it as never posted.
- `scripts/article-types/schedule-release.mjs`: `guardSeason` now returns
  `now < nflWeekStartInstant(year, 1)`, the exact kickoff instant. Before, it
  always returned `true`. It is deliberately NOT the local-midnight `nflKickoff()`,
  which on a UTC GitHub runner cuts off at 5pm PT the day before kickoff (Copilot
  caught this on the PR).
- `scripts/schefter-retract-post.mjs`: new `--feed-only` flag. It retracted the
  Sept 15 duplicate from the live feed only, because both copies share the id
  `sf_2026_schedule_release_theleague` and the archived original must stay.
- Guard test: `tests/schefter-once-per-season-dedupe.test.ts`.
- The GroupMe message itself can't be deleted by the bot. Brandon removes it manually.

## Deferred items

All four re-validated against `origin/main` on 2026-09-15 before any code was
written. **All four were still true; none were dropped.** Post-merge review
comments on #1098 were checked — Gemini/Copilot/CodeQL added nothing after the
merge, and the two Copilot findings that predate it were already resolved in
the PR's own follow-up commits.

- [x] **F1: `appendToFeed` still dedupes against the live feed only** — WORKED,
  and it was live rather than latent. `sf_announce_dark-mode` (TheLeague) and
  `sf_announce_dark-mode-afl` had ALREADY rotated into their 2026 archive
  shards, so re-running either slug would have written a second feed post and
  fired GroupMe again — the incident shape, with a chat ping. The script's own
  header claimed "an accidental re-run cannot double-ping the chat"; that claim
  was false and nobody had edited the script.

  Fix: `isDuplicate` and `appendToFeed` now share ONE check (`isPublished`), so
  the archive half cannot be present on one path and missing on the other. The
  brief's "decide whether their ids can repeat" resolved differently per lane:
  - **Announce** — slugs are hand-chosen and never repeat. Archive-aware is
    simply correct.
  - **Assistant** — `assist_<league>_<fid>_<kind>_w<week>` carried NO season, so
    ids repeat every year. Applying the archive check to that id as-written
    would have been the opposite bug: 2027's week-5 lineup warning permanently
    suppressed because 2026's had archived. So the id is season-scoped first
    (`..._<year>_w<week>`, and it throws rather than defaulting a year), which
    makes the shared check sound for that lane too. Free to change — zero
    assistant posts exist in either league's feed or archive yet.

  The archive read is memoized per feed path (the assistant lane appends in a
  sequential per-franchise loop and would otherwise re-parse a ~1 MB shard 24
  times). A rejection is cached too, keeping the fail-closed behaviour.

- [x] **F2: A retraction can be undone by a cron that started before it landed**
  — WORKED, with the `retractedIds` tombstone the brief proposed. `mergeFeed`
  unions both sides' lists (never replaces: a stale runner has the SHORTER one)
  and filters posts by the union, so it is correct under any interleaving.
  `schefter-retract-post.mjs` writes the tombstone onto the live feed only —
  archive shards may be bare arrays with nowhere to keep it — and writes it even
  when the run removed no rows, so a re-run re-asserts the bar. Not conditioned
  on `--feed-only`: the duplicate case is exactly the one that needs it.
  The schema change turned out additive and cheap, contrary to the deferral note.

  NOT done: the Sept 15 duplicate was not retroactively tombstoned. Its race
  window closed hours before this branch existed and the post is gone from
  origin; editing a cron-written data file to add a tombstone nobody needs would
  only invite a merge conflict.

- [x] **F3: Write the rule into the Schefter rules doc** — WORKED. New
  `### Dedup for a long-lived id must read the ARCHIVE, not just the feed`
  section in `docs/claude/rules/schefter.md`, plus the tombstone rule and the
  `--feed-only` rule folded into the existing retraction paragraph.
  `tests/schefter-once-per-season-dedupe.test.ts` is wired into the
  `schefter-columns` path-guard domain (and, with
  `tests/merge-schefter-feed.test.ts`, into `schefter`). The CLAUDE.md router
  row for Schefter already exists and already points at that doc.

- [x] **F4: `--week` skips the kickoff guard for schedule-release** — WORKED,
  by a third route rather than either option in the brief. `--week` now waives
  `guardSeason` only for a type whose id actually VARIES by week, derived from
  `config.id` rather than declared per type — a flag is one more thing to forget,
  and the id function already knows the answer. That covers `schedule-release`
  and, for free, the other four types `--week` means nothing to
  (`championship-recap`, `cut-watch`, `draft-grades`, `team-grades`). Nothing
  legitimate is blocked: the two truly manual-only types return `true`
  unconditionally, and the other two have guards that should hold. The
  classification for all ten types is pinned in the guard test, so an id change
  that reclassifies one fails rather than silently changing behaviour.

## What the incident actually taught

Nobody edited `schefter-announce.mjs`, its doc, or its tests — and both of its
documented safety properties still stopped being true. A different subsystem
(retention, added later) gained the right to move posts out of the file the
idempotency claim was standing on. The claim had been written down as a property
of the SEEDER when it was really a property of the DEDUP.

So: of any "re-running this is a no-op" claim, ask *no-op against what, and who
else is allowed to empty it?* Recorded in
`docs/claude/insights/features/schefter-announce.md`.

## Verification

- `pnpm test:unit` — 462/463 suites pass. The one failure,
  `tests/season-ledger.test.ts` (`theleague 0001 2026 diverged`), reproduces on
  a clean `origin/main` worktree and touches no file in this diff: it is the
  roster-sync cron's live-season data drifting between
  `franchise-history.json` and `season-ledger.json`. Pre-existing, reported
  separately.
- Each new guard was confirmed RED against the pre-fix code before being kept.
- `node --check` on all seven edited `.mjs` files.

## Context to start cold

- Other once-per-year ids share the risk and are now covered by the same
  `isDuplicate`: `draft-grades`, `team-grades`, `championship-recap` (all run by
  hand). Weekly lanes use per-week ids.
- The AFL's `sf_2026_schedule_release_afl` was still #254 of 300 in its live
  feed at hotfix time, so it would have re-posted the next time it rotated out.
  Both fixes cover it.
- `getSeasonYear()` in `scripts/article-utils/week-resolver.mjs` returns the
  calendar year from February on, so the kickoff guard compares against this
  season's kickoff all offseason. In January it compares against the previous
  season's kickoff and refuses, which is fine because no release happens in
  January.
- The retract script (without `--feed-only`) removes an id from the feed AND
  every archive shard. Running it by id on a duplicate would also delete the
  original.
