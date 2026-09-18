/**
 * What the shared kit's leaf components actually PRINT, and what they expose
 * to assistive tech.
 *
 * Asserted on the rendered string rather than on props, for the reason
 * `broadcast-score-header-ssr.test.ts` gives: a component can be wired up
 * correctly and still place a correct number where it says something else. The
 * a11y rules below are the clearest case — `role="img"` on a wrapper is
 * perfectly valid markup that silently removes everything inside it from the
 * accessibility tree, and no prop-level test can see that.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import LvWinProbBar from '../src/components/shared/live/LvWinProbBar';
import LvRedZoneBanner from '../src/components/shared/live/LvRedZoneBanner';
import LvEmptyState, { type LvEmptyReason } from '../src/components/shared/live/LvEmptyState';
import type { RedZoneAlert } from '../src/utils/broadcast-moments';

/**
 * React's SSR puts `<!-- -->` between adjacent text nodes, so `{n} to play`
 * renders as `3<!-- --> to play`. Strip them before asserting on prose —
 * otherwise a correct component fails a naive `toContain`.
 */
const text = (html: string) => html.replace(/<!-- -->/g, '');

const bar = (props: Partial<Parameters<typeof LvWinProbBar>[0]> = {}) =>
  renderToString(
    createElement(LvWinProbBar, {
      p0: 0.62,
      side0Name: 'Pacific Pigskins',
      side1Name: 'Motor City',
      ...props,
    }),
  );

