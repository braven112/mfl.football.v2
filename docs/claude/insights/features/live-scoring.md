# Live Scoring — Insights

Self-hosted live scoring for TheLeague (and, next, AFL). Astro SSR page +
`LiveScoreboard.tsx` island polling `/api/live-scoring`. Direction C (Editorial).

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
