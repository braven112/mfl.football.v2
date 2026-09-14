/**
 * MFL Live's poll endpoint.
 *
 * A THIN wrapper over `assembleMflLiveBoard` — the page calls that same
 * function in process for its first paint and never fetches this route to
 * render itself. See the assembler's header for why that rule exists in blood.
 *
 * `no-store`, without exception: a CDN copy of a live board is wrong while
 * looking live.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentNFLWeek } from '../../utils/current-week';
import { assembleMflLiveBoard } from '../../utils/mfl-live-board';
import { MFL_LIVE_LEAGUE_COOKIE } from '../../utils/mfl-live-selection';

export const prerender = false;

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const GET: APIRoute = async ({ request, url, cookies }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthenticated' }), {
      status: 401,
      headers: NO_STORE,
    });
  }

  // The RAW resolver result, never clamped up to 1. MFL serves no live scoring
  // before the Week 1 Thursday, and clamping is what hides that gap: a week-1
  // request in the September pre-kickoff window fails against a perfectly
  // healthy league. `null` here means "no NFL week is running", which the
  // board renders as its own state rather than as a failed read.
  const currentWeek = getCurrentNFLWeek(new Date());
  const requested = Number.parseInt(url.searchParams.get('week') ?? '', 10);
  const week = Number.isFinite(requested) && requested > 0 ? requested : currentWeek;

  if (!week) {
    return new Response(
      JSON.stringify({ ok: true, week: 0, leagues: [], playerMeta: {}, preSeason: true }),
      { status: 200, headers: NO_STORE },
    );
  }

  try {
    const { board } = await assembleMflLiveBoard({
      user,
      week,
      // A CHECK against what the session may see, never an input — the
      // resolver only returns ids already present in this owner's own list.
      leaguesParam: url.searchParams.get('leagues'),
      leaguesCookie: cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value ?? null,
    });
    return new Response(JSON.stringify(board), { status: 200, headers: NO_STORE });
  } catch {
    // 200 with `ok: false`, matching `/api/live-scoring`: the island keeps its
    // last good payload and flips a freshness pill rather than blanking a
    // board mid-afternoon. `{}` is truthy, so the client gates on the FLAG.
    return new Response(
      JSON.stringify({ ok: false, week, leagues: [], playerMeta: {} }),
      { status: 200, headers: NO_STORE },
    );
  }
};
