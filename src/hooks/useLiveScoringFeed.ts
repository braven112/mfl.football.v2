/**
 * One registered league's live scoring, through the SHARED poll store.
 *
 * Why this exists next to `LiveScoreboard`'s own `useLiveScoring`: that one is
 * a bespoke `setInterval` living inside a single component. One league, one
 * consumer, so it never mattered. The Sunday Ticket board watches EVERY league
 * an owner plays in and reads each league's feed from several places at once
 * (the game boxes, the matchup cards, the freshness pill), which turns a
 * per-consumer timer into N x M requests a minute against MFL.
 *
 * `createSharedPoller` fixes that structurally rather than by discipline:
 * requests are keyed by (year, week, league) so every consumer of a league
 * shares ONE request, an in-flight fetch is joined rather than duplicated, and
 * the timer runs at the MINIMUM interval any subscriber asks for — so a
 * finished league backing off cannot slow down one still playing.
 *
 * Two contracts inherited from the store, both load-bearing:
 *
 *  - **A failed poll KEEPS the last good data** and flips `status` to
 *    'error'. "We couldn't reach the feed" and "the feed says nothing" are
 *    different facts and stay separate all the way to the UI.
 *  - **`res.ok` is not "the data is good".** `/api/live-scoring` answers 200
 *    with `ok: false` and empty collections when the upstream MFL call fails.
 *    Throwing on that flag is what routes it into the error path above
 *    instead of wiping every score off a live board while the freshness pill
 *    reports the poll healthy (docs/claude/rules/live-scoring.md).
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createSharedPoller, type PollStatus } from '../utils/live-poll-store';
import { POLL_LIVE, POLL_STALE } from './useNflScoreboard';
import type { LivePlayerRow, MatchupPairing } from '../types/live-scoring';
import { hasLiveSignal } from '../utils/live-scoring-snapshot';

export interface LiveScoringResponse {
  ok?: boolean;
  week: number;
  scores: Record<string, number>;
  remaining: Record<string, number>;
  matchups: MatchupPairing[];
  players?: Record<string, LivePlayerRow[]>;
  bench?: Record<string, LivePlayerRow[]>;
  playersYetToPlay?: Record<string, number>;
}

interface Params {
  week: number;
  year: number;
  leagueId: string;
}

const poller = createSharedPoller<Params, LiveScoringResponse>(
  ({ week, year, leagueId }) => `${year}:${week}:${leagueId}`,
  async ({ week, year, leagueId }) => {
    const url = new URL('/api/live-scoring', window.location.origin);
    url.searchParams.set('week', String(week));
    url.searchParams.set('year', String(year));
    // `L` ALONE — never a `host` param. The route resolves a known league id
    // to its registry host outright, and a `host=<hostname>` param on a public
    // URL reads like SSRF to a WAF: the gameday health check's probes were
    // 403'd at the edge and never reached the route (2026-09-03).
    url.searchParams.set('L', leagueId);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`live-scoring ${res.status}`);
    const data: LiveScoringResponse = await res.json();
    if (data.ok === false) throw new Error('live-scoring upstream failed');
    return data;
  },
);

export interface LiveScoringFeedState {
  scores: Record<string, number>;
  remaining: Record<string, number>;
  matchups: MatchupPairing[];
  /** STARTERS only. The route keeps bench rows in their own map and we do not read it. */
  players: Record<string, LivePlayerRow[]>;
  playersYetToPlay: Record<string, number>;
  status: PollStatus;
  /** epoch ms of the last SUCCESSFUL poll; 0 when nothing has landed yet. */
  fetchedAt: number;
  /** True while any franchise still has NFL game-seconds to play. Drives cadence. */
  anyLive: boolean;
  /**
   * Whether MFL is actually scoring this week. False for an UNPLAYED week,
   * which MFL answers with a full payload of zeros rather than an error — see
   * `hasLiveSignal`. Consumers must not paint numbers when this is false, or
   * the board reports `Final 0.0 - 0.0` on a game nobody has played.
   */
  resolved: boolean;
}

const EMPTY_SCORES: Record<string, number> = {};
const EMPTY_PLAYERS: Record<string, LivePlayerRow[]> = {};
const EMPTY_MATCHUPS: MatchupPairing[] = [];

/**
 * @param enabled false in the offseason, off-window, or for an outside league
 *   — the hook then does no network at all.
 */
export function useLiveScoringFeed(
  leagueId: string,
  week: number,
  year: number,
  opts: { enabled?: boolean; live?: boolean } = {},
): LiveScoringFeedState {
  const { enabled = true, live = false } = opts;
  const params = useMemo(() => ({ week, year, leagueId }), [week, year, leagueId]);

  // Read the store during RENDER, not inside the subscribe callback, so the
  // cadence stays reactive: the store emits, this re-evaluates, and a changed
  // value gives `subscribe` a new identity which re-registers at the new
  // interval. Computed inside subscribe it would freeze at whatever was true
  // when the island mounted, and a league that finished would poll every
  // 60s forever.
  const remaining = poller.getState(params).data?.remaining;
  const liveNow = live || Object.values(remaining ?? {}).some((r) => r > 0);

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
    const raw = enabled ? snapshot.data : null;
    // The same gate the server applies before merging. An unplayed week comes
    // back as a well-formed payload of zeros, so `data.ok` and `res.ok` both
    // say healthy and only the CONTENT can tell us there is nothing to show.
    const resolved = raw
      ? hasLiveSignal({
          scores: raw.scores ?? {},
          remaining: raw.remaining ?? {},
          matchups: raw.matchups ?? [],
          players: raw.players ?? {},
          bench: raw.bench ?? {},
          playersYetToPlay: raw.playersYetToPlay ?? {},
        })
      : false;
    const data = resolved ? raw : null;
    const rem = data?.remaining ?? EMPTY_SCORES;
    return {
      scores: data?.scores ?? EMPTY_SCORES,
      remaining: rem,
      matchups: data?.matchups ?? EMPTY_MATCHUPS,
      players: data?.players ?? EMPTY_PLAYERS,
      playersYetToPlay: data?.playersYetToPlay ?? EMPTY_SCORES,
      status: enabled ? snapshot.status : 'idle',
      fetchedAt: snapshot.fetchedAt,
      anyLive: Object.values(rem).some((r) => r > 0),
      resolved,
    };
  }, [enabled, snapshot]);
}
