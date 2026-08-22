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


## A week can schedule more than ONE game

TheLeague runs double-header weeks — 2026 weeks 1-3 and 13 list 16 matchups
for 16 franchises, so every team plays two different opponents (home in one,
away in the other) off a single submitted lineup. The Set Lineup page's
matchup panel walked the week's matchups and `break`ed at the first one
containing the owner, so it drew one game and silently dropped the other:
half the week they were setting a lineup for was simply not on the page.

- **`findWeekMatchups` (`src/utils/lineup-sources.ts`) is the reader, and it
  is plural.** Never re-introduce a first-match-wins loop over
  `weeklySchedule[].matchup`. An empty array is the "MFL didn't schedule this
  franchise" state `franchiseAppearsIn` already guards — not an error.
- **Home/away is per GAME, not per week.** Each card resolves its own
  `userIsHome`, which decides which panel wears the accent and which total is
  ours. Reusing the first game's side puts the owner on the wrong side of the
  second scoreboard.
- **One lineup, every card.** MFL takes one lineup per week and scores it in
  both games, so our projected total is the same number on every card — the
  client updates them ALL (`querySelectorAll('.lineup-faceoff__scoreboard')`).
  Updating only `querySelector`'s first hit left the second game showing a
  stale total that contradicted the one a swipe away. `tests/lineup-sources.test.ts`
  pins both the reader and that selector.
- **Scroll position is the carousel's only state.** The arrows and dots just
  scroll the track; the dots, the counter, the arrow ends and which
  scoreboard holds `aria-live` are all re-derived from a scroll listener, so a
  swipe and an arrow click land in identical states. Only the card in view is
  a polite live region — two would announce the same new total twice.
- **A card whose composite can't cast still renders** (band only). Dropping it
  would hide half of a double-header; the section only disappears when a game
  has neither a cast faceoff nor a projected total.
