import type { APIRoute } from 'astro';
import type { LivePlayerRow, MatchupPairing } from '../../types/live-scoring';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { ALL_LEAGUES, getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { buildMflExportUrl } from '../../utils/mfl-url';

export const prerender = false;

const DEFAULT_LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!;
const DEFAULT_HOST = `https://${DEFAULT_LEAGUE.mflHost}`;
const DEFAULT_LEAGUE_ID = DEFAULT_LEAGUE.id;

/**
 * The `host` query param is interpolated into a server-side fetch, so it must
 * be constrained to prevent SSRF. Only the MFL hosts registered for our
 * leagues are permitted; anything else falls back to the default host. Keyed
 * by the registry so adding a league needs no change here.
 */
const ALLOWED_HOSTS = new Set(ALL_LEAGUES.map((l) => l.mflHost.toLowerCase()));

function resolveHost(raw: string | null): string {
  if (!raw) return DEFAULT_HOST;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
      return `https://${u.hostname}`;
    }
  } catch {
    /* fall through to default */
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

  const host = resolveHost(url.searchParams.get('host'));

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

    const scores: Record<string, number> = {};
    const remaining: Record<string, number> = {};
    const matchups: MatchupPairing[] = [];
    const players: Record<string, LivePlayerRow[]> = {};
    const playersYetToPlay: Record<string, number> = {};

    // Process live scoring data (regular matchups)
    if (liveScoreResponse.ok) {
      const data = await liveScoreResponse.json();
      let franchises: any[] = [];

      if (data?.liveScoring?.franchise) {
        franchises = Array.isArray(data.liveScoring.franchise)
          ? data.liveScoring.franchise
          : [data.liveScoring.franchise];
      } else if (data?.liveScoring?.matchup) {
        const rawMatchups = Array.isArray(data.liveScoring.matchup)
          ? data.liveScoring.matchup
          : [data.liveScoring.matchup];

        for (const matchup of rawMatchups) {
          if (!matchup?.franchise) continue;
          const teams = Array.isArray(matchup.franchise) ? matchup.franchise : [matchup.franchise];
          franchises.push(...teams);

          // Extract matchup pairing
          if (teams.length >= 2 && teams[0]?.id && teams[1]?.id) {
            matchups.push({
              home: String(teams[0].id),
              away: String(teams[1].id),
            });
          }
        }
      }

      franchises.forEach((team: any) => {
        if (!team?.id) return;
        const fid = String(team.id);
        scores[fid] = Number(team.score) || 0;
        remaining[fid] = Number(team.gameSecondsRemaining) || 0;
        if (team.playersYetToPlay != null) {
          playersYetToPlay[fid] = Number(team.playersYetToPlay) || 0;
        }

        // Per-player breakdown (present when DETAILS=1). MFL nests this as
        // franchise.players.player[] in liveScoring but flat franchise.player[]
        // in weeklyResults — accept either. Keep starters only (status is the
        // confirmed 'starter'/'nonstarter' field): bench players don't count
        // toward the matchup and just bloat the poll.
        const rawPlayers = team?.players?.player ?? team?.player;
        if (rawPlayers) {
          const list = Array.isArray(rawPlayers) ? rawPlayers : [rawPlayers];
          players[fid] = list
            .filter((p: any) => p?.id && p.status !== 'nonstarter')
            .map((p: any) => ({
              id: String(p.id),
              live: Number(p.score) || 0,
              secondsRemaining: Number(p.gameSecondsRemaining) || 0,
              status: String(p.status || 'starter'),
            }));
        }
      });
    }

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
