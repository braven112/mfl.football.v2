# Live Scoring — Insights

**Architecture, as of 2026-09-18 (PR #1165):** ONE shared kit serves four
routes — `/theleague/live-scoring`, `/afl-fantasy/live-scoring`,
`/best-ball-1/live-scoring` and `/live` (MFL Live). Thin Astro route wrappers
(28-35 lines) + `LiveBoardPage.astro` + a single React island,
`src/components/shared/live/LiveBoard.tsx`, over `src/styles/live.css`.
Per-league identity is the existing `data-league` × `html.dark` token
mechanism; nothing in the kit is per-league code.

**Entries below dated before 2026-09-18 describe the ISLAND THIS REPLACED**
(`LiveScoreboard.tsx`, `live-scoring.css`, `MflLiveBoard.tsx`, all deleted).
Their reasoning is still why the current code looks the way it does — the CSS
rules in particular were harvested into the rewrite — but the file and symbol
names in them no longer exist. Read them as history, not as a map.

## 2026-09-22 - `:last-of-type` Does Not Mean "Last One of This Class"

**Context:** Restyling the bench disclosure into a centred pill. The pill was
given a `border-top` on its bar to separate the bench from the starters above
it. It rendered as a heavy edge-to-edge double rule.

**Insight — `.lv-mx-row:last-of-type::after { content: none }` matches NOTHING
once a bench follows the rows.** `:last-of-type` is scoped to the element TYPE,
not to the class in the selector. `LvLineup` returns a FRAGMENT of
`<div class="lv-mx-row">`, so inside `.lv-mx-body` the rows and `.lv-bench` are
all siblings and all DIVs — the last div is `.lv-bench`, so no `.lv-mx-row` is
ever `:last-of-type` and the last starter row keeps its divider.

The comment above that rule says `:last-of-type` was chosen over `:last-child`
precisely because "the list's last ELEMENT may be something else (the bench
disclosure)". That reasoning does not hold: against a sibling of the same tag
the two selectors behave identically, and both match zero. Distinguishing by
class needs `:not(:has(~ .lv-mx-row))` or an explicit cancel on the row that
precedes the bench.

Two things follow:

- **The bench bar deliberately has NO border of its own.** Its separating
  hairline is that surviving `.lv-mx-row::after`, which is inset to the gutter.
  A full-bleed border on the bar stacks on it at the same y (both measured at
  the same pixel) and draws edge-to-edge — the exact mark the row-divider
  comment forbids, because edge-to-edge rules became louder than the scores
  they separate. If that row divider is ever correctly cancelled, the bar needs
  its own INSET hairline back, not a border.
- **The rule "dividers are inset pseudo-elements, never full-bleed borders" is
  prose only.** It is stated in `src/styles/live.css` and pinned by no guard,
  which is how this shipped into review. A scan guard over the live surfaces'
  stylesheets would have caught it at edit time.

## 2026-09-20 - Aggregating Across `matchups` Double-Counts Every Franchise in a Doubleheader Week

**Context:** MFL Live's new per-league board
(`/live/league/<mflLeagueId>`) added a top-scorers strip built by
`buildLeaders` (`src/utils/live/leaders.ts`) from the assembled panel. It
walked `panel.matchups`, then each matchup's two sides, collecting rows. Shipped
green; caught in a screenshot, not by a test. Every player was listed twice —
Josh Allen at #1 **and** #2 of the same league, same owner, same score.

**Insight — a panel's `matchups` is a list of PAIRINGS, not of franchises, and
in a doubleheader week each franchise appears in two of them.** TheLeague's own
schedule runs doubleheaders (`docs/claude/rules/schedule-optimization.md` — the
late doubleheader week is whichever of Week 12/13 is bye-free that year), so
this is normal data, not a malformed feed. Anything aggregating a per-FRANCHISE
quantity — a leaderboard, a total, a count, an average — has to gate on the
franchise id and take the first sighting, because the second one is the same
roster reported again rather than a second set of points.

This is the third instance of one bug class in this repo. The others:
`update-salary-averages.mjs` summed player points the doubled way for every
season since 2007 (`docs/claude/followups/2026-09-15-salary-averages-doubleheader-double-count.md`),
and the player modal's week-1 points had the same shape. The tell is always the
same — iterating a schedule to answer a question about teams.

**Why the unit tests could not see it.** The fixture gave every franchise
exactly one matchup, which is what a hand-written fixture naturally looks like.
A doubleheader is not an edge case to remember at test-writing time; it is a
case the fixture has to CONTAIN. `tests/live-league-board-outside.test.ts` now
has one, and it asserts both that the keys are unique and that nothing was lost
to the de-duplication — a dedupe that quietly drops a franchise passes the
first assertion on its own.

**Not to be confused with the thing that must NOT be deduped.** The same player
started by two DIFFERENT franchises is two owners' points and two legitimate
rows — routine in the AFL, whose rosters duplicate players, and possible on
both sides of one matchup. The gate is on the franchise, never on the player,
and `LiveLeaderPlayer` is keyed by the PAIR for exactly that reason.

## 2026-07-08 - Reusable two-team color contrast system

**Context:** The predictor chart (win-probability bar + dynamic top border)
needed to render both franchises' brand colors side by side and *always* read
as two distinct, legible colors — even for the 7 franchises whose brand primary
is near-black `#181818`, which vanishes against the dark card surface.

**Insight:** This is a general problem (anywhere two teams meet: faceoffs,
head-to-head charts, versus badges), so it lives in a standalone, theme- and
league-agnostic util rather than inline in the island:
`src/utils/team-color-contrast.ts`. Core: `resolveTeamColorPair(home, away, opts)`.
- **Rule:** HOME keeps its brand primary; AWAY steps `primary → secondary →
  chart color`, taking the first that clears a CIE76 ΔE threshold (default 25),
  else the most-different candidate.
- **Fallback A (`background`)** — pass the card surface for the theme; both
  colors are nudged in lightness until legible against it (`ensureLegibleOn`).
  This is what rescues `#181818` on the dark card.
- **Fallback B (`forceAdjust`)** — invents a shade when no brand color clears
  the bar, guaranteeing two distinct colors.
