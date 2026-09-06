import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { ALL_LEAGUES, getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { buildMflExportUrl } from '../../utils/mfl-url';
import { emptyLiveSnapshot, parseLiveScoringPayload } from '../../utils/live-scoring-snapshot';

export const prerender = false;

const DEFAULT_LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!;
const DEFAULT_HOST = `https://${DEFAULT_LEAGUE.mflHost}`;
const DEFAULT_LEAGUE_ID = DEFAULT_LEAGUE.id;

/**
 * The `host` query param is interpolated into a server-side fetch, so it must
 * be constrained to prevent SSRF. Only the MFL hosts registered for our
 * leagues are permitted. Keyed by the registry so adding a league needs no
 * change here.
 */
const ALLOWED_HOSTS = new Set(ALL_LEAGUES.map((l) => l.mflHost.toLowerCase()));

/**
 * Resolve the MFL host to fetch from.
 *
 * `L` and the host are ONE composite key and MFL validates neither against
 * the other: every league lives on a different `www##` server, and a server
 * asked for a league id it does not host answers with its OWN league rather
 * than erroring. The wrong pairing is therefore a 200, well-formed,
 * non-empty, right schema, wrong league — invisible to `res.ok`, to a
 * JSON-shape check, and to the health check's own error-key check.
 *
 * So when `L` names a league we know, its registry host wins OUTRIGHT and
 * `host` is not consulted at all. A supplied `host` can only agree with the
 * registry (redundant) or disagree with it (the silent wrong-league answer) —
 * there is no third case, so there is nothing to gain by honoring it. This is
 * not hypothetical: `theleague/playoffs.astro` builds the pair from two
 * INDEPENDENT env vars (`PUBLIC_MFL_HOST`, `PUBLIC_MFL_LEAGUE_ID`), each with
 * its own fallback, so setting one without the other makes a live caller
 * disagree with itself.
 *
 * `host` is consulted only when `L` names no league we know — an arbitrary
 * MFL league id, where the hint is the only information available. It stays
 * allowlist-checked there, because it is interpolated into a server-side
 * fetch and an unconstrained value is SSRF.
 *
 * Callers may therefore send `L` alone. That matters beyond tidiness: a URL
 * carrying a `host=<hostname>` param reads like an SSRF attempt to a WAF, and
 * the gameday health check's probes were blocked at the edge with a 403 that
 * never reached this route (2026-09-03).
 */
function resolveHost(raw: string | null, leagueId: string): string {
  const league = getLeagueById(leagueId);
  if (league) return `https://${league.mflHost}`;
  if (raw) {
    try {
      const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
        return `https://${u.hostname}`;
      }
    } catch {
      /* fall through to the default league */
    }
  }
  return DEFAULT_HOST;
}

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

  const host = resolveHost(url.searchParams.get('host'), leagueId);

  try {
    // Fetch both live scoring AND playoff brackets to get all scores
    const [liveScoreResponse, playoffBracketsResponse] = await Promise.all([
      // DETAILS=1 so each franchise carries its per-player breakdown
      // (players.player[] with id, score, gameSecondsRemaining, status).
      fetch(buildMflExportUrl({ type: 'liveScoring', leagueId, year, params: { W: week, DETAILS: 1 }, host }), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
      fetch(buildMflExportUrl({ type: 'playoffBrackets', leagueId, year, host }), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
    ]);

    const snapshot = liveScoreResponse.ok
      ? parseLiveScoringPayload(await liveScoreResponse.json())
      : emptyLiveSnapshot();
    const { scores, remaining, matchups, players, bench, playersYetToPlay } = snapshot;

    // Process playoff bracket data (playoff games)
    if (playoffBracketsResponse.ok) {
      const playoffData = await playoffBracketsResponse.json();
      const bracketIds = playoffData?.playoffBrackets?.playoffBracket;

      if (bracketIds) {
        const brackets = Array.isArray(bracketIds) ? bracketIds : [bracketIds];

        // Fetch each bracket's detailed data
        const bracketPromises = brackets.map((bracket: any) =>
          fetch(
            buildMflExportUrl({ type: 'playoffBracket', leagueId, year, params: { BRACKET_ID: bracket.id }, host }),
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' } }
          )
        );

        const bracketResponses = await Promise.all(bracketPromises);

        for (const response of bracketResponses) {
          if (!response.ok) continue;

          const bracketData = await response.json();
          const rounds = bracketData?.playoffBracket?.playoffRound;
          if (!rounds) continue;

          const roundsArray = Array.isArray(rounds) ? rounds : [rounds];

          // Find the round for the requested week
          const weekRound = roundsArray.find((r: any) => r.week === String(week));
          if (!weekRound) continue;

          const games = weekRound.playoffGame;
          const gamesArray = Array.isArray(games) ? games : [games];

          // Extract scores and pairings from playoff games
          gamesArray.forEach((game: any) => {
            const homeId = game.home?.franchise_id ? String(game.home.franchise_id) : null;
            const awayId = game.away?.franchise_id ? String(game.away.franchise_id) : null;

            if (homeId && game.home?.points) {
              scores[homeId] = Number(game.home.points) || 0;
              remaining[homeId] = 0;
            }
            if (awayId && game.away?.points) {
              scores[awayId] = Number(game.away.points) || 0;
              remaining[awayId] = 0;
            }

            // Extract playoff matchup pairing
            if (homeId && awayId) {
              matchups.push({ home: homeId, away: awayId });
            }
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        // Whether the upstream MFL liveScoring request itself succeeded. An
        // offseason feed is a healthy 200 with empty collections (ok:true);
        // an upstream outage is skipped above but must not read as "no games"
        // — callers (the offseason auto-demo) use this to tell the two apart.
        ok: liveScoreResponse.ok,
        week: Number(week),
        scores,
        remaining,
        matchups,
        players,
        bench,
        playersYetToPlay,
      }),
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
