# Free Agents — the phone layout

Both leagues' `/players` pages below 768px: rank, player, Pts / PPG, Proj, and
a row tap that opens the player sheet. Everything else lives in the sheet.

Shared pieces: `src/styles/free-agents-mobile.css`,
`initPlayerModalTrigger(tbody, { rowTapMedia })`
(`src/utils/player-modal-trigger.ts`), `PlayerDetailsModal`'s Details section.

---

## 2026-09-25 - Hiding columns on a phone: what it takes, and what it owes

**Context:** owner feedback that the page was unreadable on a phone. It was a
20-column table that scrolled sideways, and nothing in its CSS changed below
767px.

### The view toggles write inline `display`, so phone CSS needs `!important`

The Stats / Rankings / Value / Auction toggles set `el.style.display` on every
cell. A media-query rule cannot beat an inline style without `!important`, in
BOTH directions: hiding a column the view shows, and showing Proj, which
TheLeague's desktop table keeps permanently hidden. Which view is active reaches
CSS as `data-stats-view` on the table, set inside each page's visibility
function. Cells a phone drops carry `m-hide`. Do not rename
`<td class="cell-age">` or `<th class="col-player-actions"`:
`tests/free-agents-action-placement.test.ts` pins those literals, so CSS targets
them by their existing classes instead.

### Hiding a column is a promise that the data is somewhere else

The first cut hid ht/wt, snaps and ADP, then claimed "it's all in the sheet".
It wasn't. The sheet's Details section sat below news and the 17-row Season
Results table, and it had no snaps or ADP rows at all. Before hiding a column,
enumerate each one against what the drill-down actually RENDERS, not against
what its payload type declares. `PlayerModalData` carried `offenseSnaps` for
months with nothing showing it. Details now sits under the metric tiles. The
Snaps and ADP rows show only when the opener sends those fields, so other pages
using the sheet are unchanged.

### The ⋮ column carried one thing the sheet didn't

MFL's own Bid/Add deep link (`data-pa-acq-url`, used in auction season or when
the viewer can't claim in place) existed only on the row's ⋮. Hiding ⋮ on a
phone would have removed the only bid path during the auction.
`initPlayerModalTrigger` now copies it from the row into the payload
(`acqUrl`/`acqLabel`), and the sheet shows it as `#pdm-acq`, taking precedence
over the in-place Claim, the same order the ⋮ sheet uses. The signed-out
"sign in to claim" prompt still exists only on ⋮, which is a known gap.

### TheLeague's modal trigger was DCL-only

Arriving at Free Agents by in-site navigation left every name and row tap dead,
because the trigger's `<script>` bound on `DOMContentLoaded` only (it was in
the ClientRouter baseline). It now binds on `astro:page-load` with a
`dataset.modalInit` guard, the same as the AFL page.

## 2026-09-25 - Bye weeks: one table, two team-code dialects

`roster-constants.ts#nflByeWeeks` was a hand-typed table labelled "updated
each season", and it was not updated: in 2026 most teams had the wrong week
(ARI 8 vs a real 14). It also keyed only MFL's spellings (WAS, JAC), while both
Set Lineup pages look up `normalizeTeamCode` output (WSH, JAX), so Washington
and Jacksonville never showed a bye at all. It is now derived from
`data/nfl/bye-weeks.json`, which the schedule-release workflow refreshes, via
`byeWeeksByTeam` (`src/utils/nfl-bye-lookup.ts`). That helper keys every week
under both the raw and the normalized code. The call is `/* @__PURE__ */` so
client bundles that import roster-constants for other exports tree-shake the
JSON away. Any new render dependency of roster-constants must also be listed in
`chromatic.yml` (`tests/chromatic-path-filter.test.ts`).
