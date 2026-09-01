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
 * The suite is now 63 stories, ~152 snapshots a full build. `leagueModes` is
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

/** Theme + league matrix — for components that genuinely render in both leagues. */
export const allModes = {
  ...themeModes,
  ...leagueModes,
} as const;
