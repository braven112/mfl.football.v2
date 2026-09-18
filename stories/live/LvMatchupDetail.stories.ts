import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvMatchupDetail from '../../src/components/shared/live/LvMatchupDetail';
import { LIVE_BOX, LIVE_GAMES, LIVE_META, LIVE_MATCHUP } from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * The drill-in screen, at phone width — where the bug an owner actually
 * reported lived.
 *
 * ── THE REPORT ────────────────────────────────────────────────────────────
 * "padding is off and the left so seems cut off." The detail card ran off BOTH
 * edges on a phone: the franchise name clipped on the left, the opponent's
 * name and score clipped on the right, the win-probability percentages cut in
 * half.
 *
 * The cause is a rule that is CORRECT on one surface and wrong on the other.
 * The phone full-bleed cancels two gutters BY NAME — the layout's `main`
 * inline padding and `.lv-page`'s own — which is only valid under an ancestor
 * that has both. The league routes wrap the board in `.lv-page`; `/live`
 * renders the same board inside `MflAppLayout`, which has no such wrapper and
 * uses clamp-based gutters of its own. Unscoped, the rule pulled the card left
 * and right by two tokens that matched nothing above it, and there was nothing
 * up the chain to clip the overflow.
 *
 * It only reached one surface because the sheet only recently became shared: a
 * rule written for a stylesheet that served one page, handed to a second
 * surface with a different shell.
 *
 * ── WHY A SNAPSHOT AND NOT JUST THE GUARD ─────────────────────────────────
 * `live-scoring-layout-css` now forbids a negative inline margin on a bare
 * `.lv-detail`, which is the rule the bug teaches and is the right guard for
 * it. But it is a rule about ONE declaration; it cannot see a card overflowing
 * for any other reason — a wide stat line, a three-line name, a score column
 * that outgrows its track. This story renders the real screen at 390px, which
 * is the width the report came from, and shows the whole composition: header,
 * win-probability bar, both lineups paired, the bench, the ticker.
 *
 * Deliberately rendered WITHOUT a `.lv-page` ancestor, i.e. as MFL Live draws
 * it — the surface that broke. The league routes' variant is the same markup
 * with a full bleed, and the `.lv-page` gutters exist only in the real layout,
 * which a story does not mount.
 *
 * ── ONE STORY, TWO MODES, ONE VIEWPORT ────────────────────────────────────
 * `viewports: [390]` replaces Chromatic's default rather than adding to it, so
 * this is 1 viewport x 2 themes = 2 snapshots. No league modes: nothing on
 * this screen resolves a colour against a card ground — the per-surface axis
 * is spent once, on `MatchupCard`.
 */
export default {
  title: 'Live/MatchupDetail',
  component: LvMatchupDetail,
  parameters: {
    // See Trap 8 — a React story must name its renderer or it throws at
    // capture time while `storybook build` still exits 0.
    renderer: 'react',
    layout: 'fullscreen',
    chromatic: { modes: themeModes, viewports: [390] },
  },
};

/**
 * The full drill-in at 390px.
 *
 * `momentStatus: 'idle'` rather than `'ok'` with an empty list: the ticker has
 * three states that must never collapse into two, and "nothing has scored yet"
 * is not "we could not read the play feed". A story showing an empty ticker
 * under `'ok'` would be modelling the honest-empty case; `'idle'` is what a
 * board actually passes before any play lands.
 */
export const PhoneWidth = {
  args: {
    matchup: LIVE_MATCHUP,
    meta: LIVE_META,
    gamesByTeam: LIVE_GAMES,
    boxScore: LIVE_BOX,
    detailStatus: 'ok',
    momentStatus: 'idle',
    viewerFirst: true,
    onBack: () => {},
  },
  decorators: [
    (Story: () => ReactElement) =>
      createElement('div', { className: 'lv' }, createElement(Story)),
  ],
};
