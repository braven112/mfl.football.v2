/**
 * The handheld board shares nothing with the television.
 *
 * docs/plans/broadcast-handheld.md's one hard rule is that the TV board does
 * not change. The handheld layout keeps that by construction — its own root
 * (`.lbh`), its own component, its own stylesheet — and this suite is what
 * keeps the construction honest:
 *
 *  1. every selector in `live-broadcast-handheld.css` is scoped under `.lbh`;
 *  2. the TV stylesheet never mentions `.lbh`;
 *  3. the island's server render — which is the TV board, on every device —
 *     carries no handheld markup;
 *  4. the handheld board itself renders.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import LiveBroadcast from '../src/components/shared/live-broadcast/LiveBroadcast';
import HandheldBoard from '../src/components/shared/live-broadcast/HandheldBoard';
import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastTeam,
} from '../src/types/live-broadcast';
import type { BroadcastMoment } from '../src/utils/broadcast-moments';
import type { NflGame } from '../src/types/live-scoring';

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule's selector list, skipping at-rule headers and keyframe steps. */
function selectors(css: string): string[] {
  const out: string[] = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{/g;
  let inKeyframes = 0;
  let depth = 0;
  let m: RegExpExecArray | null;
  // Track depth by walking braces so keyframe steps can be skipped.
  let last = 0;
  while ((m = re.exec(src))) {
    const between = src.slice(last, m.index);
    depth -= (between.match(/\}/g) ?? []).length;
    if (inKeyframes && depth < inKeyframes) inKeyframes = 0;
    const head = m[1].trim();
    depth += 1;
    last = re.lastIndex;
    if (head.startsWith('@keyframes')) {
      inKeyframes = depth;
      continue;
    }
    if (head.startsWith('@')) continue;
    if (inKeyframes) continue;
    for (const sel of head.split(',')) out.push(sel.trim());
  }
  return out;
}

describe('the handheld stylesheet is scoped', () => {
  const css = readFileSync('src/styles/live-broadcast-handheld.css', 'utf8');

  it('finds rules to check', () => {
    expect(selectors(css).length).toBeGreaterThan(20);
  });

  it('every selector starts at .lbh, or at an .lbh__ class only the handheld board renders', () => {
    // A bare `.lbh__x` rule is allowed because the TV render carries no `lbh`
    // class at all (checked below). The player-cell chip guard needs one: it
    // reads the chip class's own rule (`tests/player-cell-chip-sizing-guard`).
    const loose = selectors(css).filter((s) => !/^\.lbh(?:__[\w-]+)?(?![\w-])/.test(s));
    expect(loose, `selectors outside .lbh can reach the TV board:\n${loose.join('\n')}`).toEqual([]);
  });
});

describe('the TV stylesheet knows nothing of the handheld board', () => {
  it('has no .lbh rule', () => {
    const css = stripComments(readFileSync('src/styles/live-broadcast.css', 'utf8'));
    expect(css).not.toMatch(/\.lbh(?![\w-])/);
  });
});

const team = (id: string, name: string): BroadcastTeam => ({
  franchiseId: id,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: '',
  iconSmall: '',
  primary: '#123456',
  secondary: '#654321',
  swatch: '#abcdef',
  gradient: '',
});

const panel = {
  leagueId: '13522',
  leagueName: 'The League',
  slug: 'theleague',
  franchiseId: '0001',
  home: true,
  status: 'ok',
  matchups: [
    { index: 0, mine: team('0001', 'Pigskins'), opponent: team('0002', 'Pain') },
    { index: 1, mine: team('0001', 'Pigskins'), opponent: team('0003', 'Hammers') },
  ],
} as BroadcastLeaguePanel;

const scores: Record<string, BroadcastLeagueScore> = {
  '13522': {
    leagueId: '13522',
    ok: true,
    live: true,
    winProbability: [0.62, 0.4],
    teams: {
      '0001': { live: 87, projectedFinal: 110, remainingPoints: 23, yetToPlay: 2, players: [] },
      '0002': { live: 79.8, projectedFinal: 101, remainingPoints: 21, yetToPlay: 1, players: [] },
      '0003': { live: 91.2, projectedFinal: 104, remainingPoints: 12, yetToPlay: 1, players: [] },
    },
  },
};

describe('the island server-renders the TV board, never the handheld one', () => {
  it('has no .lbh markup', () => {
    const html = renderToString(
      createElement(LiveBroadcast, {
        pageData: JSON.stringify({
          week: 2,
          year: 2026,
          enabled: ['13522'],
          panels: [panel],
          playerMeta: {},
          initial: {
            ok: true,
            week: 2,
            fetchedAt: new Date().toISOString(),
            leagues: [scores['13522']],
            moments: [],
            redZone: [],
            games: [],
          },
          sound: false,
          demo: false,
          defenseFaces: {},
          available: [],
          pathname: '/theleague/broadcast',
        }),
      }),
    );
    expect(html).toContain('lbc is-board');
    expect(html).not.toMatch(/\blbh/);
  });
});

