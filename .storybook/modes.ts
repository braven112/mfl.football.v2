/**
 * Chromatic modes.
 *
 * A mode's properties are applied as Storybook GLOBALS before the snapshot, so
 * the keys here must match the `globalTypes` declared in preview.ts (`theme`,
 * `league`). Chromatic captures one snapshot per mode per story.
 *
 * SNAPSHOT BUDGET — the free plan is 5,000 snapshots/month and testing pauses
 * (rather than bills) when it runs out. Modes multiply, so they are applied
 * deliberately rather than everywhere:
 *
 *   - `themeModes` is the global default: every story, light + dark.
 *   - `leagueModes` is added only to genuinely cross-league components (the
 *     shared/loading tier). The playoff heroes are TheLeague-only surfaces, so
 *     snapshotting them under the AFL skin would burn budget on a combination
 *     that never ships.
 *
 * The suite is now 64 stories, ~154 snapshots a full build. `leagueModes` is
 * applied narrowly — only where
 * a component's own styles actually read a league-scoped token, or where a
 * story renders one league's CONTENT and needs that league's SKIN to match
 * (the QuickLinks AFL story).
 *
 * Applying it more widely was measurably wasteful: PlayerCell and
 * LineupGameStrip read no league token at all, so their AFL snapshots came out
 * pixel-identical — 32 a build buying nothing.
 *
 * `TeamIconCell` is the case that most looks like an exception and is not.
 * Both leagues' crests render in it, but the league axis is carried by the
 * ARGS (the icon path picks the league): the dark swap and stroke rules are
 * emitted for both leagues with no league branching and keyed on exact `src`,
 * so `html[data-league]` never participates. themeModes, and the args do the
 * rest.
 *
 * Two stories contribute zero: `BrandedLoader/CyclingNarration` (cycles on a
 * timer) and `PlayerCell/MissingHeadshot` (falls back to a live CDN URL), both
 * via `disableSnapshot`. The Overview page is excluded for the same reason.
 *
 * TurboSnap (`--only-changed`) narrows this once available, but Chromatic
 * withholds it until 10 builds have run from CI, and an inherited snapshot
 * still bills 0.2 rather than nothing.
 */

export const themeModes = {
  Light: { theme: 'light', league: 'theleague' },
  Dark: { theme: 'dark', league: 'theleague' },
} as const;

export const leagueModes = {
  'AFL light': { theme: 'light', league: 'afl' },
  'AFL dark': { theme: 'dark', league: 'afl' },
} as const;

/**
 * MFL Live's surface.
 *
 * Added for the shared live-scoring kit, which is the first component set that
 * genuinely renders under `data-league="mfl"` — and whose card ground
 * (`#1e2126`) differs from BOTH TheLeague's `#262626` and the AFL's `#16283c`.
 * Franchise colours are resolved server-side against whichever of those three
 * the surface actually uses, so without this pair the one surface with its own
 * ground would never be snapshotted at all.
 *
 * Kept separate from `leagueModes` so existing stories do not silently gain
 * two snapshots each — the budget note above applies to this as much as to the
 * AFL pair.
 */
export const mflModes = {
  'MFL light': { theme: 'light', league: 'mfl' },
  'MFL dark': { theme: 'dark', league: 'mfl' },
} as const;

/** Theme + league matrix — for components that genuinely render in both leagues. */
export const allModes = {
  ...themeModes,
  ...leagueModes,
} as const;

/**
 * Every surface the shared live-scoring kit draws on: TheLeague, the AFL and
 * MFL Live, light and dark. Six snapshots a story — spent only where a
 * component's colours are resolved against a per-surface ground.
 */
export const liveSurfaceModes = {
  ...themeModes,
  ...leagueModes,
  ...mflModes,
} as const;

/**
 * Light + dark at PHONE width.
 *
 * ── A VIEWPORT GOES INSIDE A MODE, NEVER BESIDE IT ────────────────────────
 * Chromatic rejects a story that declares both, and it rejects the whole
 * BUILD rather than that one story:
 *
 *   ✖ Failed to extract stories from your Storybook
 *   Error: Chromatic does not support viewports and modes on the same story.
 *          in story 'live-matchupdetail--phone-width'
 *
 * That is exit 23 — a build failure, not a diff — from `chromatic.viewports`
 * sitting alongside `chromatic.modes` on one story. Modes supersede the older
 * `viewports` array, and a mode may carry its own `viewport`, so the width
 * belongs in the mode map.
 *
 * It is worth knowing that NOTHING LOCAL CATCHES THIS. `storybook build` exits
 * 0, the story renders correctly in a browser, and driving every story through
 * Chromium shows no error display — because this is a constraint of
 * Chromatic's story extractor, not of the story. Only a Chromatic build says
 * so. Guarded instead by `tests/storybook-story-renderer.test.ts`.
 *
 * Two snapshots, not four: this REPLACES the default viewport rather than
 * adding to it, so it is one width x two themes.
 */
export const phoneModes = {
  'Phone light': { theme: 'light', league: 'theleague', viewport: { width: 390, height: 1200 } },
  'Phone dark': { theme: 'dark', league: 'theleague', viewport: { width: 390, height: 1200 } },
} as const;
