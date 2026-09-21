# `getOwnersByPlayer` re-reads and re-scans `rosters.json` on every request

**Raised by:** the `astro-performance-expert` pass on PR #1180 (NFL Brand Book).
**Deferred because:** the fix belongs in a shared util on the AFL homepage's hot
path, not in a brand-pages PR. Growing that PR to touch it would have put an
un-reviewed change to the busiest page in the repo behind a feature merge.

## What

`getOwnersByPlayer` (`src/utils/offseason-hero-data.ts:115`) calls
`readJsonFile` (`:42`), which has no cache: every call does `readFileSync` +
`JSON.parse` on `<dataPath>/mfl-feeds/<year>/rosters.json` (~75 KB TheLeague,
~36 KB AFL) and then scans every franchise's whole roster to build a
league-wide owners-by-player map.

`getPlayerMap` sitting right beside it in `player-map.ts:61` **is** memoized by
year, which is what makes this look like an oversight rather than a decision.

## Who pays

Four callers, all per-request:

- `src/pages/afl-fantasy/index.astro:444` — the AFL homepage
- `src/pages/theleague/rookies-2026.astro:294`
- `src/utils/offseason-hero-data.ts` (×4, internal)
- `src/utils/nfl-club-rosters.ts:89` — new, the Brand Book's 64 club pages,
  each of which discards all but one NFL club's slice of the map it just built

## The fix, and the one thing to be careful about

Memoize by `(year, league, activeOnly)`, mirroring `player-map.ts`.

**The hazard is shared mutation.** A memoized `Map` hands every caller the same
instance, so a caller that mutates the returned map would corrupt it for the
next request. `getPlayerMap` already accepts exactly this trade and documents it
("multiple calls with the same year return the same Map instance"), so the
precedent exists — but the four call sites need checking for mutation before
the cache goes in, not after. That check is the actual work here; the cache is
five lines.

Cheaper alternative if mutation turns out to be a real risk: cache the parsed
`rosters.json` inside `readJsonFile` and leave the map-building per call. That
removes the I/O and the parse, which is the bulk of it, and hands out no shared
mutable structure.
