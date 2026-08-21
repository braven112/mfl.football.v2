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
import { espnOverrideKey } from '../utils/espn-scoreboard-url';
import { POLL_LIVE, POLL_STALE } from './useNflScoreboard';

interface Params {
  week: number;
  year: number;
  /**
   * Signature of the ?espnSeason/?espnWeek/?espnYear override, '' when there
   * is none. Part of the cache key AND the thing the fetch is built from, so
   * an entry can never describe a different slate than the one it holds — see
   * espnOverrideKey for the soft-navigation case that made this necessary.
   */
  overrides: string;
}

const poller = createSharedPoller<Params, NflGameDetailResponse>(
  ({ week, year, overrides }) => `${year}:${week}${overrides ? `:${overrides}` : ''}`,
  async ({ week, year, overrides }) => {
    const url = new URL('/api/nfl-game-detail', window.location.origin);
    url.searchParams.set('week', String(week));
    url.searchParams.set('year', String(year));
    // Must match useNflScoreboard's target, or the board pairs one slate's
    // games with another slate's box scores. Same reasoning for reading it
    // from `overrides`: request and cache key stay in lockstep.
    for (const [k, v] of new URLSearchParams(overrides)) url.searchParams.set(k, v);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`nfl-game-detail ${res.status}`);
    const data: NflGameDetailResponse = await res.json();
    if (data.ok === false) throw new Error('nfl-game-detail upstream failed');
    return data;
  },
);

/**
 * The override signature for the page as it stands right now. Empty during
 * SSR — there is no location to read, and the store is empty on the server
 * anyway, so the server and first-client snapshots still agree.
 */
function currentEspnOverrides(): string {
  return typeof window === 'undefined' ? '' : espnOverrideKey(window.location.search);
}

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
  /** epoch ms of the last SUCCESSFUL poll; 0 when nothing has landed yet. */
  fetchedAt: number;
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
  // Read on every render, not once: with ClientRouter a soft navigation
  // changes the URL under a mounted island. A changed signature gives
  // `subscribe` a new identity, which re-registers on the new key and loads
  // immediately rather than serving the previous slate until the next tick.
  const overrides = currentEspnOverrides();
  const params = useMemo(() => ({ week, year, overrides }), [week, year, overrides]);

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
        fetchedAt: 0,
      };
    }
    const data = snapshot.data;
    return {
      boxScore: data?.boxScore ?? EMPTY_BOX,
      plays: data?.plays ?? EMPTY_PLAYS,
      status: snapshot.status,
      loaded: !!data,
      partial: !!data && data.gamesLoaded < data.gamesRequested,
      fetchedAt: snapshot.fetchedAt,
    };
  }, [enabled, fallback, snapshot]);
}
