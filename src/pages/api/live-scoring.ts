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
    const franchises = data?.liveScoring?.franchise
      ? Array.isArray(data.liveScoring.franchise)
        ? data.liveScoring.franchise
        : [data.liveScoring.franchise]
      : [];

    const scores: Record<string, number> = {};
    franchises.forEach((team: any) => {
      if (team?.id) {
        scores[String(team.id)] = Number(team.score) || 0;
      }
    });

    return new Response(
      JSON.stringify({
        week: Number(week),
        scores,
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
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
