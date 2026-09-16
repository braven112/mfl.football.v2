---
slug: retraction-archive-shard-race
status: open
severity: P2
opened: 2026-09-16
source_pr: https://github.com/braven112/mfl.football.v2/pull/1109
source_finding: Codex, Important #1
followup_issue:
followup_pr:
---

# Follow-up: a retracted post can still be resurrected into an archive shard

## The gap

PR #1109 made retraction race-proof for the LIVE feed: the retract script writes
a `retractedIds` tombstone, `mergeFeed` unions it across both sides of a push and
filters posts by it, so a scan job holding a pre-retraction checkout can no
longer push the post back.

**Archive shards are not covered.** `mergeByPath`
(`scripts/lib/merge-schefter-feed.mjs`) only reconciles files matching
`schefter-feed.json$` or `post-history.json$`; everything else — archive shards
included — is returned as `oursText`, verbatim:

```js
const isHistory = /post-history\.json$/.test(filePath);
const isFeed = /schefter-feed\.json$/.test(filePath);
if (!isHistory && !isFeed) return oursText; // take ours verbatim
```

## The interleaving

1. The weekly archiver (`scripts/archive-schefter-feed.mjs`) checks out.
2. A retraction lands on main: the post is removed from the live feed and from
   every archive shard, and the tombstone is written.
3. The archive job commits. Its shard came from the stale checkout, so it is
   written back **with the retracted post still in it**.

The live feed stays clean. The archive does not.

## Why that matters

Both archive read paths resolve a post by id and will find it again:

- `src/pages/theleague/news/[id].astro:46` — falls back to
  `import.meta.glob('.../schefter-archive/*.json')` when the id is not in the
  live feed.
- `src/utils/schefter-og.ts:132` — `findSchefterPost` checks `getFeedIndex`
  then `getArchiveIndex`.

So a post retracted because it was WRONG about a real owner's roster — the
reason this script exists — can still render at its permalink and in its OG
card.

## Why it was deferred out of #1109

The tombstone lives on the feed object; an archive shard is frequently a bare
array with nowhere to carry one, and `mergeByPath` handles one file at a time
with no access to the sibling feed's tombstones. Every fix therefore changes the
archive-merge contract rather than adding a filter, which is a different blast
radius from the PR it was found in. The window is also narrow: the archiver is
weekly and retraction is hand-run, so they have to overlap.

## Options to weigh

1. **Teach `mergeByPath` about archive shards.** Give it the sibling feed's
   `retractedIds` (derivable from the shard's own path — the feed sits one
   directory up) and filter. Fixes it at the same boundary the live feed is
   fixed at, which is the consistent answer.
2. **Filter at READ time.** Have both archive readers drop ids in the feed's
   `retractedIds`. Smaller and it also covers a shard that was already
   committed dirty — but it is two more call sites that must not be forgotten,
   and a third reader added later silently reopens the hole.
3. **Re-run the retraction after the archiver.** What the script's header
   currently tells an operator to do. Correct but manual, and it depends on
   somebody remembering.

Option 1 is the one that matches how the live feed is already protected; option
2 is worth doing as well if the read paths are the only consumers.

## Context to start cold

- `retractedIds` is on `SchefterFeed` (`src/types/schefter.ts`) and is unioned,
  never replaced — a stale runner has the shorter list.
- Every feed writer in the repo spreads the parsed object
  (`{ ...feed, posts }`), so the key survives all of them, the archiver
  included (`planArchive` returns `{ ...feed, ... }`). Verified in #1109.
- `tests/merge-schefter-feed.test.ts` holds the tombstone behaviour;
  `tests/schefter-once-per-season-dedupe.test.ts` holds the retract script's
  half and the dedup's.
- `scripts/article-utils/feed-writer.mjs#isPublished` already treats a
  tombstoned id as published, so nothing will regenerate the post — this is
  purely about a copy that is already on disk.
