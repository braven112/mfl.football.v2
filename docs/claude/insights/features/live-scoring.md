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
