# AFL Team Spotlight (homepage team card, 4th tile)

The offseason "My Team" card's fourth tile. Was `Keepers — X of 7 protected`,
rendering `—` for every owner from the day it shipped. Now a calendar-rotating
spotlight: `src/utils/afl-team-spotlight.ts` (pure resolvers) +
`src/utils/afl-draft-slot.ts` (feed reads).

The two durable traps this uncovered — MFL's board not preserving earned draft
position, and AFL having no keeper construct — are in
`docs/claude/rules/standings-brackets-draft-order.md`, not here. This file is
the feature's own shape.

## 2026-08-21 - A metric with no fallback renders a dash forever

**Insight:** The original tile had exactly one source and no fallback, so when
that source could not produce a number there was nothing to degrade to. It sat
blank for months without anyone filing it — a `—` looks like "no data yet"
rather than "this is broken", so it is invisible in exactly the way a crash is
not.

Any always-present tile wants a **total** resolver chain: tiers ordered
most-timely-first, each returning `null` when it has nothing, ending in one that
cannot fail. Here: draft slot → last title → active playoff streak → all-time
record, with the record tier total by construction. The guard is a test that
walks all 24 franchises and asserts none renders `—`; a per-tier unit test would
have passed on the broken version too, because each tier was individually fine.

## 2026-08-21 - Design a league-wide metric against the whole league, not your own team

**Insight:** Three separate decisions in this tile would have looked correct if
validated only against Smokane (0001), and were wrong for a large minority:

- **"Most recent title" vs "best title" disagree for 12 of 24 franchises.** Pick
  either alone and the tile is wrong for half the league while looking right on
  whichever team you spot-checked. Both are surfaced (recent headlines, best
  appended when it differs).
- **Every franchise that reaches the playoff-streak tier is on a drought**, not
  a streak — the tier is only reached by franchises with no hardware, which are
  exactly the ones who have not made the playoffs. Rendering "years since" would
  have shipped a misery counter to precisely those four owners. The tier now
  requires an *active* streak and otherwise falls through.
- **The keeper count would have been identical for all 24 teams** even sourced
  correctly. A metric that does not vary across the league is not a metric.

Before building a per-team metric, print it for all 24 and look at the spread.
That check is a two-minute probe test and it changed the design three times.

## 2026-08-21 - Sub-line copy: shorten both halves together, not just the tail

**Insight:** The tile's sub line holds ~25 characters before wrapping to two
lines. Trophy labels needed compacting, but only when the line carries two of
them: `NIT Champion` alone reads better than `NIT`, while
`NIT Champion · D-League '18` wraps and `NIT · D-League '18` does not. So the
short-label map is applied to *both* halves in the combined case and to neither
in the solo case, rather than being a property of the label. Longest real
output is now 25 chars (`AL South · AL Central '12` — Vitside, two divisions,
no short forms available) and fits on one line in both themes.

## 2026-08-21 - Lazy-import a big JSON behind a rare tier

**Insight:** The streak tier needs `derived/franchise-history.json` (2.7 MB) for
per-season playoff results. A static import would put that chunk on the AFL
homepage's cold start to serve a tier that ~4 of 24 franchises ever reach. A
dynamic `await import()` inside the tier's loader keeps it off the path
entirely for anyone who resolves at an earlier tier, and Vite splits it into its
own SSR chunk shared with `franchises/[id].astro`, which imports it statically
anyway.

Also worth copying: `afl-draft-slot.ts` memoizes its `fs` reads in a
module-level `Map`, **caching misses too**. The four feeds are ~170 KB of JSON
per request otherwise, and a feed that does not exist must not be re-`stat`'d on
every hit. Committed feeds only change on deploy, so process-lifetime caching
has exactly the staleness `import.meta.glob` already has.

## 2026-08-21 - Express a date window in the registry's clock, not in month math

**Insight:** "From June until the draft is over" first became
`month >= 5 && month <= 8`, which needed a September ceiling purely to stop
`getNextDraftYear`'s Labor Day rollover from reopening the window all autumn.
The registry already declares AFL's June 1 `leagueYearRollover`, so
`getAflLeagueYear(ref) === ref.getFullYear()` **is** the June floor — no month
arithmetic, nothing to bump at rollover, and it names the right draft year for
free.

Deliberately NOT inferred from "last year's board is finished", which is
equivalent in healthy data: a missing or half-imported prior board reads as
unfinished and would leave a stale draft slot up all winter. The calendar check
and the completeness check guard different failures; keep both.
