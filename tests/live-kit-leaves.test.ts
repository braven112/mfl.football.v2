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
import LvFeedStatus from '../src/components/shared/live/LvFeedStatus';
import LvMark from '../src/components/shared/live/LvMark';
import type { FeedSnapshot } from '../src/utils/live-scoring-view';
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

// ── LvFeedStatus ──────────────────────────────────────────────────────────

const feed = (over: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  status: 'ok',
  fetchedAt: Date.now(),
  ...over,
});

const pill = (feeds: FeedSnapshot[], anyLive = false, gamesLive = 0, compact = false) =>
  text(
    renderToString(
      createElement(LvFeedStatus, { feeds, anyLive, gamesLive, compact }),
    ),
  );

describe('LvFeedStatus — a heartbeat, or nothing at all', () => {
  it('renders NOTHING when no poller is enabled', () => {
    // With both feeds off (a bundled sample, a story) there is no freshness to
    // report. A pill stuck on "Connecting…" would be a lie in the other
    // direction from the static "Live" badge this replaced.
    expect(pill([])).toBe('');
  });

  it('says Connecting before anything has landed, and claims no age', () => {
    const html = pill([feed({ status: 'loading', fetchedAt: 0 })]);
    expect(html).toContain('Connecting');
    // fetchedAt 0 is not a timestamp — treating it as one printed "56 years
    // ago" on the board this ports from.
    expect(html).not.toMatch(/updated/);
    expect(html).not.toMatch(/ago/);
  });

  it('keeps a FAILED poll visually distinct from an idle one', () => {
    const failing = pill([feed({ status: 'error', fetchedAt: 0 })]);
    const idle = pill([feed({ status: 'loading', fetchedAt: 0 })]);
    expect(failing).toContain('lv-status--error');
    expect(failing).toContain('lv-dot--err');
    expect(idle).toContain('lv-status--pending');
    expect(failing).not.toBe(idle);
  });

  it('is announced as a status, not read as a caption', () => {
    expect(pill([feed()])).toContain('role="status"');
  });

  it('counts live games, and pluralises', () => {
    expect(pill([feed()], true, 1)).toContain('1 game live');
    expect(pill([feed()], true, 4)).toContain('4 games live');
  });

  it('drops the games clause in compact (detail-header) mode', () => {
    expect(pill([feed()], true, 4, true)).not.toContain('games live');
  });

  it('hides the games clause entirely when none is being played', () => {
    expect(pill([feed()], false, 0)).not.toMatch(/game/);
  });

  it('reports the NEWEST successful poll, not the first', () => {
    const html = pill([
      feed({ fetchedAt: Date.now() - 600_000 }),
      feed({ fetchedAt: Date.now() }),
    ]);
    expect(html).toMatch(/just now/);
  });

  it('keeps the error tone even when one feed is fresh', () => {
    // A failed poller outranks a healthy one: the board is showing the last
    // numbers it could confirm, and the pill must stop claiming they are
    // current.
    expect(pill([feed(), feed({ status: 'error' })])).toContain('lv-status--error');
  });
});

describe('LvFeedStatus\u2019s stylesheet carries every tone it can emit', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles/live.css'), 'utf8');

  it.each(['live', 'idle', 'error', 'pending'])('defines .lv-status--%s', (tone) => {
    expect(css).toContain(`.lv-status--${tone}`);
  });

  it('defines the error dot, which no other component emits', () => {
    expect(css).toContain('.lv-dot--err');
  });
});

/**
 * The mark is the identity ladder's rendering. What it PRINTS is the part that
 * can be wrong without any prop being wrong: an uploaded mark is decorative
 * beside a row that already names the team, but it is the only label on a
 * board where the name is elsewhere — and a failed load has to give the
 * franchise its initials back rather than an empty square.
 */
describe('LvMark — a mark, or the rung below it', () => {
  const CLASSES = { wrap: 'lv-side__crest', crop: 'lv-side__crest--crop', text: 'lv-side__initials' };
  const mark = (props: Partial<Parameters<typeof LvMark>[0]> = {}) =>
    text(
      renderToString(
        createElement(LvMark, {
          icon: 'https://www48.myfantasyleague.com/x.png',
          alt: 'Rhinos logo',
          initials: 'RH',
          classes: CLASSES,
          ...props,
        }),
      ),
    );

  it('prints the initials, not an empty box, when there is no mark', () => {
    const html = mark({ icon: '' });
    expect(html).toContain('RH');
    expect(html).toContain('lv-side__initials');
    expect(html).not.toContain('<img');
    // The text rung is a LABEL beside a name that is already announced.
    expect(html).toContain('aria-hidden="true"');
  });

  it('labels a real mark, and carries the crop class only when asked', () => {
    expect(mark()).toContain('alt="Rhinos logo"');
    expect(mark()).not.toContain(CLASSES.crop);
    expect(mark({ crop: true })).toContain(CLASSES.crop);
  });

  /**
   * `decorative` is for a row that already names the league beside the mark —
   * there the alt text would be announced twice, which is why it is empty
   * rather than absent.
   */
  it('goes silent where the caller already names the team', () => {
    const html = mark({ decorative: true });
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  /** An onError fallback cannot be rendered server-side — it is pinned by scan in
      `tests/mfl-live-uploaded-mark.test.ts`. What SSR must not do is pre-empt it. */
  it('renders the image on the server rather than guessing it will fail', () => {
    expect(mark()).toContain('<img');
  });
});