- **Fallback C (`homeVisibilityFallback`)** — lets home drop off its primary to
  a visible brand color when the primary is illegible on the surface.
- **Fallback D** is CSS, not JS: a hairline seam (card-surface color) at the
  win-prob split in the top-border gradient and `.ls-wp-mid`, so the split reads
  even when the two colors land close.

**Evidence:** `src/utils/team-color-contrast.ts`,
`tests/team-color-contrast.test.ts` (16 tests lock the math + fallback chain),
wired in `LiveScoreboard.tsx#teamColorVars`.

**Recommendation:** Reuse `resolveTeamColorPair` for any new two-team color
display — don't reinvent the contrast math. Feed it a `TeamColorSet`
(`{colorPrimary, colorSecondary, color}`).

## 2026-07-08 - Theme-aware color pairs are computed in JS, applied by theme in CSS

**Context:** The card surface differs by theme (white light / `#262626` dark),
so the legibility guard must run against *both* backgrounds — but the island
renders once and can't know the active theme (class-based dark, resolved
pre-paint).

**Insight:** Compute BOTH pairs in the island and expose all four as inline
custom properties (`--th-light/--ta-light/--th-dark/--ta-dark` + `--wp-split`);
let CSS pick per theme (`.ls-card { --th: var(--th-light) } html.dark .ls-card {
--th: var(--th-dark) }`). Do NOT try to detect the theme in JS. Note: this is a
plain imported `.css` file, so use `html.dark .foo` directly — `:global()` is
inert outside Astro scoped `<style>` (see design-system.md).

**Evidence:** `LiveScoreboard.tsx#teamColorVars` (LS_LIGHT_BG/LS_DARK_BG),
`src/styles/live-scoring.css` (`.ls-card, .ls-detail` theme derivation).

## 2026-07-08 - MFL liveScoring field variance — derive "yet to play" client-side

**Context:** The MFL `liveScoring` feed's per-player array is sometimes
`players.player[]` and sometimes a flat `player[]`, and the franchise-level
"players yet to play" attribute name was unverified.

**Insight:** Make the parser tolerant of both array shapes, and derive the
yet-to-play count client-side from each starter's `gameSecondsRemaining`
(`>= NFL_GAME_SECONDS` ⇒ not started) rather than trusting a franchise-level
attribute. Fall back to the feed value only when there are no per-player rows.

**Evidence:** `computeTeam` in `LiveScoreboard.tsx`, `src/pages/api/live-scoring.ts`.

**Recommendation:** For live/offseason-variable MFL feeds, prefer deriving
aggregates from the per-player rows you already parse over trusting
franchise-level summary attributes.

## 2026-07-08 - Matchup-detail scorehead must stack vertically on mobile

**Context:** `.ls-scorehead` (the matchup-detail score header) is a
`grid-template-columns: 1fr auto 1fr` grid where each `.ls-mx-team` is a
*horizontal* flex row: crest + name column + a 2.7rem `.ls-mx-total`. On a
375px phone the two side columns (each ~180px once the name wraps) plus the
center proj column blow past the viewport, forcing a horizontal scroll that
hides the home team's score off the right edge.

**Insight:** Fix it by stacking each team vertically under `@media (max-width:
760px)` — `.ls-mx-team { flex-direction: column }` so the column width collapses
to `max(crest, name, score)` instead of their sum. Keep the two sides
symmetric (crest-on-top, score-below for both) by giving the home side
`flex-direction: column-reverse` — its DOM order is score→name→crest, so
reversing renders it crest→name→score to mirror the away side. Also reset
`.ls-mx-team.home .ls-mx-tn { text-align: center }` (base rule right-aligns it)
and add `min-width: 0` so a long name can't force the grid track wider than the
screen.

**Evidence:** `src/styles/live-scoring.css` (`@media (max-width: 760px)` block).

**Recommendation:** Any two-team header that renders each side as a horizontal
crest+name+score row will overflow narrow screens — stack vertically on mobile,
and use `column-reverse` on the mirrored side rather than reordering the JSX.

## 2026-07-08 - Explicit per-team dark brand colors override the auto-nudge

**Context:** The algorithmic dark-pair resolution (`ensureLegibleOn` nudging a
near-black/dark-navy primary lighter, "Fallback A" above) keeps colors *legible*
but not *on-brand*: dark-navy teams like Music City (`#113469`) and the
Magicians/DMoC (`#06386a`) came out as a muddy auto-lightened navy instead of
their real identity color (Titans sky-blue, Dark-Magician purple).

**Insight:** Give every franchise explicit `colorPrimaryDark` /
`colorSecondaryDark` fields in `src/data/theleague.config.json`, and resolve the
*dark* pair from those (falling back to the light `colorPrimary`/`colorSecondary`
per-field when absent). The light pair still resolves from the plain
`colorPrimary`/`colorSecondary`. Wiring: `ConfigTeam` + `buildTeamsMap`
(`live-scoring-data.ts`) → `TeamInfo` (`types/live-scoring.ts`) →
`teamColorVars`'s new `themeColors(team, dark)` helper swaps in the `*Dark`
values before calling `resolveTeamColorPair` for `LS_DARK_BG`. The contrast math
still runs on top, so the explicit colors are a *better starting point*, not a
bypass — two same-hue teams (e.g. Dead Cap green vs Ninjas green) still get
separated by the ΔE step, and the light-mode path is untouched.

**Evidence:** `src/data/theleague.config.json` (16 teams × `colorPrimaryDark`/
`colorSecondaryDark`), `LiveScoreboard.tsx#themeColors`/`teamColorVars`,
`live-scoring-data.ts#buildTeamsMap`.

**Recommendation:** When a team's brand primary is near-black or a deep hue that
only "works" in one theme, add an explicit `*Dark` color rather than leaning on
the auto-nudge — the nudge guarantees legibility, not brand fidelity. The fields
live in config so other surfaces (heroes, matchup headers) can adopt the same
dark colors later without re-deriving them.

## 2026-07-09 - Offseason demo replays a REAL historical scoreboard

