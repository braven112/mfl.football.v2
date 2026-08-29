/**
 * /api/draft/status — Live draft board polling endpoint.
 *
 * Proxies MFL's public `draftResults` export and returns picks in the same
 * shape `draft-room.astro` builds at SSR time so the client can swap the
 * picks array in‑place. No auth required (draftResults is public).
 *
 * The DraftRoom client polls this every 12s when picks are recent and 30s
 * otherwise (see DraftRoom.tsx). For an email draft 30s of latency is fine.
 * The AFL broadcast board polls faster (see DraftBroadcast.tsx) — a live
 * in-person draft can't wait 30s for the room to learn who was picked.
 *
 * DRAFT UNITS: `draftResults.draftUnit` is an OBJECT in a single-draft league
 * (TheLeague, best-ball) but an ARRAY in a league that drafts by conference
 * (the AFL runs CONFERENCE00 + CONFERENCE01 as two independent 108-pick
 * boards). Reading `.draftPick` straight off the raw value therefore returned
 * `undefined` for the AFL — and because that fell through to `picks: []` with
 * a 200, the board looked empty rather than broken. `selectDraftUnit`
 * normalizes both shapes; `?unit=` chooses among them.
 */

import type { APIRoute } from 'astro';
import { parseTradeFromComment, selectDraftUnit } from '../../../utils/draft-utils';
import type { DraftRoomPick, DraftStatusResponse } from '../../../types/draft-room';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { buildMflExportUrl } from '../../../utils/mfl-url';
import { getLeagueBySlug } from '../../../config/leagues';
import { resolveMflHost, resolveMflLeagueId } from '../../../utils/draft-broadcast-source';

export const prerender = false;

const DEFAULT_HOST = getLeagueBySlug('theleague')!.mflHost;
const DEFAULT_LEAGUE_ID = getLeagueBySlug('theleague')!.id;

interface RawDraftPick {
  player?: string;
  pick?: string;
  franchise?: string;
  timestamp?: string;
  comments?: string;
  round?: string;
}


function buildPicks(rawPicks: RawDraftPick | RawDraftPick[] | undefined): DraftRoomPick[] {
  if (!rawPicks) return [];
  const arr = Array.isArray(rawPicks) ? rawPicks : [rawPicks];

  // Sort by (round, pickInRound) then assign sequential overallPickNumber.
  // Rounds may have variable counts (R1=17, R2=18, R3=16) so a fixed stride
  // would mis-number picks — match draft-room.astro's logic exactly.
  const sorted = [...arr].sort((a, b) => {
    const rDiff = parseInt(a.round || '1') - parseInt(b.round || '1');
    return rDiff !== 0 ? rDiff : parseInt(a.pick || '1') - parseInt(b.pick || '1');
  });

  return sorted.map((p, idx) => {
    const tradedFrom = parseTradeFromComment(p.comments || '');
    return {
      round: parseInt(p.round || '1'),
      pickInRound: parseInt(p.pick || '1'),
      overallPickNumber: idx + 1,
      franchiseId: p.franchise || '',
      playerId: p.player || '',
      timestamp: p.timestamp || '',
      comments: p.comments || '',
      isTraded: !!tradedFrom,
      originalTeamName: tradedFrom,
    };
  });
}


/**
 * How many times to ask MFL for the same board, in parallel, keeping the
 * freshest answer.
 *
 * MFL serves `draftResults` from backends whose caches disagree, and the spread
 * is far worse than "occasionally stale". Measured against the live 2026 AFL
 * rehearsal, 48 requests for one conference returned NINE distinct boards — 0,
 * 1, 2, 3, 4, 6, 8, 9 and 13 picks — and the CURRENT one came back twice. MFL
 * had the fresh data (its newest pick was 103 seconds old); it just handed it
 * over about 4% of the time.
 *
 * A single request per poll therefore leaves the board minutes behind a live
 * room, which is exactly how it was reported: "it was doing good till 10 now
 * it's stuck and behind the draft". Cache-bypass headers do not help — plain
 * and `Cache-Control: no-cache` returned the same spread — because this is
 * many backends, not one edge cache.
 *
 * Six parallel requests take the freshest of six draws. They run concurrently,
 * so the poll costs one round trip, and the client's 5s cadence is unchanged.
 */
