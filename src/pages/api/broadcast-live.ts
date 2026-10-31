import type { APIRoute } from 'astro';
import { getBroadcastViewer, readTvPassToken } from '../../utils/broadcast-viewer';
import { passHashOfToken } from '../../utils/broadcast-tv-pairing';
import { getPairingStore } from '../../utils/broadcast-tv-store';
import { readRemoteState } from '../../utils/broadcast-tv-remote';
import type { RemoteState } from '../../utils/broadcast-remote-commands';
import { getCurrentSeasonYear, getTestDateFromSearchParams } from '../../utils/league-year';
import { getCurrentNFLWeek } from '../../utils/current-week';
import { assembleBroadcastBoard } from '../../utils/broadcast-board';
import { BROADCAST_LEAGUE_COOKIE } from '../../utils/broadcast-selection';
import type { BroadcastPollResponse } from '../../types/live-broadcast';

export const prerender = false;

/**
 * The one poll the broadcast board makes.
 *
 * A THIN WRAPPER over `assembleBroadcastBoard`, which the PAGE also calls in
 * process for its first paint. One implementation, two callers — a page that
 * fetches its own API to render itself puts our own edge in the path of the
 * paint, and that hop has already silently stopped landing once.
 *
 * Scope comes from the SESSION, never from a param. A paired TV has no
 * session; its pass resolves to the owner who paired it, through
 * `getBroadcastViewer` — the one place a pass is read, and this route is one
 * of the two it may be read for. `?leagues=` can only narrow the set the owner's own MFL cookie already returned, because the
 * resolver only ever answers with ids present in that list. There is no value
 * a caller can send that reaches a league this owner is not in.
 *
 * `Cache-Control: no-store`: a CDN copy of a live board is not stale, it is
 * WRONG while looking live.
 */
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * The shape an unauthenticated or failed call answers with.
 *
 * `ok: false` with empty collections, never a 500 and never a bare `{}`. The
 * island keeps its last good numbers on a failed poll and only changes the
 * status pill — "the feed says nothing" and "we could not reach the feed" are
 * different facts all the way to the pixels, and an empty 200 that looked
 * healthy would wipe a live board.
 */
const failed = (week: number): BroadcastPollResponse => ({
  ok: false,
  week,
  fetchedAt: new Date().toISOString(),
  leagues: [],
  moments: [],
  redZone: [],
  games: [],
});

export const GET: APIRoute = async ({ request, url, cookies }) => {
  // The page resolves its season year from `?testDate=` and the island forwards
  // the parameter, so this route has to read it too. Deriving the year off the
  // real clock here while the page derived it off a test date makes the two
  // halves of one screen disagree about which SEASON they are showing — and
  // only across the Labor Day boundary, which is precisely when someone is
  // rendering with a test date.
  const testDate = getTestDateFromSearchParams(url.searchParams) ?? undefined;
  const week = (() => {
    const raw = parseInt(url.searchParams.get('week') ?? '', 10);
    if (Number.isInteger(raw) && raw >= 1 && raw <= 25) return raw;
    return getCurrentNFLWeek(testDate ?? new Date()) ?? 1;
  })();

  const viewer = await getBroadcastViewer(request);
  if (!viewer) return json(failed(week), 401);
  const { user } = viewer;

  // A paired TV also learns, on this same poll, whether its owner's phone has
  // the remote open (docs/plans/broadcast-handheld.md, Phase 4). One read of
  // one key, for any request carrying a TV pass. NOT gated on `via === 'tv'`:
  // a TV that also holds an owner session (signed in on the TV, or in the TV
  // app before pairing) resolves as 'session', and gating on that left every
  // such TV deaf to the phone (Brandon, Oct 2026). The record is keyed by the
  // cookie's own hash, so a pass can only ever read what was sent to it.
  // Parsed inside the caught promise: a malformed cookie must cost only the
  // remote state, never the scores.
  const remote: Promise<RemoteState | undefined> = (async () => {
    const passToken = readTvPassToken(request);
    if (!passToken || passToken.length > 128) return undefined;
    const store = await getPairingStore();
    return store ? readRemoteState(store, passHashOfToken(passToken)) : undefined;
  })().catch(() => undefined);

  try {
    const board = await assembleBroadcastBoard({
      user,
      leaguesParam: url.searchParams.get('leagues'),
      // A TV's own choice first; failing that, the set the phone that paired
      // it was watching.
      leaguesCookie: cookies.get(BROADCAST_LEAGUE_COOKIE)?.value ?? viewer.pass?.leagues ?? null,
      week,
      year: getCurrentSeasonYear(testDate),
      // Only the numbers. Panel identity — colours, crests, name forms —
      // cannot change during a Sunday and this route does not return it.
      mode: 'poll',
    });
    const remoteState = await remote;
    return json(remoteState ? { ...board.poll, remote: remoteState } : board.poll, 200);
  } catch (error) {
    console.warn('[broadcast-live] assembly failed:', (error as Error)?.message);
    return json(failed(week), 200);
  }
};