**Context:** The `?demo=1` sample (`src/data/live-scoring-sample.ts`) used to be
a hand-authored synthetic slate. Goal: seed it from the last completed regular
season's final week so totals, per-player points, winners, and margins are all
true history — no invented numbers.

**Insight — three non-obvious data facts drove the rewrite:**
- **`weekly-results-raw.json` is the single best source**, not the
  `data/theleague/live-starting-lineups-week-NN.json` files. The lineup files
  only covered 12–14 franchises last season and carry no points. Each franchise
  entry in `weeklyResults.matchup[].franchise` carries a `starters` CSV (exact
  lineup + order), a `player[]` array with per-player `score`, an `isHome` flag,
  and the franchise `score` total — full, real, all 16 teams, every week.
- **The final regular-season week is `league.json → lastRegularSeasonWeek`**
  (14 for TheLeague), NOT the NFL 18 or the fantasy playoff weeks (15–17 have
  fewer matchups as teams are eliminated). Don't assume week 17/18 — read it
  from config.
- **"Last completed season" needs a played-check.** The upcoming season's
  `weekly-results-raw.json` already exists before kickoff as a schedule stub
  (`score: null`, empty `player[]`). Scan feed years newest-first and require
  the `lastRegularSeasonWeek` matchups to actually have starters+scores before
  accepting a year; otherwise you'll pick an empty future season.

Bonus: `nflSchedule.json` for that week carries real final NFL scores
(`team[].score`, `gameSecondsRemaining: "0"`) — use them for the NFL strip so
even the decorative games are real. Set every starter's `secondsRemaining: 0`
(final); the island then reads every card as `Final` with true totals. Leave
`projected: 0` for a final game — `projectPlayerFinal` returns `live` once the
clock is 0 so the per-row "proj" still shows the real final, but setting
`projected = live` instead would light the `.boom` (beat-projection) cue on
every positive scorer, which is meaningless for a completed game.

**Evidence:** `src/data/live-scoring-sample.ts`
(`resolveFinalRegularSeasonWeek`, `buildNflGames`), joins identity via
`getPlayer(year, id)` from `player-map.ts`.

**Recommendation:** For any historical-replay feature, prefer
`weekly-results-raw.json` (starters + scores + isHome, all franchises) over the
partial `live-starting-lineups-*` snapshots, and always resolve season/week
boundaries from `league.json` with a played-check rather than hardcoding or
assuming NFL week counts.

## 2026-07-09 - Offseason: page auto-falls back to the sample on an empty feed

**Context:** The nav "Live Scoring" link points at `/theleague/live-scoring`
with no params. In the offseason MFL turns its `liveScoring` feed off, so that
bare URL used to render the island's empty "scores will appear when games begin"
state. We wanted the sample (below) to show automatically out of season, but
flip to real data the instant the season starts — no special link, no manual
toggle.

