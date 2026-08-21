# Set Lineup — reading a submitted lineup, and MFL's soft failures

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Set Lineup — reading a submitted lineup, and MFL's soft failures

Both lineup pages (`src/pages/theleague/lineup.astro`,
`src/pages/afl-fantasy/lineup.astro`) SSR ~9 live MFL calls per view, and a
week switch is a full page reload. Three things that bit us (owner report,
2026-08-18: "future weeks show no players one week and only numbers another"):

- **`myStarters` is an IMPORT type, not an export.** Both pages read the
  owner's saved lineup with `export?TYPE=myStarters`; MFL answers every one
  of those with `Invalid Data Type (myStarters)`, and a bare `catch` swallowed
  it — so the pages had NEVER shown a submitted lineup, silently rendering an
  optimal-by-projection fill instead. The readable counterpart is
  `export?TYPE=weeklyResults&W=<week>`: it carries each franchise's `starters`
  CSV (plus `player[]` rows with `status: 'starter'`) as soon as a lineup is
  saved, for FUTURE weeks too, and unauthenticated. `W=YTD` carries every week
  of the season in one payload with identical `starters`, so it covers a
  week-scoped call that FAILED — not one that answered "no lineup", which is
  already the answer. `resolveWeekLineup` owns that ladder, and the committed
  `weekly-results-raw.json` sits under both as ONE-WAY evidence: it syncs
  daily, so it can confirm a lineup exists and must never be read as proof
  that one doesn't.
  Parsing lives in `src/utils/lineup-sources.ts`
  (`findWeekResultsEntry` / `extractLineupStarters`). Its `allowUnlabeled`
  opt-in belongs ONLY to a week-scoped fetch: enabling it on the YTD payload
  would answer a lookup for ANY week with the season's single entry once one
  exists.
- **`res.ok` is not "the call worked."** MFL answers a throttled or malformed
  request with HTTP 200 and an `{ error: … }` body. A dead `rosters` call
  emptied every slot; a dead `players` call printed "Player 13592" where a
  name belongs. Check for the payload's own shape, fall back to the committed
  feed under `data/<league>/mfl-feeds/<year>/` (`resolveRostersPayload`), and
  take player identity from `getPlayerMap` — which reads that same disk feed —
  BEFORE the live `players` response. Never let a live MFL call be the only
  source for something already synced to disk.
- **"No lineup on file" and "we couldn't read it" are different states, and
  merging them is destructive.** Both yield zero starters. If the second is
  treated as the first, the page labels its projection fill "no lineup
  submitted" AND arms the submit button — one tap then overwrites the lineup
  the owner actually had. `resolveLineupFillState` owns the four-way call
  (`saved` / `unsaved-offer` / `read-failed` / `past-unset`); only
  `unsaved-offer` may submit. A played week never can, and the "best
  projected lineup" copy is only honest when `projectedScores` came back —
  on an empty projection map the sort is a no-op and the fill is roster
  order. Same reasoning as the rosters fallback: absent evidence is not
  evidence of absence.

