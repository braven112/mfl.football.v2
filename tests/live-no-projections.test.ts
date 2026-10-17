/**
 * A matchup with no projections (a Sleeper league on MFL Live) draws no
 * win-probability bar and no projected figures.
 *
 * With an empty projections map the bar splits on the live score alone and
 * reads a hard 100/0, and every "proj" repeats the live number — confidently
 * wrong rather than absent. `noProjections` is what turns all of it off, on
 * the card, the drill-in, and each player row.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LvMatchupCard from '../src/components/shared/live/LvMatchupCard';
import LvMatchupDetail from '../src/components/shared/live/LvMatchupDetail';
import { LIVE_MATCHUP, LIVE_META } from '../stories/fixtures/live-kit';
import type { LiveMatchup } from '../src/types/live';

const card = (m: LiveMatchup) => renderToStaticMarkup(createElement(LvMatchupCard, { matchup: m, onOpen: () => {} }));
const detail = (m: LiveMatchup) =>
  renderToStaticMarkup(createElement(LvMatchupDetail, { matchup: m, meta: LIVE_META, onBack: () => {} }));

const WP = /lv-wp/;

describe('noProjections', () => {
  it('leaves an ordinary matchup exactly as it was', () => {
    expect(card(LIVE_MATCHUP)).toMatch(WP);
    expect(card(LIVE_MATCHUP)).toContain('lv-side__proj');
    expect(card(LIVE_MATCHUP)).toContain('Proj ');
    expect(detail(LIVE_MATCHUP)).toContain('lv-detail__wp');
    expect(detail(LIVE_MATCHUP)).toContain('lv-pproj');
  });

  it('drops the bar and every projected figure', () => {
    const m = { ...LIVE_MATCHUP, noProjections: true } as LiveMatchup;
    const c = card(m);
    expect(c).not.toMatch(WP);
    expect(c).not.toContain('lv-side__proj');
    expect(c).not.toContain('Proj ');
    const d = detail(m);
    expect(d).not.toContain('lv-detail__wp');
    expect(d).not.toContain('lv-pproj');
  });
});
