import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { loadLeagueScoringRules } from '../../utils/live/scoring-rules-source';

export const prerender = false;

/**
 * One league's MFL scoring rules, for the live board's stat sheet.
 *
 * A THIN wrapper over `loadLeagueScoringRules`. Takes a league id only — the
 * MFL host is resolved server-side and never read from the request.
 *
 * Unlike the live routes this one may be cached briefly: rules are not live
 * data, and a successful answer is the same for every viewer. A failed read is
 * `no-store` so an outage is never pinned at the edge.
 */
export const GET: APIRoute = async ({ url }) => {
  const leagueId = url.searchParams.get('L') ?? '';
  const yearParam = url.searchParams.get('year') ?? '';
  const year = /^\d{4}$/.test(yearParam) ? yearParam : String(getCurrentSeasonYear());

  const payload = await loadLeagueScoringRules(leagueId, year);
  return new Response(JSON.stringify(payload), {
    // 200 with `ok: false` on a failed read, like every live route here —
    // callers gate on the FLAG, never on `res.ok`.
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': payload.ok ? 'public, max-age=300, s-maxage=3600' : 'no-store',
    },
  });
};
