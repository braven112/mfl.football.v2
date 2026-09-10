import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { loadLiveScoringPayload } from '../../utils/live-scoring-source';

export const prerender = false;

const DEFAULT_LEAGUE_ID = getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.id;

/**
 * `host` is accepted for backward compatibility only. `resolveHost`
 * (live-scoring-source.ts) ignores it whenever `L` names a league we know, and
 * allowlist-checks it when it does not — so it is a hint, never an input.
 * Callers should send `L` alone: a `host=<hostname>` param on a public URL
 * reads like an SSRF attempt to a WAF, and the gameday health check's probes
 * were 403'd at the edge because of it (2026-09-03).
 */

export const GET: APIRoute = async ({ url }) => {
  // All three flow into the upstream MFL URL (year into the path, week + L into
  // the query), so coerce to integers to prevent path/query injection. Reject a
  // missing/invalid week; fall back to sane defaults for year + league id.
  const weekNum = parseInt(url.searchParams.get('week') ?? '', 10);
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 25) {
    return new Response(JSON.stringify({ error: 'Valid week parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const week = String(weekNum);

  const yearNum = parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? String(yearNum)
    : getCurrentSeasonYear().toString();

  const leagueParam = url.searchParams.get('L');
  const leagueId = leagueParam && /^\d+$/.test(leagueParam) ? leagueParam : DEFAULT_LEAGUE_ID;

  try {
    // Read MFL DIRECTLY through the shared loader. This route and the
    // live-scoring page both call it, so the fetch + playoff-bracket merge has
    // one implementation and the page no longer fetches this route over the
    // public internet to render itself (see live-scoring-source.ts).
    const payload = await loadLiveScoringPayload({
      leagueId,
      year,
      week,
      hostHint: url.searchParams.get('host'),
    });

    return new Response(
      JSON.stringify(payload),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching live scoring:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch live scoring',
        week: Number(week),
        scores: {},
        remaining: {},
        matchups: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