const MFL_SAMPLES = 6;

/** Newest pick stamp for `unit` in a payload, or -1 if it has no board. */
function unitFreshness(raw: any, unit: string | null): number {
  const selected = selectDraftUnit<RawDraftPick>(raw?.draftResults?.draftUnit, unit);
  if (!selected) return -1;
  const picks = selected.draftPick;
  const arr = Array.isArray(picks) ? picks : picks ? [picks] : [];
  let newest = 0;
  let filled = 0;
  for (const p of arr) {
    if (!p?.player) continue;
    filled += 1;
    const ts = Number.parseInt(p?.timestamp ?? '', 10);
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  // Fall back to the count when nothing carries a stamp, so an unstamped board
  // still beats an empty one.
  return newest > 0 ? newest : filled;
}

/** Ask MFL MFL_SAMPLES times at once; return the freshest board for `unit`. */
async function fetchFreshest(
  mflUrl: string,
  unit: string | null
): Promise<{ data: any | null; status?: number }> {
  let lastStatus: number | undefined;

  const once = async (): Promise<any | null> => {
    try {
      const res = await fetch(mflUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        lastStatus = res.status;
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  };

  const results = await Promise.all(Array.from({ length: MFL_SAMPLES }, once));

  let best: any | null = null;
  let bestFreshness = -Infinity;
  for (const candidate of results) {
    if (!candidate) continue;
    const freshness = unitFreshness(candidate, unit);
    if (freshness > bestFreshness) {
      best = candidate;
      bestFreshness = freshness;
    }
  }
  return { data: best, status: lastStatus };
}

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || String(getCurrentLeagueYear());

  // `league` and `host` are both interpolated into a URL this server then
  // FETCHES, and both arrive from a public page's query string — the broadcast
  // board's `?mflLeague=` override is one legitimate caller (see
  // draft-broadcast-source.ts) and anyone with a browser is another. A host
  // that is not MFL's is server-side request forgery with a URL bar for an
  // interface, so an unrecognised value falls back to the default rather than
  // erroring: every real caller passes a valid one, and a 400 here would only
  // tell a prober it had found the right parameter.
  const leagueId =
    resolveMflLeagueId(url.searchParams.get('league') || url.searchParams.get('L')) ||
    DEFAULT_LEAGUE_ID;
  const host = resolveMflHost(url.searchParams.get('host'), DEFAULT_HOST);
  const unit = url.searchParams.get('unit');

  const mflUrl = buildMflExportUrl({ type: 'draftResults', leagueId, year, host: `https://${host}` });

  try {
    const { data, status } = await fetchFreshest(mflUrl, unit);

    if (!data) {
      return new Response(
        JSON.stringify({ picks: [], serverTime: Date.now(), error: `MFL ${status ?? 'unreachable'}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const selected = selectDraftUnit<RawDraftPick>(data?.draftResults?.draftUnit, unit);

    // A named unit that isn't on the board is a caller error, not an empty
    // draft — say so instead of returning a plausible-looking empty board.
    if (unit && !selected) {
      return new Response(
        JSON.stringify({
          picks: [],
          serverTime: Date.now(),
          error: `unknown draft unit "${unit}"`,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const picks = buildPicks(selected?.draftPick);
    const body: DraftStatusResponse = {
      picks,
      serverTime: Date.now(),
      unit: selected?.unit,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Don't cache at the edge — clients should always see the latest picks.
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        picks: [],
        serverTime: Date.now(),
        error: (err as Error).message || 'fetch failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
