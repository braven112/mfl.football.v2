import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { checkRateLimit } from '../../utils/rate-limit';
import {
  hasCachedScoringRules,
  isValidLeagueId,
  loadLeagueScoringRules,
} from '../../utils/live/scoring-rules-source';
import type { LiveScoringRulesResponse } from '../../utils/live/scoring-rules';

export const prerender = false;

/**
 * One league's MFL scoring rules, for the live board's stat sheet.
 *
 * A THIN wrapper over `loadLeagueScoringRules`. Takes a league id only — the
 * MFL host is resolved server-side and never read from the request.
 *
 * ── WHY A RATE LIMIT ON A READ ────────────────────────────────────────────
 * The route is public (the league boards are) and accepts ANY numeric league
 * id, so a caller walking ids would turn this server into a fan-out against
 * MFL — which answers a client it considers noisy with an HTML page under a
 * 200, from the same egress the live boards read scores through. Only reads
 * that would reach MFL are counted: a cached league costs nothing and is
 * never refused.
 *
 * Unlike the live routes this one may be cached briefly: rules are not live
 * data, and a successful answer is the same for every viewer. A failed read is
 * `no-store` so an outage is never pinned at the edge.
 */
const RATE_MAX = 30;
const RATE_WINDOW_S = 600;

const json = (payload: LiveScoringRulesResponse, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': payload.ok ? 'public, max-age=300, s-maxage=3600' : 'no-store',
    },
  });

export const GET: APIRoute = async ({ url, clientAddress }) => {
  const leagueId = url.searchParams.get('L') ?? '';
  const current = getCurrentSeasonYear();
  const yearNum = Number.parseInt(url.searchParams.get('year') ?? '', 10);
  // A real season only: an arbitrary 4-digit year would multiply the key
  // space the rate limit has to defend.
  const year = String(
    Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= current + 1 ? yearNum : current,
  );

  if (isValidLeagueId(leagueId) && !hasCachedScoringRules(leagueId, year)) {
    let ip = 'unknown';
    try {
      ip = clientAddress || 'unknown';
    } catch {
      /* not available in every adapter mode */
    }
    const limit = await checkRateLimit('live-scoring-rules', ip, RATE_MAX, RATE_WINDOW_S);
    if (!limit.allowed) {
      return json({ ok: false, leagueId, year, rules: null }, 429);
    }
  }

  // 200 with `ok: false` on a failed read, like every live route here —
  // callers gate on the FLAG, never on `res.ok`.
  return json(await loadLeagueScoringRules(leagueId, year));
};
