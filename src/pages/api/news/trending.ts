import type { APIRoute } from 'astro';

export const prerender = false;

const SLEEPER_TRENDING = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=25';
const SLEEPER_PLAYERS = 'https://api.sleeper.app/v1/players/nfl';

// In-memory cache for the huge players lookup (survives across requests on the same serverless instance)
let playersCache: Record<string, { full_name: string; position: string; team: string }> | null = null;
let playersCacheTs = 0;
const PLAYERS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getPlayersLookup() {
  if (playersCache && Date.now() - playersCacheTs < PLAYERS_CACHE_TTL) {
    return playersCache;
  }
  const res = await fetch(SLEEPER_PLAYERS);
  if (!res.ok) throw new Error(`Sleeper players API ${res.status}`);
  const raw = await res.json();
  const lookup: Record<string, { full_name: string; position: string; team: string }> = {};
  for (const [id, p] of Object.entries(raw) as [string, Record<string, string>][]) {
    if (p.full_name) {
      lookup[id] = { full_name: p.full_name, position: p.position ?? '', team: p.team ?? '' };
    }
  }
  playersCache = lookup;
  playersCacheTs = Date.now();
  return lookup;
}

export const GET: APIRoute = async () => {
  try {
    const [trendingRes, players] = await Promise.all([
      fetch(SLEEPER_TRENDING),
      getPlayersLookup(),
    ]);

    if (!trendingRes.ok) throw new Error(`Sleeper trending API ${trendingRes.status}`);
    const trendingRaw: { player_id: string; count: number }[] = await trendingRes.json();

    const result = trendingRaw
      .map((t) => {
        const p = players[t.player_id];
        if (!p) return null;
        return {
          name: p.full_name,
          position: p.position,
          team: p.team,
          count: t.count,
        };
      })
      .filter(Boolean);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
