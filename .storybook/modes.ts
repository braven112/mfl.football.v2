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
 * Measured: (8 playoff x 2) + (13 loading x 4) = 68 snapshots per full build,
 * roughly 73 full builds a month. 13 loading stories rather than 14 because
 * `BrandedLoader/CyclingNarration` carries `disableSnapshot`.
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
