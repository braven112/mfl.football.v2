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
 * At 22 stories that is (8 playoff x 2) + (14 loading x 4) = 72 snapshots per
 * full build, or roughly 69 full builds a month. TurboSnap (`--only-changed`,
 * wired up in the `chromatic` script) cuts a typical PR far below that by
 * snapshotting only the stories whose dependencies actually changed.
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
