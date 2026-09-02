import TeamIconCell from '../../src/components/TeamIconCell.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * A team rendered as its crest instead of its name, used by the compact
 * homepage standings cards.
 *
 * WHY THIS ONE EARNED A STORY AHEAD OF better-used components: it is the
 * component that exposes `TeamIconDarkStyles`, which Storybook did not
 * reproduce until this branch. The layout injects 51 rules — an `iconDark`
 * swap for 11 of TheLeague's 16 franchises and 10 of the AFL's 24, plus a
 * white-stroke fallback for crests measured illegible on a dark card — and a
 * story got NONE of them. Every crest rendered its light artwork in dark mode,
 * and Chromatic would have accepted that as the baseline.
 *
 * `.storybook/preview.ts` now calls the same composition the layout does
 * (src/utils/team-icon-dark-styles.ts), so these stories exercise the real
 * rules. They are the standing guard on that wiring: if the injection is ever
 * dropped, DarkSwapAvailable stops changing between themes.
 *
 * themeModes, NOT allModes — and this one is worth stating because it looks
 * like the exception. Both leagues' crests appear here, but the league axis is
 * carried by the ARGS (the icon path picks the league), not by the skin: the
 * dark rules are emitted for both leagues with no league branching and are
 * keyed on exact `src`, so `html[data-league]` does not participate at all. An
 * AFL mode would be 10 pixel-identical snapshots a build. Modes are for axes
 * the args cannot express; here the args already express it.
 *
 * Crests come from public/ via staticDirs. No network.
 *
 * THE CREST LIST IS NOT COSMETIC. `STORY_ASSET_GLOBS` names these files
 * individually rather than globbing the two league trees, because those trees
 * hold ~700 files and any team's logo swap was starting a Chromatic build that
 * could not change a pixel. So swapping a crest here is a two-file change —
 * the new path has to enter the trigger too, or its regressions ship and get
 * auto-accepted as the baseline on main. `tests/chromatic-path-filter.test.ts`
 * text-scans this file and fails if you forget.
 *
 * Each crest is here for the BRANCH it covers, not for the team. Pick a
 * replacement by checking `src/data/crest-dark-stroke-manifest.json` against
 * the league config: `iconDark` = swap, `iconStrokeDark: "#hex"` = custom,
 * `iconStrokeDark: false` = opt-out, in the manifest with neither = default
 * white.
 *
 * THE STROKE BRANCHES ARE A SHRINKING POOL, and that is the live hazard here.
 * Every `iconDark` the asset sync adds REMOVES a team from the stroke set (the
 * manifest and `withStrokeColors` both exclude any team carrying one), so a
 * crest chosen today can silently become a swap test tomorrow with no edit to
 * this file. That is not hypothetical: main's dark sweep moved The Show off
 * custom-stroke and Running down the Dream off default-white while this branch
 * was open, and both stories kept passing while testing the wrong thing.
 *
 * As of Sept 2026, after that sweep: custom stroke has exactly ONE team left
 * (No Soup For You) and default white has three (Harambe, Badd Boys, Boondock
 * Saints — all AFL). If the sweep reaches those, the branch loses its last
 * representative and the fix is a synthetic fixture, not a repoint.
 */
export default {
  title: 'Theming/TeamIconCell',
  component: TeamIconCell,
  parameters: {
    chromatic: { modes: themeModes },
  },
};

/**
 * A franchise WITH a hand-authored dark crest. Light and dark must show
 * DIFFERENT artwork — that difference is the whole point, and it is the swap
 * rule doing it, not a filter.
 */
export const DarkSwapAvailable = {
  args: {
    icon: '/assets/theleague/icons/pigskins.png',
    name: 'Pacific Pigskins',
  },
};

/**
 * The SAME swap branch on the AFL side, and it is not a duplicate.
 *
 * `buildAllTeamIconDarkCss()` composes four builder calls across both leagues'
 * configs and two icon directories, and the pairing is load-bearing: a league's
 * stroke fallback must use the same `franchiseIconDir` as its swap or the
 * selectors miss. Only TheLeague's half of that was covered — every AFL crest
 * in this file is a STROKE case — so a composition that dropped or
 * mis-directed the AFL swap rules rendered light artwork in dark mode with
 * nothing failing.
 */
export const DarkSwapAvailableAfl = {
  args: {
    icon: '/assets/afl/icons/ninjas.png',
    name: 'The Mariachi Ninjas',
  },
};

/**
 * The DEFAULT WHITE STROKE branch. A crest with no dark variant that the
 * manifest measured as illegible on a dark card, and whose team sets no
 * `iconStrokeDark` — so it falls through to `DEFAULT_CREST_STROKE_COLOR`. Dark
 * mode must show the same artwork carrying a white outline.
 *
 * The swap and the stroke are mutually exclusive by construction: the manifest
 * and `withStrokeColors` both exclude any team with an `iconDark`, so a crest
 * can never get both.
 */
export const StrokeDefaultWhite = {
  args: {
    icon: '/assets/afl/icons/saints.png',
    name: 'The Boondock Saints',
  },
};

/**
 * The CUSTOM STROKE COLOR branch. Suh girls, one cup declares
 * `iconStrokeDark: "#ff769f"`, so it gets its own rule rather than joining the
 * shared white one — a crest whose silhouette reads better against its own
 * brand color than against white.
 *
 * This story has now been repointed TWICE by the dark-artwork sweep, because
 * giving a franchise a real `iconDark` removes it from the stroke set by
 * construction: it was on The Show until #685, then on No Soup For You until
 * the icon batch that followed. Both times the story kept passing while
 * silently testing the swap branch instead — the suite cannot catch this, so
 * check it by hand whenever a franchise named here gains dark artwork.
 *
 * Suh girls and Swiftie 4 Life are the two teams left on this branch. Prefer
 * Suh: Swiftie's `#ffffff` is the default hue spelled differently, so a reader
 * cannot tell its rule apart from the shared white one by looking.
 */
export const StrokeCustomColor = {
  args: {
    icon: '/assets/afl/icons/suh.png',
    name: 'Suh girls, one cup',
  },
};

/**
 * THE OPT-OUT, and the subtlest of the three.
 *
 * Cowboy Up is IN the measured manifest but sets `iconStrokeDark: false`,
 * which means "measured as illegible, and we still don't want a stroke". It
 * must render with NO filter in either theme.
 *
 * This is a standing guard on a trap the source itself calls out: the opt-out
 * is stored as `false`, so a truthiness filter (`filter(t => t.iconStrokeDark)`)
 * silently converts it into "never set" — which puts the crest back on the
 * DEFAULT white stroke, the exact treatment the `false` exists to refuse.
 * Nothing else in the suite covers that, and the bug would look like a feature
 * working.
 */
export const StrokeExplicitlyOptedOut = {
  args: {
    icon: '/assets/theleague/icons/cowboy_up.png',
    name: 'Cowboy Up',
  },
};

/**
 * No crest configured at all — the name renders instead of an empty cell.
 * Worth pinning because the crest is the row's ONLY identifier, so this path
 * is the difference between a degraded row and an erased one.
 */
export const NoCrestFallsBackToName = {
  args: { name: 'Wascawy Wabbits' },
};

/** The same fallback bolded, which marks the signed-in owner's own row. */
export const NoCrestEmphasised = {
  args: { name: 'Wascawy Wabbits', emphasis: true },
};
