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
 * The sweep has since reached all of them. As of the end of Sept 2026 the
 * ENTIRE stroke set is one franchise — Swiftie 4 Life, and only because it
 * opts IN at 91% legible. Default white has NO team left (the four the
 * manifest still flags all opt out with `iconStrokeDark: false`), and custom
 * colour has none either, since Swiftie's `#ffffff` is the default hue.
 *
 * So the pool is not shrinking any more; it has essentially run out. The two
 * stroke stories here collapsed into one, and the branch coverage moved to
 * synthetic fixtures in `tests/broadcast-crest.test.ts`, which do not depend on
 * a franchise staying un-arted. If Swiftie ever gains an `iconDark`, this story
 * has nothing to point at either — delete it rather than pointing it at a crest
 * that no longer strokes.
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
 * THE STROKE, and there is now only one franchise left wearing one.
 *
 * A crest with no dark variant gets an outline so it does not dissolve into a
 * dark card. Swiftie 4 Life is the last franchise that renders one: its
 * `iconStrokeDark: "#ffffff"` is a config OPT-IN (the measurement scores it 91%
 * legible and never flagged it), and white happens to be the same hue the
 * shared default rule uses, so this story shows exactly what the default branch
 * looks like too.
 *
 * **No franchise can reach the true default branch any more.** It needs a team
 * that the manifest flagged AND that declares no colour; all four flagged teams
 * left (Minty Fresh, Ditka, Cowboy Up, Dark Magicians) set `iconStrokeDark:
 * false`, so they opt out instead. There is nothing to point a separate
 * default-white story at — `tests/broadcast-crest.test.ts` covers that branch
 * synthetically for the same reason.
 *
 * A companion `StrokeCustomColor` story lived here until the dark-artwork
 * sweep took its subject for the fourth time (The Show, then No Soup For You,
 * then Suh girls, each on gaining an `iconDark`). It was deleted rather than
 * repointed a fifth time: Swiftie is the only franchise left declaring a
 * colour, and `#ffffff` is the default hue spelled differently, so the story
 * would have been visually identical to this one.
 *
 * The swap and the stroke are mutually exclusive by construction: the manifest
 * and `withStrokeColors` both exclude any team with an `iconDark`, so a crest
 * can never get both. That is also why this story keeps losing subjects — and
 * why a franchise named here gaining dark artwork silently turns it into a swap
 * story that still passes. Check by hand.
 */
export const StrokeDefaultWhite = {
  args: {
    icon: '/assets/afl/icons/swift.png',
    name: 'Swiftie 4 Life',
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
