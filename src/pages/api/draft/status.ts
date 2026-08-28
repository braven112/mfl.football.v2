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
    const res = await fetch(mflUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ picks: [], serverTime: Date.now(), error: `MFL ${res.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await res.json();
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
