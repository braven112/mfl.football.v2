---
slug: schefter-once-per-season-dedupe
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1098
hotfix_sha: 1ec6334
followup_issue: 1100
followup_pr:
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
  `now < nflKickoff(year)`. Before, it always returned `true`.
- `scripts/schefter-retract-post.mjs`: new `--feed-only` flag. It retracted the
  Sept 15 duplicate from the live feed only, because both copies share the id
  `sf_2026_schedule_release_theleague` and the archived original must stay.
- Guard test: `tests/schefter-once-per-season-dedupe.test.ts`.
- The GroupMe message itself can't be deleted by the bot. Brandon removes it manually.

## Deferred items

- [ ] **F1: `appendToFeed` still dedupes against the live feed only**
  - Source: deferred at implementation
  - Where: `scripts/article-utils/feed-writer.mjs` (`appendToFeed`), also used by
    `scripts/schefter-announce.mjs:39` and `scripts/lib/schefter-assistant-post.mjs:27`
  - What: its "belt + suspenders" check doesn't see archived ids. The weekly
    runner is safe because it calls `isDuplicate` first, but the announce and
    assistant lanes rely on `appendToFeed` alone. Decide whether their ids can
    repeat. If they can, route them through the archive-aware check.
  - Why deferred: those lanes use unique ids today and didn't cause this
    incident; widening the check there widens the diff.

- [ ] **F2: A retraction can be undone by a cron that started before it landed**
  - Source: diagnosis during the hotfix
  - Where: `scripts/lib/merge-schefter-feed.mjs:105` (`mergeFeed` unions posts by id)
  - What: `commit-feed-and-push` unions origin's posts with the run's own posts.
    A scan job that checked out before the retraction and pushes after it brings
    the retracted post back. Only posts at or before `archivedThroughTimestamp`
    are protected. Consider a `retractedIds` tombstone list that `mergeFeed`
    filters on.
  - Why deferred: a tombstone changes the feed schema that every writer shares;
    the race window for this one retraction was minutes, and it can be checked
    after merge.

- [ ] **F3: Write the rule into the Schefter rules doc**
  - Source: deferred at implementation
  - Where: `docs/claude/rules/schefter.md`, near the retraction paragraph (~line 273)
  - What: "dedup for once-per-season ids must read the archive" and "retracting
    a re-published duplicate uses `--feed-only`". Add
    `tests/schefter-once-per-season-dedupe.test.ts` to the
    `.claude/hooks/path-guard.json` schefter-columns domain.
  - Why deferred: docs and hook wiring aren't needed to stop the repost.

- [ ] **F4: `--week` skips the kickoff guard for schedule-release**
  - Source: Copilot (suppressed comment on PR #1098, `schedule-release.mjs:64`)
  - Where: `scripts/schefter-weekly-articles.mjs:164` (`opts.week != null ? true : mod.guardSeason(...)`)
  - What: a manual run with `--week` skips `guardSeason`, so it could post the
    preseason column after kickoff if the dedupe also missed. Options: always
    run the guard for types that don't use a week, or reject `--week` for
    `schedule-release`.
  - Why deferred: the cron never passes `--week` for this type, and a manual
    override is deliberate. Not on the path that shipped the duplicate.

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
