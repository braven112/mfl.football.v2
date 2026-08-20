/**
 * useNflScoreboard — the page's ONE NFL scoreboard poller.
 *
 * The live-scoring page renders two islands that both want this data
 * (LiveScoreboard for real clocks and red-zone state, NflGamesStrip for the
 * rail). Each island is its own React root, so the dedup has to happen below
 * React: the store in live-poll-store.ts lives at module scope and is shared by
 * everything on the page that imports this hook. Adding a second `fetch` here
 * instead would have put three pollers on one page.
 *
 * Cadence mirrors LiveScoreboard's existing backoff: POLL_LIVE while any game
 * is in progress, POLL_STALE once none is. The store runs at the MINIMUM
 * interval any subscriber asks for, so the page only backs off when every
 * island agrees there is nothing live left.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { NflGame, NflScoreboardResponse } from '../types/live-scoring';
import { createSharedPoller, type PollStatus } from '../utils/live-poll-store';

export const POLL_LIVE = 60_000;
export const POLL_STALE = 300_000;

interface Params {
  week: number;
  year: number;
}

const poller = createSharedPoller<Params, NflScoreboardResponse>(
  ({ week, year }) => `${year}:${week}`,
  async ({ week, year }) => {
    const url = new URL('/api/nfl-scoreboard', window.location.origin);
    url.searchParams.set('week', String(week));
    url.searchParams.set('year', String(year));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`nfl-scoreboard ${res.status}`);
    const data: NflScoreboardResponse = await res.json();
    // The route 200s on an upstream failure and says so in `ok`. Treat that as
    // a rejected poll so the store keeps the last good games and flips to
    // 'error', rather than replacing a live board with an empty one.
    if (data.ok === false) throw new Error('nfl-scoreboard upstream failed');
    return data;
  },
);

export interface NflScoreboardState {
  games: NflGame[];
  status: PollStatus;
  /** True while at least one game is being played. Drives the poll cadence. */
  anyLive: boolean;
  /** Canonical NFL team code → that team's game. */
  byTeam: Map<string, NflGame>;
}

const EMPTY_GAMES: NflGame[] = [];

/**
 * @param enabled pass false in demo mode (bundled sample data) or when the
 *   caller supplies its own games — the hook then does no network at all.
 */
export function useNflScoreboard(
  week: number,
  year: number,
  opts: { enabled?: boolean; live?: boolean; fallbackGames?: NflGame[] } = {},
): NflScoreboardState {
  const { enabled = true, live = false, fallbackGames } = opts;
  const params = useMemo(() => ({ week, year }), [week, year]);

  // Read the store during render (not inside the subscribe callback) so the
  // cadence stays REACTIVE: the component re-renders whenever the store emits,
  // this re-evaluates, and a changed value gives `subscribe` a new identity,
  // which re-registers at the new interval. Computing it inside subscribe
  // would freeze the cadence at whatever was true when the island mounted, so
  // a board that went all-final would keep polling every 60s forever.
  // The caller's `live` hint (the page's game-day window) covers the first
  // load, before any games have arrived to look at.
  const liveNow =
    live || (poller.getState(params).data?.games ?? []).some((g) => g.state === 'in');

  const snapshot = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (!enabled) return () => {};
        return poller.subscribe(params, liveNow ? POLL_LIVE : POLL_STALE, onChange);
      },
      [enabled, params, liveNow],
    ),
    () => poller.getState(params),
    () => poller.getState(params),
  );

  return useMemo(() => {
    const games = enabled ? snapshot.data?.games ?? EMPTY_GAMES : fallbackGames ?? EMPTY_GAMES;
    const byTeam = new Map<string, NflGame>();
    for (const g of games) {
      if (g.home.code) byTeam.set(g.home.code, g);
      if (g.away.code) byTeam.set(g.away.code, g);
    }
    return {
      games,
      // With the fetch disabled there is nothing to have failed; caller-supplied
      // games are as authoritative as a successful poll.
      status: enabled ? snapshot.status : ('ok' as PollStatus),
      anyLive: games.some((g) => g.state === 'in'),
      byTeam,
    };
  }, [enabled, fallbackGames, snapshot]);
}
