/**
 * Guard: the win-probability bar reads in the SAME order, and the same
 * colours, as the score header its caller draws above it.
 *
 * ── THE BUG (Sep 2026, hotfix #1213) ──────────────────────────────────────
 * `LvWinProbBar` drew side 1 on the left while both callers passed the team
 * they render on the LEFT as side 0, so every matchup detail put the left
 * team's score over the right team's share (Smokane FC, 23.4 on the left, was
 * drawn at 58% on the RIGHT). It also coloured by POSITION, so MFL Live's
 * viewer-first reorder painted each team in the other's colour.
 *
 * ── WHY A CALLER-LEVEL TEST ───────────────────────────────────────────────
 * `live-kit-leaves` pins the bar on its own: side 0 left, `side0Tone` picks
 * the colour. That cannot see a CALLER that stops passing `side0Tone` — the
 * prop defaults to 0, so the bar keeps rendering, correctly ordered, in the
 * wrong team's colour whenever `renderOrder` swaps the pair. Only a render of
 * the caller shows the header and the bar side by side, which is the claim a
 * viewer actually reads.
 *
 * Every case is rendered: both matchup sides as the viewer's, with and
 * without `viewerFirst` — the swap happens in exactly one of the four.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import LvMatchupCard from '../src/components/shared/live/LvMatchupCard';
import LvMatchupDetail from '../src/components/shared/live/LvMatchupDetail';
import { LIVE_MATCHUP, LIVE_META } from '../stories/fixtures/live-kit';
import type { LiveMatchup } from '../src/types/live';

const noop = () => {};

const CASES: Array<{ viewerSide: 0 | 1; viewerFirst: boolean; swapped: boolean }> = [
  { viewerSide: 0, viewerFirst: false, swapped: false },
  { viewerSide: 0, viewerFirst: true, swapped: false },
  { viewerSide: 1, viewerFirst: false, swapped: false },
  { viewerSide: 1, viewerFirst: true, swapped: true },
];

/** p0 deliberately far from 50 so a mirrored bar cannot pass by symmetry. */
const matchupFor = (viewerSide: 0 | 1): LiveMatchup => ({ ...LIVE_MATCHUP, viewerSide, p0: 0.68 });

/** The bar's fills, left to right, as [tone, width%]. */
const fills = (html: string) =>
  [...html.matchAll(/lv-wp__fill(\d)" style="width:(\d+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** The ink tone of each score in the header, left to right. */
const inks = (html: string, scoreClass: string) =>
  [...html.matchAll(new RegExp(`${scoreClass}" style="color:var\\(--t(\\d)-ink\\)`, 'g'))].map((m) =>
    Number(m[1]),
  );

const expected = (swapped: boolean) => {
  const [first, second] = swapped ? [1, 0] : [0, 1];
  const pFirst = Math.round((first === 0 ? 0.68 : 0.32) * 100);
  return { first, second, pFirst, pSecond: 100 - pFirst };
};

describe('LvMatchupDetail — bar under the score header', () => {
  for (const c of CASES) {
    it(`viewerSide ${c.viewerSide}, viewerFirst ${c.viewerFirst}`, () => {
      const html = renderToString(
        createElement(LvMatchupDetail, {
          matchup: matchupFor(c.viewerSide),
          meta: LIVE_META,
          viewerFirst: c.viewerFirst,
          onBack: noop,
        }),
      );
      const e = expected(c.swapped);
      expect(inks(html, 'lv-scorehead__score')).toEqual([e.first, e.second]);
      expect(fills(html)).toEqual([
        [e.first, e.pFirst],
        [e.second, e.pSecond],
      ]);
      // The labels wear the same inks as the scores they sit under.
      expect(html).toMatch(new RegExp(`lv-wp__l lv-wp__ink${e.first}">${e.pFirst}(<!-- -->)?%`));
      expect(html).toMatch(new RegExp(`lv-wp__r lv-wp__ink${e.second}">[^]*?${e.pSecond}(<!-- -->)?%`));
    });
  }
});

describe('LvMatchupCard — mini bar under the two rows', () => {
  for (const c of CASES) {
    it(`viewerSide ${c.viewerSide}, viewerFirst ${c.viewerFirst}`, () => {
      const html = renderToString(
        createElement(LvMatchupCard, {
          matchup: matchupFor(c.viewerSide),
          viewerFirst: c.viewerFirst,
          onOpen: noop,
        }),
      );
      const e = expected(c.swapped);
      expect(inks(html, 'lv-side__score')).toEqual([e.first, e.second]);
      expect(fills(html)).toEqual([
        [e.first, e.pFirst],
        [e.second, e.pSecond],
      ]);
    });
  }
});
