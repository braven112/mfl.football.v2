import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvMatchupCard from '../../src/components/shared/live/LvMatchupCard';
import { LIVE_MATCHUP, NEAR_BLACK_MATCHUP } from '../fixtures/live-kit';
import { liveSurfaceModes, themeModes } from '../../.storybook/modes';

/**
 * The faceoff card — and the one story in the kit that earns all six surfaces.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 * `LiveScoreboard.tsx` hardcoded `LS_DARK_BG = '#262626'` — TheLeague's dark
 * card — and the AFL rendered the same island on a `#16283c` navy one. Judged
 * against the wrong ground, the worst AFL franchise landed at ΔE 10.7 against
 * the card it was actually drawn on, below the ΔE 18 `resolveTeamColorPair`
 * itself promises. `A Bruin Pegs Me` shipped `#002244` on `#16283c` — 1.07:1,
 * indistinguishable from the card. Invisible in review because it was correct
 * in light mode, correct on TheLeague, and wrong only for some franchises on
 * one league in one theme.
 *
 * ── WHAT THIS STORY DOES AND DOES NOT PIN ─────────────────────────────────
 * It does NOT re-test resolution. That happens server-side and is already
 * guarded by `live-surface-grounds` and `live-ground-literals`, and a story
 * could not test it anyway: `colorVars` is one static set of four properties
 * and a story's args cannot vary per Chromatic mode, so all three grounds here
 * receive the AFL-resolved pair.
 *
 * What it DOES pin is the half that lives in CSS and has no other guard: that
 * `live.css` aliases `--t0`/`--t1` out of the light/dark pair per theme, in one
 * rule, and keeps doing it on every card ground. Drop or misscope that
 * aliasing rule and the colours vanish or invert — and a `var()` with no
 * definition renders its fallback in BOTH themes, so light looks perfect while
 * dark ships wrong. Six snapshots is the only thing that sees that.
 *
 * The colours come from `resolveMatchupColorVars` in the fixture rather than
 * written-out hexes: a literal cannot be checked against the real tokens, and
 * `live-ground-literals` makes `live/surface.ts` the only place a ground may be
 * named at all.
 *
 * ── MODES WIDEN, THEY NEVER NARROW ────────────────────────────────────────
 * Storybook DEEP-MERGES parameters, so a story-level `modes` map is unioned
 * with the component-level one rather than replacing it. The default here is
 * therefore the CHEAP one and the story that genuinely needs every ground opts
 * UP. Written the other way round, `ViewerLead`'s attempt to drop back to two
 * would silently still cost six — the same trap `Live/WinProbBar` records.
 */
export default {
  title: 'Live/MatchupCard',
  component: LvMatchupCard,
  parameters: {
    // See Trap 8 — a story over a non-`.astro` component must name its
    // renderer or it throws at capture time while the build still exits 0.
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
};

const wrap = (args: Record<string, unknown>, modes?: Record<string, unknown>) => ({
  args: { onOpen: () => {}, ...args },
  ...(modes ? { parameters: { chromatic: { modes } } } : {}),
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv' }, createElement(Story)),
  ],
});

/**
 * Two near-black franchises on all three card grounds — the one story that
 * opts up to six modes, because a ground is what decides whether these
 * colours are visible at all.
 *
 * `#181818` is seven TheLeague franchises' real colour; `#002244` is the one
 * that shipped at 1.07:1. Both must remain visible as distinct colours in
 * every snapshot.
 *
 * `viewerSide: null`, so it also pins that a card nobody owns carries no
 * "YOUR MATCHUP" badge.
 */
export const NearBlackPair = wrap({ matchup: NEAR_BLACK_MATCHUP }, liveSurfaceModes);

/**
 * The viewer's own matchup, leading its panel — two modes.
 *
 * The badge, the `lead` treatment and an ordinary brand pair read design
 * tokens that `data-league` already themes, so the extra grounds would be
 * pixel-identical to TheLeague's: the waste `.storybook/modes.ts` records for
 * PlayerCell and LineupGameStrip.
 *
 * `viewerFirst` puts the owner's side first — the cross-league board's
 * behaviour — while `viewerSide` alone still decides the badge.
 */
export const ViewerLead = wrap({ matchup: LIVE_MATCHUP, viewerFirst: true, lead: true });
