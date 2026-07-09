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
