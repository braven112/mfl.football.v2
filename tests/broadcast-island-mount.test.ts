/**
 * The island RENDERS. That is the whole assertion, and it is not trivial.
 *
 * Extracting the cadence policy into `broadcast-cadence.ts` left three bare
 * references behind in this file — `STALE_MS` and `QUIET_MS` moved with a
 * block they sat between — and `ts(2304) Cannot find name` is a ReferenceError
 * at runtime, so the board threw on its first render. The full unit suite went
 * green anyway: 12,923 tests, not one of which mounted this component. The
 * only thing that caught it was `astro check`, a three-minute job deliberately
 * kept out of the default suite.
 *
 * So: mount it. `renderToString` never runs an effect, so this says nothing
 * about the timers — that policy is tested in `broadcast-cadence.test.ts` —
 * but it executes the whole render body, which is where a board is most often
 * broken outright. Three states, because the render body branches hard on
 * them: a live board, a quiet one (the screensaver, which is what a television
 * left on overnight is actually showing), and the rehearsal.
 */

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import LiveBroadcast from '../src/components/shared/live-broadcast/LiveBroadcast';
import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastPollResponse,
  BroadcastTeam,
  LiveBroadcastPageData,
} from '../src/types/live-broadcast';
import type { NflGame, PlayerMeta } from '../src/types/live-scoring';

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

const panel: BroadcastLeaguePanel = {
  leagueId: '13522',
  leagueName: 'The League',
  slug: 'theleague',
  franchiseId: '0001',
  home: true,
  status: 'ok',
  matchups: [{ index: 0, mine: team('0001', 'Pigskins'), opponent: team('0002', 'Pain') }],
} as BroadcastLeaguePanel;

const meta: Record<string, PlayerMeta> = {
  '10001': {
    id: '10001',
    name: 'A Player',
    position: 'RB',
    nflTeam: 'KC',
    headshot: '',
  } as PlayerMeta,
};

const score = (live: boolean): BroadcastLeagueScore => ({
  leagueId: '13522',
  ok: true,
  live,
  winProbability: [0.5],
  teams: {
    '0001': {
      live: 87,
      projectedFinal: 110,
      remainingPoints: 23,
      yetToPlay: 1,
      players: [{ id: '10001', live: 12.4, secondsRemaining: live ? 900 : 0, status: 'starter' }],
    },
    '0002': {
      live: 79.8,
      projectedFinal: 101,
      remainingPoints: 21,
      yetToPlay: 1,
      players: [{ id: '10001', live: 9.1, secondsRemaining: live ? 900 : 0, status: 'starter' }],
    },
  },
});

const game = (state: NflGame['state']): NflGame =>
  ({
    id: '401',
    state,
    shortDetail: state === 'in' ? '8:12 - 3rd' : state === 'post' ? 'Final' : 'Sun 1:00 PM ET',
    period: state === 'pre' ? 0 : 3,
    clock: state === 'in' ? '8:12' : '0:00',
    home: { code: 'KC', score: 17 },
    away: { code: 'DEN', score: 10 },
    possession: null,
    date: '2026-09-21T17:00:00Z',
  }) as NflGame;

const poll = (live: boolean): BroadcastPollResponse => ({
  ok: true,
  week: 2,
  fetchedAt: new Date().toISOString(),
  leagues: [score(live)],
  moments: [],
  redZone: [],
  games: [game(live ? 'in' : 'post')],
});

const pageData = (over: Partial<LiveBroadcastPageData> = {}): string =>
  JSON.stringify({
    week: 2,
    year: 2026,
    enabled: ['13522'],
    panels: [panel],
    playerMeta: meta,
    initial: poll(true),
    sound: false,
    demo: false,
    defenseFaces: {},
    available: [{ id: '13522', name: 'The League', registered: true, enabled: true }],
    pathname: '/theleague/broadcast',
    ...over,
  });

const render = (data: string) => renderToString(createElement(LiveBroadcast, { pageData: data }));

describe('the broadcast island mounts', () => {
  it('renders a live board', () => {
    const html = render(pageData());
    expect(html).toContain('lbc');
    expect(html.length).toBeGreaterThan(200);
  });

  it('renders a quiet board — what a television left on overnight shows', () => {
    // `everLive` false takes the screensaver branch immediately, which is the
    // state the overnight throttle and the self-reboot both key on.
    const html = render(
      pageData({ initial: { ...poll(false), games: [game('pre')], leagues: [score(false)] } }),
    );
    expect(html).toContain('lbc');
    expect(html.length).toBeGreaterThan(200);
  });

  it('renders the rehearsal', () => {
    const html = render(pageData({ demo: true }));
    expect(html).toContain('lbc');
  });

  it('renders a board whose feed could not be read', () => {
    // ok:false must render an honest board, not throw.
    const html = render(pageData({ initial: { ...poll(false), ok: false, leagues: [] } }));
    expect(html).toContain('lbc');
  });
});