**Insight:** `assembleLiveScoringData` returns `matchups: []` precisely when the
feed is off (the MFL `liveScoring` export is empty pre/post-season; in-season it
returns the week's matchups even pre-kickoff). So `data.matchups.length === 0`
is a reliable "feed is dark" signal. `live-scoring.astro` now fetches real data
first and, when it comes back with no matchups, renders `getLiveScoringSample()`
instead. `?demo=1` forces the sample year-round (validation); `?demo=0` forces
the live path even when empty (debugging the offseason empty state). The island
already shows a "Sample data" badge whenever `demo` is set.

**Evidence:** `src/pages/theleague/live-scoring.astro` (the `useDemo` decision),
`assembleLiveScoringData` in `src/utils/live-scoring-data.ts`.

**Recommendation:** Gate offseason fallbacks on the *feed's own emptiness*
(`matchups.length === 0`), not a season-phase date calc — it's self-correcting
and needs no calendar. Keep `?demo=1`/`?demo=0` overrides for QA.

## 2026-07-09 - Demo is presented MID-PLAY, not all-Final (supersedes above)

**Context:** The all-Final replay (2026-07-09 entry above) is accurate but dead:
the win-probability bar, live clocks, projected finals, and boom cue only render
for non-final games, so a finished slate showcases none of the page's marquee
live features. The demo now plays the same real week out *mid-Sunday*.

**Insight — the rendering rules that dictate the model:**
- **Win-prob bar shows only when `remainingPoints > 0`** — i.e. some starter has
  `secondsRemaining > 0` AND `projected > 0` (`projectPlayerRemaining` needs a
  non-zero projection). So an in-progress player must carry `projected = his real
  final` (not 0). Then `projectPlayerFinal = live + projected·fractionLeft`
  converges back to the true result: set `live = F·progress`,
  `secondsRemaining = (1−progress)·3600`, `projected = F`.
- **Matchup-level mix must be forced.** Fantasy starters spread across ~every NFL
  team, so with ~45% of games in-progress essentially every matchup has a live
  player and reads "Live". To get a real Final/Live board mix, mark ~half the
  *matchups* complete (hash of the pairing) and force their starters final;
  don't rely on per-NFL-game phases alone.
- **The green `.boom` cell needs `live >= projected` (raw projected), not
  `>= projFinal`.** With `projected = F` an in-progress player never booms
  (`F·progress < F`). To light a few, make ~1-in-5 in-progress players "hot":
  `projected = live·0.85`. A booming player then correctly shows a *projected
  final above his live total* (the model keeps projecting more) — matches the
  real feed. Final players keep `projected = 0` so boom stays a live-only cue.
- **Assign phase per NFL game, keyed by `normalizeTeamCode`**, so both teams in a
  game share state and the strip (`buildGamePhases`) matches the player rows.

**Gotcha (cost an hour):** the deterministic phase hash is a `>>> 0` **unsigned**
32-bit FNV-1a. Indexing a table with `hash >> 5` (signed shift) goes *negative*
when the high bit is set → `arr[-n]` is `undefined` → `NaN` clocks/scores on the
strip for exactly the games whose hash exceeds 2³¹. Use `>>> ` for any shift on
an unsigned hash used as an array index.

**Evidence:** `src/data/live-scoring-sample.ts` (`buildGamePhases`, the
per-starter `phase`/`hot` logic), `projectPlayerRemaining`/`projectPlayerFinal`
in `src/utils/live-win-probability.ts`, boom in `LiveScoreboard.tsx#PlayerRow`.

**Recommendation:** When faking a "live" state from finished data, drive it off
the projection model the UI already uses (real final = projection, partial live
from a game clock) so projected-finals stay truthful; force the coarse
(matchup-level) mix explicitly rather than hoping fine-grained randomness
clusters; and reach for `>>>` on any hash-indexed lookup.

**Accepted trade-off (don't re-litigate):** forcing whole fantasy matchups final
decouples a starter's Final/Live from his NFL game, so a forced-final starter can
sit on a team another (live) matchup keeps playing → that team reads live on the
NFL strip while the row reads Final (~24/144 rows). Reviewers flag this twice; it
is INTENTIONAL. The strip is built post-hoc from real player liveness
(`buildStrip` + `liveTeams`) to kill the *reverse* case (strip live with no live
starter), but the cross-cutting residual is unfixable without deleting the
Final/Live board mix (matchups span too many NFL teams to finish together). The
product owner chose the mix over strip consistency for this offseason-only,
badged sample. See the big comment at the `doneFids` block.

---

## 2026-08-21 - Bench rows travel in their OWN map, never in `players` with a status flag

**Context:** Adding the bench to the matchup detail. MFL's `liveScoring`
`DETAILS=1` payload carries the whole roster with a `status` of
`starter` / `nonstarter`; the route had been filtering nonstarters out.

**Insight:** The obvious change — keep every row and let the UI filter on
`status` — is the wrong one, and the reason is that **every existing consumer of
`players` treats a row as scoring for the matchup**:

- `computeTeam` sums each row's remaining projection into the team's projected
  final and counts it toward "yet to play";
- `winProbability` follows from that projected final;
- `buildMoments` credits a scoring play to whoever appears in the map.

So a bench row inside `players` inflates every projection and win-probability
bar on the board with points that cannot be scored, and puts bench touchdowns in
a matchup ticker. `/api/live-scoring` therefore returns a separate `bench` map,
and a caller has to opt in. `LiveScoringResponse.bench`, `LiveScoringData.bench`
and `LiveScoringPageProps.initialBench` all carry the split end to end.

Details that are load-bearing rather than tidy:

- **A row MFL doesn't confirm as `nonstarter` is treated as a STARTER** — the
  same direction the old filter erred in. Dropping a real starter silently
  subtracts his points from the team total, which is far worse than one extra
  row among the starters.
- **A franchise with no bench is ABSENT from the map, not an empty array**, so
  the island renders no disclosure control rather than one that opens onto
  nothing.
- **`playerMeta` must be resolved for both maps in one pass.** The bench renders
  the same `PlayerRow`, so a bench id missing from `playerMeta` doesn't degrade
  gracefully — it prints "Unknown Player" with no headshot, logo or team code,
  which is the whole row.
- **The poll writes `bench` under the same guard as `players`, then defaults to
  `{}`.** The guard answers "did this payload carry rosters at all" (an outage
  has neither map, and clearing on one would empty the board mid-Sunday); given
  rosters, a *missing* bench is a real answer — a franchise can start its whole
  roster, and a drop can empty a bench that had rows a poll ago.

`tests/live-scoring-bench.test.ts` drives the real route handler with `fetch`
stubbed and asserts on the returned JSON. That level matters: the split is a
`push` into one of two arrays, so inverting the condition or concatenating the
maps at the response boundary leaves the source looking exactly as it does now.
Verified by injecting the regression — 4 of 8 cases fail.

## 2026-08-21 - The offseason sample needs a bench too, or the feature is invisible

Both sample builders in `src/data/live-scoring-sample.ts` carry `bench`, because
the page auto-falls back to the sample whenever MFL's feed is empty — which is
every day between February and kickoff, i.e. exactly when someone is most likely
to be looking at a newly-built feature.

- **The replay derives the bench by SUBTRACTING the starters CSV from the week's
  scored players**, not by reading a `status` field. `weeklyResults` labels rows
  inconsistently across archived seasons, whereas the starters CSV is the same
  list the league's own results page renders — so subtracting from it cannot
  disagree with the lineup rendered directly above the bench.
- **Bench rows run through the SAME NFL-game phase math as the starters** (the
  forced-final override, the partial-progress fraction). Phasing them
  independently would show a bench player Final while his teammate in the lineup
  was still playing.
- **Team scores stay starters-only in both samples** — `rows`, never
  `[...rows, ...benchRows]`. This is the sample's copy of the invariant above,
  and getting it wrong makes the demo board disagree with the real one about
  what a team is scoring.

## 2026-08-22 - The empty state is the one card that is not a `<button>`

An owner opened Live Scoring before kickoff on a phone and the page scrolled
sideways with nothing to scroll to. The board itself was innocent: every
matchup card is a `<button>`, and the UA stylesheet gives buttons
`box-sizing: border-box`, so `.ls-card`'s `width: 100%` + `0.9rem 1rem` padding
+ `1px` border fit exactly. The empty state is the only `.ls-card` rendered as
a `<div>` — content-box, because this repo has no global reset — so the same
rule made it 34px wider than its container. Root `scrollWidth` 404 against a
393px viewport, and the card's right edge parked just off screen.

- **A shared "card" class that is a button in one branch and a div in another
  is the trap**, not the padding. It renders correctly in the common case and
  breaks only in the branch nobody screenshots, which is why this survived
  every mobile pass on the board. `.ls-card` now declares `border-box` itself.
- **`.ls-card::before` is the win-probability split**, away color to the left of
  `--wp-split`, home color to the right. With no matchup behind it, the empty
  card fell back to the 50% default and painted a grey/blue bar across its top
  that reads as a scrollbar, not as a border — the owner's screenshot is mostly
  that bar. `.ls-card.static` drops it along with the pointer cursor and hover
  accent a non-interactive div should never have carried.
- **`.ls-board`'s `minmax(300px, 1fr)` was overflowing too**, 4px at 320px, with
  matchups present — grid does not clamp a track floor to its container. This is
  the rule already in `insights/domains/frontend.md`'s head
  (`minmax(min(300px, 100%), 1fr)`); the board predated it.

Measured in Chromium at 393px and 320px, both leagues, empty and populated:
`document.documentElement.scrollWidth` equals `clientWidth` in all six.
`tests/live-scoring-layout-css.test.ts` pins the box-sizing, the collapsible
track floor, the suppressed bar, and that the markup still asks for `.static` —
the CSS half alone would pass with the class dropped from the island.

## 2026-09-03 - The Monitor Broke, Not The Thing Monitored. Prove Which Before Fixing.

**Context:** the gameday health check's first-ever scheduled run posted to
GroupMe that both leagues' live scoring was down, an hour before nothing in
particular. Live scoring was fine. Two independent faults, both in the probe.

**The diagnostic that settled it in one step, and the transferable part.** The
check reported `HTTP 403` on `/api/live-scoring` for both leagues while
`/api/nfl-scoreboard` on the *same domains, in the same second, from the same
runner* returned 200. Rather than reading the route, pull the deployment's
runtime logs for that minute:

```
23:27:47 GET /api/nfl-scoreboard 200
23:27:50 GET /api/nfl-scoreboard 200
(no /api/live-scoring entry at all)
```

An absent log line is positive evidence. A 4xx our code produced would be
logged; one produced *for* us at the edge is not. That single check moves the
investigation from "which branch of the handler returns 403" — there isn't one —
to "what does the edge dislike about this request", and it works for any
deployed endpoint failing in a way you cannot reproduce locally. The 403 was
the WAF: the probe's `host=www49.myfantasyleague.com` param reads as an SSRF
attempt, and the identical URL from a residential IP returns 200, so it scores
on datacenter-IP + payload together rather than on either alone.

**The second fault is a calendar bug wearing a data-outage costume.** MFL serves
no live scoring before Week 1 kicks off — there are no games. The check's cron
window opens in September but kickoff is mid-month, so *every* run in that gap
probed a week MFL could not answer for. What hid it is a line that reads as
defensive hygiene:

```js
export function clampHealthCheckWeek(week) {
  if (!Number.isFinite(week) || week < 1) return 1;  // 0 → 1
```

`getCurrentNFLWeek` returns 0 until the Week 1 Thursday — that 0 *is* the
pre-season signal, and clamping it to 1 destroys the only bit of information
that distinguishes "before the season" from "week 1". The gate therefore has to
consume the RAW week (`shouldProbeLiveScoring`), and the test that matters is
the one asserting a clamped 0 cannot smuggle the pre-season past it. Note the
clamp itself is still correct for the *scoreboard* probe, which serves the
upcoming schedule year-round — the bug was one clamp feeding two probes with
different pre-season semantics.

**Generalizable:** a monitor that fires before the thing it monitors exists is
not a monitor, it is a scheduled false alarm — and the cost is not the noise,
it is that the next real one gets ignored. When a health check fails on its
first run, suspect the check. Both faults here were latent in the check's own
source and neither was reachable from the code it probes.

## 2026-09-06 - The gameday health check was removed. Its two lessons were not.

**Context:** three days after the entry above, the pre-kickoff health check was
deleted at the league's request — workflow, script, `scripts/lib/gameday-health.mjs`
and its test. Nothing replaced it: there is no automated pre-kickoff probe of
live scoring any more, so read the entry above as history, not as a description
of something running.

**Why the entry above still earns its place.** Both faults it records are
properties of *any* scheduled prober of these routes, not of the file that is
gone: a `host=<hostname>` param on a public URL is scored as SSRF by the WAF at
the edge, and `getCurrentNFLWeek` returns 0 (not 1) until the Week 1 Thursday,
so anything running year-round must read the raw week rather than a clamped one.
Both survive in `docs/claude/rules/live-scoring.md`, rewritten to stop naming
the deleted script.

**The mechanical part of deleting a GroupMe sender.** `RAW_POST_ALLOWLIST` in
`tests/groupme-day-plan.test.ts` has a *stale entry* guard — an allowlist name
with no matching file under `scripts/` fails the suite. So removing any script
that calls `postToGroupMe` is a two-file change, and the test tells you so
rather than leaving a lie in the allowlist. Worth knowing before you assume a
script deletion is self-contained.

## 2026-09-08 - The game-day hint is a floor, not the answer (PR #1014)

`useNflScoreboard` had `liveNow = live || games.some(g => g.state === 'in')`
since it was written, and `/live` only caught it because #987 fixed the same
shape one file over and the cross-cutting pass went looking for the twin.

- **A server-computed "is it live" flag is fixed for the life of the page, so
  it can only ever raise the cadence, never lower it.** `getDailySlot`'s
  live-scoring slot is the hint here, and it stays open long past the last
  whistle — Sunday 8:30pm+ and Monday 11pm+ both still return it. OR-ing it
  into a poll interval made `POLL_STALE` unreachable on a game day, so every
  subscriber sat at 60s for hours after the slate went final. Any hint of this
  shape needs a data-derived condition that can switch it back off.
- **The right condition is "the slate is finished", not "data has arrived".**
  The obvious fix — honour the hint only until the first poll lands — is a
  regression here, and the reason is that the two feeds disagree about what
  "not started" looks like. MFL's `gameSecondsRemaining` is 3600 for a
  scheduled game, so "some remaining > 0" is already true pre-kickoff and
  `useLiveScoringFeed` can lean on it. ESPN's `state` is strictly
  `'pre' | 'in' | 'post'`, so a slate of `pre` games is not "in progress" —
  dropping the hint would have parked the board on the 5-minute cadence all
  Sunday morning and made it that late noticing kickoff. Don't port a cadence
  rule between the two feeds without re-checking what each says before kickoff.
- **One pinned subscriber pins the page.** `createSharedPoller` runs at the
  MINIMUM interval any subscriber asks, and `LiveScoreboard` and
  `NflGamesStrip` subscribe to the same key — so this was never fixable at a
  call site, only in the hook. The flip side of the store's best property.
- **An EMPTY slate is "nothing loaded yet", never "all final".**
  `[].every(...)` is `true`, so a naive `games.every(g => g.state === 'post')`
  drops the very first load to `POLL_STALE`. The length check is load-bearing.
- **Extracting the decision is what makes it testable at all.** vitest runs
  `environment: 'node'` with no jsdom and no testing-library, so a rule living
  inside a hook can only be guarded by scanning source text — which is what
  #987's client-side guards had to settle for. `shouldPollLive(games, hint)` as
  a pure export gets a real behavioural test instead. When a client-side rule
  matters, lift the decision out of the component rather than reaching for a
  DOM harness the repo does not have.

## 2026-09-09 - The board went blank on a Wednesday opener. Two bugs, one symptom.

The empty state ("Scores will appear here when games begin") over a live slate,
on the 2026 season opener. Two independent faults, either of which alone was
enough — worth recording because the *diagnosis* is the reusable part, not the
fix.

- **The runtime-log signature of an edge block is an absence, not an error.**
  The page SSR'd by fetching its own `/api/live-scoring` over the public
  internet. When that stopped landing there was no failing log entry to find,
  because a request blocked at the edge never reaches the route — what you see
  is a `/live-scoring` page render with **no `/api/live-scoring` entry beside
  it**, while the same route answers external callers perfectly. So the tell is
  a missing sibling line, not a 4xx. Compare the timestamps of the page hits
  against the API hits; a page render that produced no subrequest is the whole
  finding. (Same signature the removed gameday health check hit, 2026-09-03.)
- **Read the island's props off the deployed HTML before theorising.** The
  `<astro-island props="…">` attribute is HTML-escaped JSON in Astro's
  `[type, value]` encoding, so a dozen lines of Python answer "what did the
  server actually hand the client" exactly. Here it said `matchups: []`,
  `initialScores: {}`, `isLive: false`, and no `demo` key — which pinned all
  three facts at once: the fetch failed (not the feed being empty, or the
  sample would have fired, since that path requires `ok`), and the client was
  never going to poll either. Guessing from the screenshot would have found at
  most one of the two bugs.
- **The 2026-09-08 entry above was half the story, and the missed half was one
  file away.** PR #1014 fixed `getDailySlot`'s hint where it set a *cadence*
  (`liveNow = live || …` in `useNflScoreboard`). The same hint was also a hard
  *on/off gate* in `LiveScoreboard`'s own MFL poller — `if (!isLive) return;` —
  so on a Wednesday the board never asked MFL for a score at all. The two uses
  do not grep alike, which is why the twin survived a cross-cutting pass that
  was explicitly looking for it. **When a hint turns out to be untrustworthy,
  grep for every USE of it, not for the shape of the bug you just fixed.**
- **And the hero schedule really cannot be trusted for this.** `getDailySlot`
  knows Thursday, Sunday and Monday. The NFL does not: a Wednesday opener, a
  Friday game, a flexed kickoff. `shouldPollLive(nflSlate, hint)` reads the
  real clock and is the only thing that should decide the MFL cadence — the
  hint is now purely its pre-data fallback.

**Evidence:** `src/utils/live-scoring-source.ts` (the loader both the route and
the page call), `tests/live-scoring-self-fetch-guard.test.ts`,
`docs/claude/rules/live-scoring.md`.

## 2026-09-11 - The Detail Header Was the First Screen — Reclaiming It Beat Reclaiming the Padding

**Context:** An owner's screenshot of the matchup detail on a phone: "a little
crowded... getting rid of the card padding would help."

**Insight:** The horizontal diagnosis was right but was the smaller half. At
390px the detail view spent:

- **~30px a side** on three stacked gutters (`main`'s `--padding-sm`,
  `.ls-page`'s `--spacing-md`, the card border) plus `.ls-mx-body` 0.25rem and
  `.ls-prow` 0.1rem — 16% of the width;
- **~230px of vertical** before the first starter, on an 844px viewport: back
  row, score row, win-prob track, its labels line, and the yet-to-play line.

Four starters fit. Fixing only the gutters would have widened the rows without
changing that count.

**Recommendation:** Below 760px, treat the detail as a full-screen view rather
than a card in a page (the full-bleed mechanics are in
`domains/frontend.md#2026-09-11`), and attack the header as its own budget:

- **Fold the yet-to-play counts into the win-probability labels.** That line
  existed to carry two percentages and had room for both. Guard the fold in the
  MARKUP, not with `:has()` — a FINAL matchup renders no `WinProbBar` at all
  (`{!calc.isFinal && <WinProbBar …/>}`), and then `.ls-ytp` is the only place
  the counts exist. `.ls-ytp.folded` is set from the same `calc.isFinal` the bar
  is gated on, so the two can never disagree. See
  `domains/accessibility.md#2026-09-11` for why `.folded` must be visually
  hidden rather than `display: none`.
- **Move the card's one gutter onto `.ls-prow`**, not `.ls-mx-body`. It is then
  also the inset the new row dividers measure against, so content and rule share
  one edge by construction. Anything that used the old body inset has to follow
  it — `.ls-bench-cap` and `.ls-bench-none` both did, and both are promoted to
  grid items by `.ls-bench-row > div { display: contents }`.

Result, measured on the real page at 390px: first row 515px → 431px from the
top, name column 96px → 111px, five starters fully visible instead of four.

**What is NOT free to move:** `.ls-detail-top`'s 0.6rem inline inset. It exists
so the back label and the WRAPPED freshness pill start at the same x as
`.ls-scorehead`'s content below, and `tests/live-scoring-layout-css.test.ts`
pins it at both breakpoints along with `.ls-back`'s padding netting to zero
against its negative margin. Retuning it to match the new row gutter looked
tidier in isolation and broke that alignment; the guard caught it. Only the
BLOCK padding was the header's to give back — and on `.ls-back` it has to stay a
longhand, since the `padding` shorthand would reset the inline padding the
negative margin depends on.

**Evidence:** `src/styles/live-scoring.css` (760px block),
`src/components/shared/LiveScoreboard.tsx` (`WinProbBar`, `MatchupDetail`),
`tests/live-scoring-layout-css.test.ts`.

## 2026-09-18 - A model that CARRIES its data makes "store the selection" unsafe

**Context:** The unified board drills in: tapping a matchup replaces the board
with a full-screen detail. The island stored what was clicked in
`useState<{ matchup, panel }>` and rendered the detail from it. Copilot caught
in review that the open screen never updated — it froze at the moment it was
opened while the games rail, the freshness pill and the red-zone banner beside
it kept polling.

**Insight:** The pattern was inherited, and it had been *correct* in the island
this replaced. That one stored `MatchupPairing = { home, away }` — two franchise
ids, an IDENTITY — and was handed the live `teams` / `players` / `bench` maps
alongside it, so its detail rendered from state that kept polling. The
canonical model then moved the data INSIDE the matchup (`sides: [LiveTeam,
LiveTeam]`, each carrying live points, projected final, yet-to-play and the
player rows), which is the right shape. That single change silently invalidated
every call site that *held on to* a matchup, and the pattern was carried across
unexamined.

The general rule: **when a refactor moves data from a side table into the
object, audit everything that STORES that object.** A stored reference that used
to be a cheap identifier becomes a snapshot. Nothing type-checks differently and
nothing throws — the screen just stops moving, which is the hardest failure to
see in review because every other element on the page proves the page is live.

Two specifics worth keeping:
- **The key is the sorted franchise pair (`pairingKey`), never `index`.**
  `index` is a position in MFL's own array order, which is nondeterministic
  between polls, so resolving by it can return a DIFFERENT matchup — a worse
  failure than a frozen one.
- **The league must be part of the selection.** Both leagues have a franchise
  `0001`, so a cross-league board needs `leagueId` to find the right panel *and*
  to select the ticker's rows.
- **An unresolvable selection falls back to the last good one rather than
  bouncing the reader out.** A poll can legitimately arrive without this matchup
  (one league's panel comes back `unavailable` while the rest are fine), and
  that is the same posture the poller already takes with `data.ok !== false`: a
  feed we could not read never wipes what is on screen.

**Evidence:** `src/components/shared/live/LiveBoard.tsx` (the `open` resolution),
`pairingKey` in `src/utils/live/model.ts`, five cases in
`tests/live-board-shell.test.ts` (proven to bite — restoring the object-storing
pattern fails 3 of 20). Scanned rather than driven: the bug only appears across
two polls, which `renderToString` cannot stage.

## 2026-09-18 - Name a matchup's sides for an INDEX, not for a relationship

**Context:** Two matchup shapes existed and had to become one. The league board
rendered every matchup as `home`/`away`; MFL Live rendered only yours as
`mine`/`opponent`.

**Insight:** Each name is a LIE on the other board, so neither could win:
- `mine`/`opponent` is a lie on a league board, which shows the fifteen
  matchups the viewer is *not* in — every one would have to claim to be
  somebody's. That is the exact shape of the composite-hero bug that put a
  rival's player on an owner's own homepage.
- `home`/`away` is a lie on a cross-league board, because a home-relative win
  probability means the opposite thing depending on which side MFL happened to
  put the owner on.

So the pairing carries NO claim: `sides: [LiveTeam, LiveTeam]` in MFL's own
order, plus `viewerSide: 0 | 1 | null` as a separate, nullable index, and `p0`
stated for side 0 and read through `winProbabilityFor`. A board with a viewer
gets exactly what it had; a board without one cannot accidentally assert
anything.

`viewerSide` is per MATCHUP, not per board — a doubleheader week puts the viewer
in several.

The same objection recurred for scoring plays and got the same answer:
`BroadcastMoment` carries `side: 'mine' | 'opponent'`, so the kit's `LiveMoment`
does not carry the claim at all and a caller that wants the relationship asks
the PANEL who the viewer is.

**Recommendation:** Any shared model spanning "your view" and "everyone's view"
should state relationships as nullable indices into a neutral pair. The test is
whether the field can be filled in honestly on the surface that has no viewer.

**Evidence:** `src/types/live.ts`, `src/utils/live/model.ts`,
`tests/live-model.test.ts`.

## 2026-09-18 - A franchise colour needs the GROUND it is drawn on, per surface

**Context:** `LiveScoreboard.tsx` hardcoded `LS_DARK_BG = '#262626'` —
TheLeague's dark card — and the AFL rendered the same island on a `#16283c`
navy card.

**Insight:** `resolveTeamColorPair` guarantees a ΔE against a background you
give it, so giving it the wrong background voids the guarantee silently.
Measured over the real config: judged against `#262626` the worst AFL franchise
landed at **ΔE 10.7** on the card it was actually drawn on — below the helper's
own `DEFAULT_MIN_BG_CONTRAST` of 18 — and `A Bruin Pegs Me` shipped `#002244`
on `#16283c` at **1.07:1**. Judged correctly it is ΔE 21.5.

It survived review because it was correct in light mode, correct on TheLeague,
and wrong only for three of twenty-four franchises, on one league, in one
theme. No screenshot anybody was likely to take would show it.

The fix is structural rather than a corrected constant: grounds live in ONE
table (`SURFACE_GROUNDS` in `src/utils/live/surface.ts`, keyed by the four
surfaces) and a kit component may not name a ground at all — colours arrive
already resolved as `--t0-light/-dark` and `--t1-light/-dark`, and the
stylesheet aliases `--t0`/`--t1` per theme in one rule.

**Recommendation:** When one component renders on more than one card colour,
make the ground a parameter of the RESOLVER and forbid the literal in the
component. `tests/live-ground-literals.test.ts` scans for both directions — a
hardcoded ground, and a file that judges colours without asking for one.

**Evidence:** `src/utils/live/surface.ts`, `resolveMatchupColorVars` in
`src/utils/live/model.ts`, `tests/live-ground-literals.test.ts`,
`tests/live-surface-grounds.test.ts`, and the `Live/MatchupCard` Chromatic story
(six modes, one per surface × theme).

## 2026-09-19 - Two names for one value is how a new key goes missing

**Context:** The day after the ink pair shipped (a franchise colour used as
TEXT must clear WCAG, not ΔE — previous entry), an owner reported that the AFL
board coloured its scores by team while MFL Live drew them white and grey.
Same kit, same stylesheet, same theme.

**The cause was mine, and it was structural, not arithmetic.** There were TWO
producers of a matchup's colour custom properties:

| Producer | Serves | Emitted |
|---|---|---|
| `live/model.ts#resolveMatchupColorVars` | the league boards | fill **+ ink** (8 keys) |
| `mfl-live-board.ts#matchupColorVars` | MFL Live | fill only (4 keys) |

The ink commit added four keys to the first and none to the second. MFL Live's
cards therefore carried `--t0-light`/`--t0-dark` but no `--t0-ink-*`, so
`live.css`'s per-theme alias fell through to its neutral fallback
(`--t0-ink: var(--t0-ink-dark, #94a3b8)`). The BARS stayed on brand, because
they read the fill pair, which was supplied — which is exactly the pattern the
owner described and the reason it did not look like a missing value.

**Why the suite was green throughout.** `tests/mfl-live-board.test.ts` asserted
the colour keys by NAMING them:

```ts
for (const key of ['--tm-light', '--to-light', '--tm-dark', '--to-dark'])
```

A hand-listed expectation cannot notice a key it does not list. So it now
derives the expected set from the canonical resolver and compares key-for-key —
add a key there and the MFL Live case fails until the board carries it. Proven
to bite: restoring the four-key literal fails exactly the two new cases and
none of the eighteen old ones.

**What actually fixed it was deleting the second producer, not patching it.**
`matchupColorVars` is one line now — it delegates to
`resolveMatchupColorVars(mine, theirs, 'mfl')`. The intermediate step of
delegating *and keeping the old names* (a prefix rename on the way out, undone
by `from-mfl-live.ts` on the way in) round-tripped correctly but left the
hazard's shape intact, and the rename's justification had already expired:

- `--tm-`/`--to-` (viewer-relative) existed for the OLD island's stylesheet.
- That island is gone, `/live` renders the kit, and **no page rendered a single
  `.mlb-*` class any more** — 530 of `mfl-live.css`'s 754 lines were dead, the
  `/live/settings` league picker (`.mls-*`) being the only live part. `/live`
  was still importing the sheet for nothing.

**`design-token-guard` is what proved the dead half was not harmless.** The
moment the assembler stopped hand-listing `'--tm-light'` as a string literal,
the guard reported four `var()` references defined nowhere in `src/` — it
counts a TS string literal as a definition, so the rule had been passing on the
assembler's own hardcoding rather than on anything real. The fork in the road
was to allowlist the four as "runtime" tokens or to delete the rules reading
them. They were dead: allowlisting would have asserted that something still set
them. Deleted.

**The rule:** one value, one name, one producer. A second producer of the same
shape does not diverge on the day you write it — it diverges on the day
somebody extends the first one, and nothing about that day points at the
second. A guard that lists the shape by hand cannot see the divergence either;
derive the expectation from the thing being copied.

## 2026-09-20 - A fixed track in a MIRRORED pair costs double, and the guard pinned the mechanism

**Context:** An owner's phone screenshot of the matchup detail: "the position
column takes up a lot of width and crowds the names." The 2026-09-11 entry
above attacked the same page's width budget from the gutters and the header;
this is the horizontal half's next chapter, and the arithmetic is what makes it
worth its own note.

**Insight — a per-side track is charged twice, and `1.6rem` hides that.**
`.lv-ppos` held a `pos` grid area sized `--lv-slot-w: 1.6rem`, which with
`--lv-row-gap` is ~32px. That reads as a rounding error until you remember
`.lv-mx-row` renders TWO of these side by side: the real bill is **64px of a
390px screen, 16%**, and every pixel of it comes out of the two name columns
because they are the only `1fr` tracks in the row. Measured after removing it:
the name column goes 100px → 132px and the row drops from four tracks to three.

Reviewing a fixed track in this layout, double it before judging it. The same
applies to `--lv-face-w` and anything else `.lv-mx-body` declares — those
metrics are all per-side.

**Where the label went, and the one thing that move costs.** Onto `.lv-pmeta`,
the row that already carries the game clock (`RB · DET` ahead of the state
dot) — free geometry, and it buys the row the NFL team it printed nowhere
before. Two non-obvious constraints came with it:

- **The meta line WRAPS** (it carries red zone and down-and-distance too), so
  the position, separator and team need one `white-space: nowrap` wrapper or a
  narrow row breaks `RB` off from `· DET`, or starts a wrapped line with the
  separator.
- **A justified-to-the-outer-edge line has exactly one x-stable item: its
  last.** The right side justifies `flex-end`, so in source order the label
  would slide with the width of the clock text ("Final" against "11:00 - 4th")
  and the column of labels would go ragged on one side of the pair only.
  `.lv-prow--right .lv-pwho { order: 1 }` pins it. Use `order`, not a second
  markup branch — DOM order is what assistive tech announces, and "QB, DET,
  Final" is the right sentence on both sides.

**The bigger lesson: three guards pinned the DELIVERY of a rule, not the
rule.** `tests/live-scoring-layout-css.test.ts` asserted
`valueOf('.lv-ppos', 'grid-area') === 'pos'` and
`valueOf('.lv-pstat', 'grid-column') === '2 / -1'`. Both are *mechanisms*. The
invariants they were written to protect — never a shared centre slot column,
never indent the box-score line with a margin — were untouched by this change
and still hold. A guard written at that altitude fails on every improvement to
the thing it guards, and the tempting fix is to delete the assertion.

**The rule:** when a guard fails because the design moved rather than because
the rule broke, rewrite it to pin the invariant and it usually gets STRONGER,
because you now know which direction the regression comes from. Here the
replacement pins the absence four independent ways — no `grid-area`, no fixed
`min-width`/`width`/`flex-basis`, no `pos` in either side's
`grid-template-areas`, and no live `--lv-slot-w` anywhere in the sheet — since
each one is the 32px column coming back under another name. The suite went
25 → 27 tests. Loosening it would have left the next session free to re-add the
column by any of those four routes.

**Ruled out, and the tests say so:** a shared centre column, and a position
group header spanning the pair. Both can only name ONE of the two paired
positions and mislabel the other whenever the sides run different lineup
shapes. That is not an edge case — the rows are sorted per side, so a WR
opposite an RB is an ordinary row, and the owner's own screenshot had one.
