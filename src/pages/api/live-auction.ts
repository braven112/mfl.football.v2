import type { APIRoute } from 'astro';
import { fetchLiveAuctions } from '../../utils/live-auctions';
import { getCurrentLeagueYear } from '../../utils/league-year';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || getCurrentLeagueYear().toString();
  const leagueId = url.searchParams.get('L') || undefined;

  try {
    const snapshot = await fetchLiveAuctions({ year, leagueId });
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error fetching auction results:', error);
    return new Response(
      JSON.stringify({
        auctions: {},
        timestamp: Date.now(),
        count: 0,
        error: 'Failed to fetch auction results',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
