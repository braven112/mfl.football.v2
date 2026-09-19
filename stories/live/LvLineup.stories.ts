import { createElement } from 'react';
import type { ReactElement } from 'react';
import LvLineup from '../../src/components/shared/live/LvLineup';
import {
  LIVE_BOX,
  LIVE_GAMES,
  LIVE_META,
  NEAR_BLACK_COLOR_VARS,
  SIDE0_STARTERS,
  SIDE1_STARTERS,
} from '../fixtures/live-kit';
import { themeModes } from '../../.storybook/modes';

/**
 * The matchup PAIR — the one place in the kit where a rendered result is the
 * thing at risk and no text assertion can see it.
 *
 * ── WHY THIS AND NOT `LvPlayerRow` ────────────────────────────────────────
 * A single row cannot show the hazard. `LvLineup` is what builds the `.lv-mx-row`
 * pair, and the pair is where the subgrid chain lives: the pair container owns
 * the row tracks, each side's wrapper is removed with `display: contents`, and
 * the row then spans all three tracks and adopts them with
 * `grid-template-rows: auto auto 1fr` followed by `grid-template-rows: subgrid`
 * — both declarations, **subgrid last**.
 *
 * `tests/live-scoring-layout-css.test.ts` asserts that ordering exists. It
 * cannot assert the two sides end up sharing a bottom edge, which is the only
 * thing the mechanism is for. Flip those two declarations and the test still
 * passes while the sides silently drift apart.
 *
 * Six pairs in one story, so this covers what four separate `LvPlayerRow`
 * stories would have cost — every state at once:
 *
 *  - **A genuinely three-line name.** Reserving two lines equalises one-
 *    against two-line names and cannot help a name that needs three;
 *    `Mike Washington Jr.` does at phone width, and its pair measures 122px
 *    against the others' 96-109 — the row that actually exercises subgrid.
 *  - **All three clock dots** — live, final, not-kicked-off.
 *  - **All three possession outcomes**, which are gated on the player's team
 *    having the ball and prefer the red-zone flag when both apply: KC has it
 *    inside the 20 (RED ZONE), ATL has it outside (down-and-distance), and
 *    PHI is in KC's own game without it (neither). A receiver flagged while
 *    his team is on defense is the bug this shape prevents.
 *  - **A DEF row**: local NFL mark rather than a headshot, and no stat line —
 *    ESPN's box score is athlete-keyed and MFL's 32 defences carry no athlete
 *    id, so there is no join key even in principle.
 *  - **The boom tone**, where live has passed the projection.
 *  - **A lopsided pair** — side 1 runs one starter short, and the pair count
 *    takes the longer side so no row is dropped.
 *
 * ── MODES: TWO, NOT SIX ───────────────────────────────────────────────────
 * Nothing here resolves a colour against a card ground. The rows read ink,
 * borders and the semantic tones, which `data-league` already themes
 * correctly, so the AFL and MFL grounds would buy pixel-identical snapshots —
 * the exact waste `.storybook/modes.ts` records for PlayerCell and
 * LineupGameStrip. The per-surface axis is spent once, on `MatchupCard`.
 *
 * The wrapper carries `NEAR_BLACK_COLOR_VARS` only because `.lv-matchup` is
 * where `--t0`/`--t1` are aliased; no row in a lineup draws a franchise colour.
 */
export default {
  title: 'Live/Lineup',
  component: LvLineup,
  parameters: {
    // Load-bearing. `@storybook-astro/renderer` short-circuits only on an
    // `isAstroComponentFactory` marker; a plain React function falls through to
    // the renderer named here, which the framework's preview sets to 'astro'
    // globally and which is not a registry key. Without this the story throws
    // `Renderer 'astro' not found` at CAPTURE time — Storybook still builds and
    // still exits 0, so only Chromatic sees it. See Trap 8 in the rules doc.
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
};

/** The pair wrapper a real detail screen provides. */
const wrap = (args: Record<string, unknown>) => ({
  args,
  decorators: [
    (Story: () => ReactElement) =>
      createElement(
        'div',
        { className: 'lv lv-matchup lv-mx-body', style: NEAR_BLACK_COLOR_VARS },
        createElement(Story),
      ),
  ],
});

/** Every row state, both sides, box-score lines present. */
export const Starters = wrap({
  side0: SIDE0_STARTERS,
  side1: SIDE1_STARTERS,
  meta: LIVE_META,
  gamesByTeam: LIVE_GAMES,
  boxScore: LIVE_BOX,
  detailStatus: 'ok',
});

/**
 * The ESPN box-score feed is unreadable.
 *
 * `detailStatus: 'error'` must SUPPRESS the stat slot entirely, not render
 * every starter as though he had done nothing. Silence means "no stats yet";
 * it must never be how "the feed is down" looks. The visible difference from
 * `Starters` is the whole assertion — same rows, no stat lines, and the rows
 * must not collapse to a different height in a way that shifts the scores.
 */
export const FeedDown = wrap({
  side0: SIDE0_STARTERS,
  side1: SIDE1_STARTERS,
  meta: LIVE_META,
  gamesByTeam: LIVE_GAMES,
  boxScore: LIVE_BOX,
  detailStatus: 'error',
});