describe('the handheld board renders', () => {
  const base = {
    week: 6,
    panels: [panel],
    scores,
    games: [],
    meta: {},
    live: true,
    moment: null,
    momentTeam: null,
    momentScoreLine: '',
    redZone: [],
    statusText: '',
    statusError: false,
  };

  it('draws one card per matchup, doubleheaders included', () => {
    const html = renderToString(createElement(HandheldBoard, base));
    expect(html).toContain('class="lbh"');
    expect((html.match(/class="lbh__card[ "]/g) ?? []).length).toBe(2);
    expect(html).toContain('Game 2');
    expect(html).toContain('87.0');
    expect(html).toContain('91.2');
  });

  it('makes each readable card one button that opens its lineups', () => {
    const html = renderToString(createElement(HandheldBoard, base));
    expect((html.match(/class="lbh__card-hit"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-matchup="13522:1"');
    expect(html).toContain('aria-haspopup="dialog"');
    // Closed on first paint: no sheet until a tap.
    expect(html).not.toContain('lbh__sheet');
  });

  it('gives an unreadable feed no button, since there are no lineups to show', () => {
    const html = renderToString(
      createElement(HandheldBoard, { ...base, panels: [{ ...panel, status: 'unavailable' }] }),
    );
    expect(html).not.toContain('lbh__card-hit');
  });

  it('shows an em-dash, never 0.0, for a league whose feed could not be read', () => {
    const html = renderToString(
      createElement(HandheldBoard, { ...base, panels: [{ ...panel, status: 'unavailable' }] }),
    );
    expect(html).toContain('Feed unavailable');
    expect(html).toContain('—');
    expect(html).not.toContain('87.0');
  });

  it('shows a moment as a banner, mine and theirs styled apart', () => {
    const moment = {
      key: 'p1:13522:0001',
      playId: 'p1',
      leagueId: '13522',
      leagueName: 'The League',
      franchiseId: '0001',
      franchiseName: 'Pigskins',
      side: 'mine',
      kind: 'touchdown',
      playerId: '1',
      playerName: 'A Player',
      team: 'KC',
      text: 'A Player 12 Yd pass from B Player',
      clock: 'Q3 4:08',
      wallclock: new Date().toISOString(),
      scoreValue: 6,
      yards: 12,
    } as BroadcastMoment;
    const mine = renderToString(
      createElement(HandheldBoard, { ...base, moment, momentTeam: panel.matchups[0].mine, momentScoreLine: '93.0 – 79.8' }),
    );
    expect(mine).toContain('lbh__banner is-mine');
    expect(mine).toContain('+6');
    const theirs = renderToString(
      createElement(HandheldBoard, { ...base, moment: { ...moment, side: 'opponent' } as BroadcastMoment }),
    );
    expect(theirs).toContain('lbh__banner is-theirs');
    expect(theirs).toContain('Against you');
  });

  it('starts as one list of cards: pages are measured on the device, never assumed', () => {
    const html = renderToString(createElement(HandheldBoard, base));
    expect(html).toContain('class="lbh__cards"');
    expect(html).not.toContain('lbh__pager');
    expect(html).not.toContain('lbh__dot');
  });

  it("puts the owner's players whose team has the ball in the bar, ringed in the red zone", () => {
    const withRows = {
      ...scores,
      '13522': {
        ...scores['13522'],
        teams: {
          ...scores['13522'].teams,
          '0001': { ...scores['13522'].teams['0001'], players: [{ id: 'p1', live: 9, secondsRemaining: 900, status: 'starter' }] },
        },
      },
    } as Record<string, BroadcastLeagueScore>;
    const meta = { p1: { id: 'p1', name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 } };
    const game = (isRedZone: boolean) =>
      ({
        id: 'g', state: 'in', shortDetail: 'Q2', period: 2, clock: '', date: '',
        home: { code: 'KC', score: 7 }, away: { code: 'LV', score: 3 }, possession: 'KC',
        situation: { possession: 'KC', isRedZone, downDistanceText: '', shortDownDistanceText: '', lastPlay: '' },
      }) as NflGame;
    const html = renderToString(createElement(HandheldBoard, { ...base, scores: withRows, meta, games: [game(true)] }));
    expect(html).toContain('lbh__field');
    expect(html).toContain('lbh__field-p is-redzone');
    expect(html).toContain('Mahomes');
    expect(html).toContain('in the red zone');
    // Nobody on offense: no row at all.
    const quiet = renderToString(createElement(HandheldBoard, { ...base, scores: withRows, meta, games: [] }));
    expect(quiet).not.toContain('lbh__field');
  });
});
