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
import type { EspnSlotInfo, NflGame, NflScoreboardResponse } from '../types/live-scoring';
import { createSharedPoller, type PollStatus } from '../utils/live-poll-store';
import { espnOverrideKey } from '../utils/espn-scoreboard-url';

export const POLL_LIVE = 60_000;
export const POLL_STALE = 300_000;

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

const poller = createSharedPoller<Params, NflScoreboardResponse>(
  ({ week, year, overrides }) => `${year}:${week}${overrides ? `:${overrides}` : ''}`,
  async ({ week, year, overrides }) => {
    const url = new URL('/api/nfl-scoreboard', window.location.origin);
    url.searchParams.set('week', String(week));
    url.searchParams.set('year', String(year));
    // Carry the validation override through to every poll, not just the first
    // render — otherwise the board silently reverts to the normal slate a
    // minute in, which is a maddening way to lose an evening. It comes from
    // `overrides` rather than from window.location so the request can never
    // disagree with the cache key it was stored under.
    for (const [k, v] of new URLSearchParams(overrides)) url.searchParams.set(k, v);
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

/**
 * The override signature for the page as it stands right now. Empty during
 * SSR — there is no location to read, and the store is empty on the server
 * anyway, so the server and first-client snapshots still agree.
 */
function currentEspnOverrides(): string {
  return typeof window === 'undefined' ? '' : espnOverrideKey(window.location.search);
}

export interface NflScoreboardState {
  games: NflGame[];
  status: PollStatus;
  /** Set when a validation override pointed this at another slate. */
  espnSlot: EspnSlotInfo | null;
  /** True while at least one game is being played. Drives the poll cadence. */
  anyLive: boolean;
  /** Canonical NFL team code → that team's game. */
  byTeam: Map<string, NflGame>;
  /** How many games are being played right now. */
  liveCount: number;
  /**
   * epoch ms of the last SUCCESSFUL poll; 0 when nothing has landed yet.
   * Surfaced so the UI can show the feed's own freshness — a board that says
   * "Live" but has not been confirmed in ten minutes is not live, and an owner
   * has no way to tell the two apart from the scores alone.
   */
  fetchedAt: number;
}

const EMPTY_GAMES: NflGame[] = [];

/**
 * Should the scoreboard poll at the LIVE cadence?
 *
 * `hint` is the page's game-day window (`getDailySlot`), computed server-side
 * and fixed for the life of the page. It is what keeps the board responsive
 * before kickoff: a slate of `pre` games is not "in progress" but is about to
 * be, and without the hint the board would sit on POLL_STALE all Sunday
 * morning and notice kickoff up to five minutes late.
 *
 * What the hint must not do is outlive the slate. `getDailySlot` keeps the
 * live-scoring slot open long past the last whistle — Sunday 8:30pm+ and
 * Monday 11pm+ both still return it — so OR-ing it in unconditionally pinned
 * every subscriber to POLL_LIVE for hours after every game had gone final.
 * A finished slate therefore ends the fast cadence regardless of the hint,
 * the same rule LiveScoreboard already applies to its MFL half (`allDone`).
 *
 * An EMPTY slate is not "all final" — it is "nothing has loaded yet", and the
 * hint still governs there.
 */
export function shouldPollLive(games: ReadonlyArray<{ state: NflGame['state'] }>, hint: boolean): boolean {
  const allFinal = games.length > 0 && games.every((g) => g.state === 'post');
  if (allFinal) return false;
  return hint || games.some((g) => g.state === 'in');
}


/**
 * @param enabled pass false in demo mode (bundled sample data) or when the
 *   caller supplies its own games — the hook then does no network at all.
 * @param fallbackGames the caller's own slate. With `enabled` false it is the
 *   ONLY source. With `enabled` true it is the value until the first poll
 *   lands, which is what makes a SERVER-rendered slate reach the markup: the
 *   store is empty during SSR, so without this an island whose only content is
 *   these games renders nothing — and one mounted `client:visible` then never
 *   hydrates at all, because that directive observes children it does not have.
 */
export function useNflScoreboard(
  week: number,
  year: number,
  opts: { enabled?: boolean; live?: boolean; fallbackGames?: NflGame[] } = {},
): NflScoreboardState {
  const { enabled = true, live = false, fallbackGames } = opts;
  // Read on every render, not once: with ClientRouter a soft navigation
  // changes the URL under a mounted island. A changed signature gives
  // `subscribe` a new identity, which re-registers on the new key and loads
  // immediately rather than serving the previous slate until the next tick.
  const overrides = currentEspnOverrides();
  const params = useMemo(() => ({ week, year, overrides }), [week, year, overrides]);

  // Read the store during render (not inside the subscribe callback) so the
  // cadence stays REACTIVE: the component re-renders whenever the store emits,
  // this re-evaluates, and a changed value gives `subscribe` a new identity,
  // which re-registers at the new interval. Computing it inside subscribe
  // would freeze the cadence at whatever was true when the island mounted, so
  // a board that went all-final would keep polling every 60s forever.
  // The caller's `live` hint (the page's game-day window) covers the first
  // load, before any games have arrived to look at — and it stays useful after
  // that, because a slate of `pre` games is not "in progress" but IS about to
  // be: dropping the hint once data lands would put the board on POLL_STALE
  // all Sunday morning and leave it up to five minutes late noticing kickoff.
  //
  // What the hint must NOT do is outlive the slate. `getDailySlot` keeps the
  // live-scoring slot open long past the last whistle (Sunday 8:30pm+ and
  // Monday 11pm+ both still return it), so OR-ing it in unconditionally pinned
  // every subscriber to POLL_LIVE for hours after every game had gone final.
  // A finished slate ends the fast cadence regardless of the hint — the same
  // rule LiveScoreboard already applies to its MFL half via `allDone`.
  const liveNow = shouldPollLive(poller.getState(params).data?.games ?? [], live);

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
    // The poll wins once it has answered — including with a legitimately empty
    // slate, which is why this tests the SNAPSHOT for nullish rather than the
    // array for length. Before then, the caller's server-rendered games stand.
    const games = (enabled ? snapshot.data?.games : undefined) ?? fallbackGames ?? EMPTY_GAMES;
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
      espnSlot: enabled ? snapshot.data?.espnSlot ?? null : null,
      anyLive: games.some((g) => g.state === 'in'),
      byTeam,
      liveCount: games.filter((g) => g.state === 'in').length,
      fetchedAt: enabled ? snapshot.fetchedAt : 0,
    };
  }, [enabled, fallbackGames, snapshot]);
}
