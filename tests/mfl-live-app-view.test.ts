/**
 * Guard: the MFL Live app's Matchups board (`/api/live-board?source=mfl`).
 *
 * The phone may not import site code, so the server makes the web board's
 * client-side decisions for it and ships the answers
 * (`src/utils/live/mfl-live-app-view.ts`). These pin that each answer is the
 * web's own — and that the poll hint follows the NFL schedule and MFL's clock,
 * never a fixed timer.
 */

import { describe, it, expect } from 'vitest';
import {
  APP_POLL_IDLE_MS,
  APP_POLL_LIVE_MS,
  APP_POLL_OFFSEASON_MAX_MS,
  mflLiveAppCadence,
  slateFromKickoffs,
  toMflLiveAppBoard,
} from '../src/utils/live/mfl-live-app-view';
import type { MflLiveBoard, MflLiveTeam } from '../src/types/mfl-live';
import type { LivePlayerRow } from '../src/types/live-scoring';

const NOW = Date.parse('2026-10-25T20:00:00Z'); // a Sunday afternoon
const sec = (ms: number) => String(Math.floor(ms / 1000));
const HOUR = 60 * 60_000;

function row(id: string, live: number, secondsRemaining: number, projected?: number): LivePlayerRow {
  return { id, live, secondsRemaining, status: 'starter', ...(projected !== undefined ? { projected } : {}) };
}

function team(fid: string, players: LivePlayerRow[], bench: LivePlayerRow[] = []): MflLiveTeam {
  return {
    franchiseId: fid,
    name: `Team ${fid}`,
    nameShort: fid,
    initials: 'T',
    icon: '',
    iconAlt: '',
    rung: 'text',
    live: players.reduce((s, p) => s + p.live, 0),
    projectedFinal: 100,
    yetToPlay: players.filter((p) => p.secondsRemaining >= 3600).length,
    players,
    bench,
  };
}

function board(mine: LivePlayerRow[], theirs: LivePlayerRow[], week = 8): MflLiveBoard {
  return {
    ok: true,
    week,
    year: 2026,
    fetchedAt: new Date(NOW).toISOString(),
    leagues: [
      {
        leagueId: '99999',
        leagueName: 'Outside league',
        franchiseId: '0001',
        slug: null,
        registered: false,
        status: 'ok',
        matchups: [
          {
            index: 0,
            mine: team('0001', mine, [row('b1', 3, 0, 8)]),
            opponent: team('0002', theirs),
            winProbability: 0.62,
            colorVars: {},
          },
        ],
      },
    ],
    games: [],
    moments: [],
    redZone: [],
    playerMeta: {},
  };
}

describe('the poll hint', () => {
  it('polls at the live cadence while MFL says a starter is playing, whatever the schedule says', () => {
    const b = board([row('p1', 10, 900)], [row('p2', 4, 3600)]);
    expect(mflLiveAppCadence(b, [], NOW)).toEqual({ live: true, pollAfterMs: APP_POLL_LIVE_MS });
  });

  it('polls live inside a scheduled game window, before MFL has moved anyone', () => {
    const b = board([row('p1', 0, 3600)], [row('p2', 0, 3600)]);
    expect(mflLiveAppCadence(b, [sec(NOW - HOUR)], NOW).live).toBe(true);
  });

  it('goes live shortly before a kickoff, not hours ahead of one', () => {
    const b = board([row('p1', 0, 3600)], [row('p2', 0, 3600)]);
    expect(mflLiveAppCadence(b, [sec(NOW + 10 * 60_000)], NOW).live).toBe(true);
    expect(mflLiveAppCadence(b, [sec(NOW + 3 * HOUR)], NOW)).toEqual({ live: false, pollAfterMs: APP_POLL_IDLE_MS });
  });

  it('stops the fast cadence once the slate is over', () => {
    const b = board([row('p1', 20, 0)], [row('p2', 9, 0)]);
    expect(mflLiveAppCadence(b, [sec(NOW - 5 * HOUR)], NOW)).toEqual({ live: false, pollAfterMs: APP_POLL_IDLE_MS });
  });

  it('with no NFL week running, waits until just before the next kickoff, capped at an hour', () => {
    const empty = { week: 0, leagues: [] };
    expect(mflLiveAppCadence(empty, [sec(NOW + 30 * 60_000)], NOW).pollAfterMs).toBe(15 * 60_000);
    expect(mflLiveAppCadence(empty, [sec(NOW + 30 * 24 * HOUR)], NOW).pollAfterMs).toBe(APP_POLL_OFFSEASON_MAX_MS);
    expect(mflLiveAppCadence(empty, [], NOW).pollAfterMs).toBe(APP_POLL_OFFSEASON_MAX_MS);
  });

  it('reads MFL kickoffs as epoch SECONDS', () => {
    const [g] = slateFromKickoffs([sec(NOW + HOUR)], NOW);
    expect(g).toEqual({ state: 'pre', date: new Date(Math.floor((NOW + HOUR) / 1000) * 1000).toISOString() });
  });
});

describe('the board the app renders', () => {
  it('ships each row’s game state and projected final, and the bench too', () => {
    const view = toMflLiveAppBoard(board([row('p1', 10, 1800, 20), row('p3', 0, 3600)], [row('p2', 4, 0, 9)]), [], NOW);
    const m = view.leagues[0].matchups[0];
    expect(m.mine.players[0]).toMatchObject({ gameState: 'in-progress', projectedFinal: 20 });
    // No projection is not "projects 0": the field stays absent.
    expect(m.mine.players[1]).toMatchObject({ gameState: 'not-started' });
    expect(m.mine.players[1]).not.toHaveProperty('projectedFinal');
    expect(m.opponent.players[0]).toMatchObject({ gameState: 'final', projectedFinal: 4 });
    expect(m.mine.bench[0]).toMatchObject({ gameState: 'final', projectedFinal: 3 });
    expect(m.isFinal).toBe(false);
  });

  it('calls a matchup Final only when every starter’s game is over', () => {
    const view = toMflLiveAppBoard(board([row('p1', 20, 0)], [row('p2', 9, 0)]), [], NOW);
    expect(view.leagues[0].matchups[0].isFinal).toBe(true);
  });

  it('prints scores at the precision /live prints them', () => {
    const view = toMflLiveAppBoard(board([row('p1', 1, 0)], [row('p2', 1, 0)]), [], NOW);
    expect(view.leagues[0].scorePrecision).toBe(2);
  });

  it('keeps the base contract’s fields untouched', () => {
    const b = board([row('p1', 10, 900)], [row('p2', 4, 3600)]);
    const view = toMflLiveAppBoard(b, [], NOW);
    expect(view.leagues[0].matchups[0].winProbability).toBe(0.62);
    expect(view.leagues[0].matchups[0].mine.live).toBe(10);
    expect(view.week).toBe(8);
    expect(view.pollAfterMs).toBe(APP_POLL_LIVE_MS);
  });
});
