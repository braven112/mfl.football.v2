/**
 * /api/draft/status — Live draft board polling endpoint.
 *
 * Proxies MFL's public `draftResults` export and returns picks in the same
 * shape `draft-room.astro` builds at SSR time so the client can swap the
 * picks array in‑place. No auth required (draftResults is public).
 *
 * The DraftRoom client polls this every 12s when picks are recent and 30s
 * otherwise (see DraftRoom.tsx). For an email draft 30s of latency is fine.
 */

import type { APIRoute } from 'astro';
import { parseTradeFromComment } from '../../../utils/draft-utils';
import type { DraftRoomPick, DraftStatusResponse } from '../../../types/draft-room';
import { getCurrentLeagueYear } from '../../../utils/league-year';

export const prerender = false;

const DEFAULT_HOST = 'www49.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';

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
  const leagueId = url.searchParams.get('league') || url.searchParams.get('L') || DEFAULT_LEAGUE_ID;
  const host = url.searchParams.get('host') || DEFAULT_HOST;

  const mflUrl = `https://${host}/${year}/export?TYPE=draftResults&L=${leagueId}&JSON=1`;

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
    const picks = buildPicks(data?.draftResults?.draftUnit?.draftPick);
    const body: DraftStatusResponse = { picks, serverTime: Date.now() };

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
