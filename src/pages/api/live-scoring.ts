import type { APIRoute } from 'astro';

export const prerender = false;

const DEFAULT_HOST = 'https://www49.myfantasyleague.com';
const DEFAULT_LEAGUE_ID = '13522';

export const GET: APIRoute = async ({ url }) => {
  const week = url.searchParams.get('week');
  const year = url.searchParams.get('year') || new Date().getFullYear().toString();
  const leagueId = url.searchParams.get('L') || DEFAULT_LEAGUE_ID;
  const host = url.searchParams.get('host') || DEFAULT_HOST;

  if (!week) {
    return new Response(JSON.stringify({ error: 'Week parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch both live scoring AND playoff brackets to get all scores
    const [liveScoreResponse, playoffBracketsResponse] = await Promise.all([
      fetch(`${host}/${year}/export?TYPE=liveScoring&L=${leagueId}&W=${week}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
      fetch(`${host}/${year}/export?TYPE=playoffBrackets&L=${leagueId}&JSON=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      }),
    ]);

    const scores: Record<string, number> = {};
    const remaining: Record<string, number> = {};

    // Process live scoring data (regular matchups)
    if (liveScoreResponse.ok) {
      const data = await liveScoreResponse.json();
      let franchises: any[] = [];

      if (data?.liveScoring?.franchise) {
        franchises = Array.isArray(data.liveScoring.franchise)
          ? data.liveScoring.franchise
          : [data.liveScoring.franchise];
      } else if (data?.liveScoring?.matchup) {
        const matchups = Array.isArray(data.liveScoring.matchup)
          ? data.liveScoring.matchup
          : [data.liveScoring.matchup];

        franchises = matchups.flatMap((matchup: any) => {
          if (!matchup?.franchise) return [];
          return Array.isArray(matchup.franchise) ? matchup.franchise : [matchup.franchise];
        });
      }

      franchises.forEach((team: any) => {
        if (team?.id) {
          scores[String(team.id)] = Number(team.score) || 0;
          remaining[String(team.id)] = Number(team.gameSecondsRemaining) || 0;
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
          fetch(`${host}/${year}/export?TYPE=playoffBracket&L=${leagueId}&BRACKET_ID=${bracket.id}&JSON=1`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
          })
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

          // Extract scores from playoff games
          gamesArray.forEach((game: any) => {
            if (game.home?.franchise_id && game.home?.points) {
              const homeId = String(game.home.franchise_id);
              scores[homeId] = Number(game.home.points) || 0;
              remaining[homeId] = 0; // Playoff games don't have live time remaining
            }
            if (game.away?.franchise_id && game.away?.points) {
              const awayId = String(game.away.franchise_id);
              scores[awayId] = Number(game.away.points) || 0;
              remaining[awayId] = 0;
            }
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        week: Number(week),
        scores,
        remaining,
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
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
