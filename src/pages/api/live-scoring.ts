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
    const mflUrl = `${host}/${year}/export?TYPE=liveScoring&L=${leagueId}&W=${week}&JSON=1`;
    const response = await fetch(mflUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`MFL API returned ${response.status}`);
    }

    const data = await response.json();

    // Extract franchises from either structure:
    // 1. liveScoring.franchise (direct franchise array)
    // 2. liveScoring.matchup (franchises nested in matchups)
    let franchises: any[] = [];

    if (data?.liveScoring?.franchise) {
      // Direct franchise array structure
      franchises = Array.isArray(data.liveScoring.franchise)
        ? data.liveScoring.franchise
        : [data.liveScoring.franchise];
    } else if (data?.liveScoring?.matchup) {
      // Matchup-based structure - flatten franchises from all matchups
      const matchups = Array.isArray(data.liveScoring.matchup)
        ? data.liveScoring.matchup
        : [data.liveScoring.matchup];

      franchises = matchups.flatMap((matchup: any) => {
        if (!matchup?.franchise) return [];
        return Array.isArray(matchup.franchise) ? matchup.franchise : [matchup.franchise];
      });
    }

    const scores: Record<string, number> = {};
    const remaining: Record<string, number> = {};

    franchises.forEach((team: any) => {
      if (team?.id) {
        scores[String(team.id)] = Number(team.score) || 0;
        remaining[String(team.id)] = Number(team.gameSecondsRemaining) || 0;
      }
    });

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
