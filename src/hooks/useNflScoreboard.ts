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
 * How close a kickoff has to be for the board to poll at the LIVE cadence.
 * Comfortably larger than POLL_STALE so a board on the slow cadence gets at
 * least two ticks inside the window and is never late to a kickoff.
 */
export const KICKOFF_SOON_MS = 15 * 60_000;

/**
 * Should the scoreboard poll at the LIVE cadence?
 *
 * The trap this exists to avoid: **ESPN's slate is a whole WEEK**, not a day.
 * `buildEspnScoreboardUrl` asks for `?week=N`, so Thursday through Monday all
 * come back together. That makes "some game is still `pre`" true from Thursday
 * lunchtime until Monday night, and it means an `allFinal` test is false all
 * Sunday evening because Monday's game has not kicked off yet. Neither can
 * drive this on its own.
 *
 * So the rule reads the CLOCK, not just the states:
 *
 *  - A game actually in progress is the unambiguous yes.
 *  - Otherwise, yes only while a kickoff is within `KICKOFF_SOON_MS` (or has
 *    just passed and ESPN has not flipped the state yet). Sunday 12:50pm is
 *    live; Sunday 9am and Sunday 11pm are not, even though Monday's game sits
 *    `pre` in the payload at all three.
 *  - With NOTHING loaded, the page's game-day `hint` is all there is to go on.
 *    That is the only thing the hint is good for: it comes from `getDailySlot`
 *    and is fixed for the life of the page, and that slot stays open long past
 *    the last whistle (Sunday 8:30pm+ and Monday 11pm+ both still return it),
 *    so trusting it once data exists is what pinned every subscriber to
 *    POLL_LIVE for hours after the slate went final.
 *
 * An EMPTY slate is "nothing loaded yet", never "all final" — `[].every(…)` is
 * `true`, and treating that as finished would drop the very first load to
 * POLL_STALE.
 */
export function shouldPollLive(
  games: ReadonlyArray<{ state: NflGame['state']; date?: string }>,
  hint: boolean,
  now: number = Date.now(),
): boolean {
  if (games.length === 0) return hint;
  if (games.some((g) => g.state === 'in')) return true;
  return games.some((g) => {
    if (g.state !== 'pre' || !g.date) return false;
    const kickoff = Date.parse(g.date);
    // `<=` with no lower bound on purpose: a `pre` game whose kickoff has
    // already passed is either about to flip to `in` or ESPN is briefly stale,
    // and polling fast is the right answer either way.
    return Number.isFinite(kickoff) && kickoff - now <= KICKOFF_SOON_MS;
  });
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
