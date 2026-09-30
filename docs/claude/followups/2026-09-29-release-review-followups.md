# Follow-ups from the 2026-09-29 release review

Deferred on purpose: none of these hold the release. See
`docs/claude/releases/2026-09-29-release-review.md`.

1. **Pause Live polling in background tabs.** `src/components/shared/live/LiveStandingsBoard.tsx:82-112`
   and `LiveBoard.tsx:235-271` poll every 25s live / 90s idle with no
   `document.visibilityState` gate. `/api/live-standings` re-runs
   `discoverBoardLeagues` and then 2 MFL reads per enabled league on every tick.
   Share one polling hook with a visibility pause, and cache the discovered
   league list (~5 min).
2. **One EVAL per page view.** `src/pages/api/track-visit.ts` awaits
   owner-activity's script and then site-insights' script. Merge them, or
   sample the anonymous half.
3. **Consolidate bye-week lookups** onto `src/utils/nfl-bye-lookup.ts`
   (dual-dialect), retiring `nfl-bye-weeks.ts#byeWeeksForSeason` and
   `draft-broadcast-server.ts#loadByeWeeks`.
4. **Consider unifying TheLeague's trade builder** with
   `components/afl-family/TradeBuilderPage.astro`, if the contract logic can be
   passed in as a prop.
5. **Rosters page imports an 11.5 MB JSON** (`roster-season-payloads.json`,
   `theleague/rosters.astro:138`). This predates the range. The existing
   `/api/roster-season/[league]/[year]` route could serve it on demand.
