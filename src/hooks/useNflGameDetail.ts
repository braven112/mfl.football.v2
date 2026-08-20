/**
 * useNflGameDetail — real box scores + scoring plays for the live page.
 *
 * Second (and last) poller on the page. It shares live-poll-store.ts with
 * useNflScoreboard, so a second island mounting mid-request joins the in-flight
 * fetch rather than starting its own, and a failure keeps the last good payload
 * instead of blanking the board.
 *
 * Everything it returns is keyed by MFL PLAYER ID — the join to ESPN athlete
 * ids happens server-side in /api/nfl-game-detail, deliberately, because
 * PlayerMeta.espnId can hold a college athlete id.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  LiveScoringPlay,
  NflGameDetailResponse,
  PlayerBoxScore,
} from '../types/live-scoring';
import { createSharedPoller, type PollStatus } from '../utils/live-poll-store';
import { POLL_LIVE, POLL_STALE } from './useNflScoreboard';

interface Params {
  week: number;
  year: number;
}

const poller = createSharedPoller<Params, NflGameDetailResponse>(
  ({ week, year }) => `${year}:${week}`,
  async ({ week, year }) => {
    const url = new URL('/api/nfl-game-detail', window.location.origin);
    url.searchParams.set('week', String(week));
    url.searchParams.set('year', String(year));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`nfl-game-detail ${res.status}`);
    const data: NflGameDetailResponse = await res.json();
    if (data.ok === false) throw new Error('nfl-game-detail upstream failed');
    return data;
  },
);

export interface NflGameDetailState {
  /** MFL player id → his box-score line. */
  boxScore: Record<string, PlayerBoxScore>;
  plays: LiveScoringPlay[];
  status: PollStatus;
  /**
   * True once a payload has landed. Lets the UI tell "no stat line yet" from
   * "we haven't asked yet" — the two look identical in the data.
   */
  loaded: boolean;
  /** Some games in the slate failed to expand; what we show is incomplete. */
  partial: boolean;
}

const EMPTY_BOX: Record<string, PlayerBoxScore> = {};
const EMPTY_PLAYS: LiveScoringPlay[] = [];

export function useNflGameDetail(
  week: number,
  year: number,
  opts: {
    enabled?: boolean;
    anyLive?: boolean;
    fallback?: { boxScore: Record<string, PlayerBoxScore>; plays: LiveScoringPlay[] };
  } = {},
): NflGameDetailState {
  const { enabled = true, anyLive = false, fallback } = opts;
  const params = useMemo(() => ({ week, year }), [week, year]);

  const snapshot = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (!enabled) return () => {};
        return poller.subscribe(params, anyLive ? POLL_LIVE : POLL_STALE, onChange);
      },
      [enabled, params, anyLive],
    ),
    () => poller.getState(params),
    () => poller.getState(params),
  );

  return useMemo(() => {
    if (!enabled) {
      return {
        boxScore: fallback?.boxScore ?? EMPTY_BOX,
        plays: fallback?.plays ?? EMPTY_PLAYS,
        status: 'ok' as PollStatus,
        loaded: !!fallback,
        partial: false,
      };
    }
    const data = snapshot.data;
    return {
      boxScore: data?.boxScore ?? EMPTY_BOX,
      plays: data?.plays ?? EMPTY_PLAYS,
      status: snapshot.status,
      loaded: !!data,
      partial: !!data && data.gamesLoaded < data.gamesRequested,
    };
  }, [enabled, fallback, snapshot]);
}
