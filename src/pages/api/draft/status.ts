import type { APIRoute } from 'astro';
import type { DraftRoomPick, DraftStatusResponse } from '../../../types/draft-room';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { parseTradeFromComment } from '../../../utils/draft-utils';

export const prerender = false;

const MFL_HOST = 'https://www49.myfantasyleague.com';
const LEAGUE_ID = '13522';

export const GET: APIRoute = async ({ url }) => {
  const year = url.searchParams.get('year') || getCurrentLeagueYear().toString();

  try {
    const response = await fetch(
      `${MFL_HOST}/${year}/export?TYPE=draftResults&L=${LEAGUE_ID}&JSON=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' } }
    );

    if (!response.ok) {
      throw new Error(`MFL API returned ${response.status}`);
    }

    const data = await response.json();
    const rawPicks = data?.draftResults?.draftUnit?.draftPick;
    if (!rawPicks) {
      return new Response(JSON.stringify({ picks: [], serverTime: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=5' },
      });
    }

    const pickArray = Array.isArray(rawPicks) ? rawPicks : [rawPicks];

    // Sort by (round, pickInRound) and assign sequential overallPickNumber
    // Rounds have variable pick counts (e.g. R1=17, R2=18, R3=16) so a fixed stride doesn't work
    const sorted = [...pickArray].sort((a: any, b: any) => {
      const rDiff = parseInt(a.round || '1') - parseInt(b.round || '1');
      return rDiff !== 0 ? rDiff : parseInt(a.pick || '1') - parseInt(b.pick || '1');
    });

    const picks: DraftRoomPick[] = sorted.map((p: any, idx: number) => {
      const round = parseInt(p.round || '1');
      const pickInRound = parseInt(p.pick || '1');
      const tradedFrom = parseTradeFromComment(p.comments || '');

      return {
        round,
        pickInRound,
        overallPickNumber: idx + 1,
        franchiseId: p.franchise || '',
        playerId: p.player || '',
        timestamp: p.timestamp || '',
        comments: p.comments || '',
        isTraded: !!tradedFrom,
        originalTeamName: tradedFrom,
      };
    });

    const result: DraftStatusResponse = {
      picks,
      serverTime: Date.now(),
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=5',
      },
    });
  } catch (error) {
    console.error('Error fetching draft status:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch draft status', picks: [], serverTime: Date.now() }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