describe('LvWinProbBar — the bar is decoration, the sentence is the data', () => {
  it('never puts role="img" on the wrapper', () => {
    // That is the bug being fixed. `role="img"` makes the element a LEAF, so
    // the percentages, the WIN PROBABILITY tag and the yet-to-play counts
    // inside it are never announced — `live-scoring.css` carries a comment
    // documenting that exact consequence and working around it at phone width.
    expect(bar()).not.toContain('role="img"');
  });

  it('hides the bar from assistive tech and announces the numbers once', () => {
    const html = bar();
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('visually-hidden');
    expect(html).toContain('Win probability: Pacific Pigskins 62%, Motor City 38%.');
    // ONE announced copy, at every width — so no breakpoint has to hide a
    // duplicate, which is what the ported board had to do.
    expect(html.match(/Win probability:/g)).toHaveLength(1);
  });

  it('names both sides in the sentence, so neither percentage is orphaned', () => {
    const html = bar({ side0Name: 'Alpha', side1Name: 'Beta' });
    expect(html).toContain('Alpha 62%');
    expect(html).toContain('Beta 38%');
  });

  it('rounds ONCE — the two halves can never sum to 101%', () => {
    // Rounding each side independently does exactly that for any x.5 split.
    for (const p0 of [0.005, 0.125, 0.375, 0.5, 0.625, 0.875, 0.995]) {
      const html = text(bar({ p0 }));
      const pcts = [...html.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
      const [a, b] = [pcts[0], pcts[1]];
      expect(a + b, `p0=${p0} produced ${a}% + ${b}%`).toBe(100);
    }
  });

  it('clamps a probability outside 0-1 rather than painting past the track', () => {
    expect(bar({ p0: 1.4 })).toContain('100%');
    expect(bar({ p0: -0.3 })).toContain('0%');
  });

  it('rides the seam on the split, not a fixed 50%', () => {
    // Otherwise two neighbouring brand colours read as one fill.
    expect(bar({ p0: 0.62 })).toContain('--lv-wp-split:38%');
  });

  it('mini drops the labels but keeps the announced sentence', () => {
    const html = bar({ mini: true });
    expect(html).toContain('lv-wp--mini');
    expect(html).not.toContain('WIN PROBABILITY');
    expect(html).toContain('Win probability: Pacific Pigskins 62%');
  });

  it('folds yet-to-play into the labels only when given', () => {
    expect(bar()).not.toContain('to play');
    const html = text(bar({ side0YetToPlay: 3, side1YetToPlay: 1 }));
    expect(html).toContain('3 to play');
    expect(html).toContain('1 to play');
  });

  it('a zero count still prints — "0 to play" is information, absent is not', () => {
    expect(text(bar({ side0YetToPlay: 0 }))).toContain('0 to play');
  });
});

const alert = (over: Partial<RedZoneAlert> = {}): RedZoneAlert => ({
  team: 'KC',
  downDistance: '1st & Goal at WSH 8',
  players: [
    {
      leagueId: '13522',
      leagueName: 'The League',
      side: 'mine',
      playerId: '1',
      playerName: 'Rashee Rice',
      position: 'WR',
    },
  ],
  ...over,
});

const redzone = (alerts: RedZoneAlert[], showLeague = false) =>
  renderToString(createElement(LvRedZoneBanner, { alerts, showLeague }));

describe('LvRedZoneBanner — a state, announced politely, never animated', () => {
  it('renders nothing at all when no drive is live', () => {
    // An empty shell would assert "nothing is happening", which is a
    // different claim from not asserting anything.
    expect(redzone([])).toBe('');
  });

  it('announces politely rather than as an alert', () => {
    const html = redzone([alert()]);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    // `role="alert"` is assertive and would interrupt on every poll that
    // re-derives the same drive.
    expect(html).not.toContain('role="alert"');
  });

  it('names the player and his position', () => {
    expect(redzone([alert()])).toContain('Rashee Rice (WR)');
  });

  it('prints down &amp; distance when ESPN gave one, and nothing when it did not', () => {
    expect(redzone([alert()])).toContain('1st &amp; Goal at WSH 8');
    // Never fabricated: a made-up down and distance is a claim about a real
    // game that can be wrong.
    const blank = redzone([alert({ downDistance: '' })]);
    expect(blank).not.toContain('—');
    expect(blank).toContain('Rashee Rice');
  });

  it('names the league only on a cross-league board', () => {
    expect(redzone([alert()], false)).not.toContain('The League');
    expect(redzone([alert()], true)).toContain('The League');
  });

  it('keeps several concurrent drives separate', () => {
    const html = redzone([
      alert(),
      alert({
        team: 'SF',
        players: [
          {
            leagueId: '19621',
            leagueName: 'AFL',
            side: 'opponent',
            playerId: '2',
            playerName: 'Brandon Aiyuk',
            position: 'WR',
          },
        ],
      }),
    ]);
    expect(html).toContain('Rashee Rice');
    expect(html).toContain('Brandon Aiyuk');
  });
});

describe('LvRedZoneBanner’s stylesheet cannot flash', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/live.css'), 'utf-8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const block = css.slice(css.indexOf('.lv-redzone'), css.indexOf('.lv-empty'));

  it('has no repeating animation — a drive-long flasher is a photosensitivity hazard', () => {
    expect(block).not.toMatch(/infinite/);
    expect(block).not.toMatch(/alternate/);
    expect(block).not.toMatch(/animation-iteration-count\s*:\s*(?!1\b)/);
  });

  it('still respects reduced motion for its one entrance fade', () => {
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.lv-redzone\s*\{\s*animation:\s*none/);
  });
});

describe('LvEmptyState — four states that must never collapse into two', () => {
  const REASONS: LvEmptyReason[] = ['not-played', 'no-matchup', 'unavailable', 'pre-season'];

  const empty = (reason: LvEmptyReason, leagueName?: string) =>
    renderToString(createElement(LvEmptyState, { reason, leagueName }));

  it.each(REASONS)('%s renders its own class and copy', (reason) => {
    const html = empty(reason);
    expect(html).toContain(`lv-empty--${reason}`);
    expect(html).toContain('role="status"');
  });

  it('gives every state DISTINCT copy — the whole point is that they differ', () => {
    const bodies = REASONS.map((r) => empty(r));
    expect(new Set(bodies).size).toBe(REASONS.length);
  });

  it('says an unplayed week is not a 0-0', () => {
    expect(empty('not-played')).toMatch(/not a 0-0/);
  });

  it('says missing is not zero when the read FAILED', () => {
    // "the feed says nothing" and "we could not reach the feed" stay
    // different facts all the way to the pixel.
    expect(empty('unavailable')).toMatch(/missing, not zero/);
  });

  it('names the league when a board holds several', () => {
    expect(empty('no-matchup', 'AFL')).toContain('AFL —');
    expect(empty('no-matchup')).not.toContain('—');
  });
});
