import { createElement } from 'react';
import LvEmptyState from '../../src/components/shared/live/LvEmptyState';
import { themeModes } from '../../.storybook/modes';

/**
 * The four empty states, in one shot — because the assertion is that they look
 * DIFFERENT from each other.
 *
 * ── FOUR STATES, NOT TWO ──────────────────────────────────────────────────
 * Each pair that could be collapsed is a false claim the board would make:
 *
 *  - `not-played` — an unplayed week is a well-formed payload of ZEROS. Every
 *    franchise present, every score "0.00", every player `nonstarter`.
 *    `res.ok`, `data.ok`, a shape check and a franchise count all pass it, and
 *    printing it literally gives "0.0 – 0.0", which reads as a real game
 *    nobody scored in. Only `hasLiveSignal` separates it from a genuine 0-0.
 *  - `no-matchup` — the feed is fine and scoring; this viewer has no pairing.
 *    A bye is a fact, not a fault, and must not wear the error tone.
 *  - `unavailable` — we could not READ it. "The feed says nothing" and "we
 *    could not reach the feed" are different facts and stay different all the
 *    way to the pixel. This one takes the error tone so the two are not
 *    confusable at a glance.
 *  - `pre-season` — MFL serves no live scoring before the Week 1 Thursday and
 *    `getCurrentNFLWeek` returns 0 until then. Clamping that up to 1 is what
 *    hides the gap, so it is its own state rather than an error.
 *
 * `live-kit-leaves` already asserts that error and idle do not share a class.
 * What it cannot assert is that they are TELLABLE APART by eye — which is the
 * entire requirement, and which a shared tone or a token that resolves to the
 * same value in one theme would break silently. Rendering all four stacked is
 * what makes a regression obvious: three calm cards and one alarmed one.
 *
 * ── SHAPE ─────────────────────────────────────────────────────────────────
 * One story, two snapshots. Four separate stories would have cost eight and
 * shown each state alone, which is the one framing that cannot reveal a
 * collision between them.
 *
 * It is a `<div>`, not a button — no pointer, no hover accent, and no
 * win-probability bar (which over an empty card reads as a scrollbar). A
 * `leagueName` is passed to one of them because a cross-league board renders
 * several panels and an empty one has to say which league it is for.
 */
export default {
  title: 'Live/EmptyState',
  component: LvEmptyState,
  parameters: {
    // See Trap 8 — a React story must name its renderer or it throws at
    // capture time while `storybook build` still exits 0.
    renderer: 'react',
    layout: 'padded',
    chromatic: { modes: themeModes },
  },
};

/** All four reasons, stacked, so the error tone is visibly the odd one out. */
export const AllReasons = {
  render: () =>
    createElement(
      'div',
      { className: 'lv', style: { display: 'grid', gap: '1rem', maxWidth: '38rem' } },
      createElement(LvEmptyState, { key: 'a', reason: 'not-played' }),
      createElement(LvEmptyState, { key: 'b', reason: 'no-matchup' }),
      createElement(LvEmptyState, { key: 'c', reason: 'unavailable', leagueName: 'AFL Fantasy' }),
      createElement(LvEmptyState, { key: 'd', reason: 'pre-season' }),
    ),
};
