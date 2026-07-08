import type { APIRoute } from 'astro';
import type { NflGame } from '../../types/live-scoring';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { normalizeEspnTeamCode } from '../../utils/live-odds';

export const prerender = false;

/**
 * Real NFL scoreboard for the live-scoring "NFL games strip" — the real-world
 * context rail behind the fantasy scores. Proxies ESPN's public scoreboard API
 * (same endpoint live-odds.ts uses) and normalizes each game to score, quarter,
 * clock, and possession. no-store: scores must never be cached.
 */
export const GET: APIRoute = async ({ url }) => {
  const weekParam = url.searchParams.get('week');
  const week = weekParam ? parseInt(weekParam, 10) : 1;

  // ESPN numbers playoffs as seasontype=3, week 1-4 (not 19-22).
  const isPlayoffs = week > 18;
  const seasonType = isPlayoffs ? 3 : 2;
  const espnWeek = isPlayoffs ? week - 18 : week;
  const year = url.searchParams.get('year') || getCurrentSeasonYear().toString();
  const espnUrl =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?week=${espnWeek}&seasontype=${seasonType}&dates=${year}`;

  const empty = () =>
    new Response(JSON.stringify({ week, games: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  try {
    const res = await fetch(espnUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return empty();
    const data = await res.json();
    const events: any[] = data?.events ?? [];

    const games: NflGame[] = events.map((event: any) => {
      const comp = event?.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');
      const status = comp.status ?? event.status ?? {};
      const state: 'pre' | 'in' | 'post' = status?.type?.state ?? 'pre';

      const possId = comp.situation?.possession;
      const possTeam = possId
        ? competitors.find((c) => String(c.team?.id) === String(possId))
        : null;

      return {
        id: String(event.id ?? ''),
        state,
        shortDetail: status?.type?.shortDetail ?? '',
        period: Number(status?.period) || 0,
        clock: status?.displayClock ?? '',
        home: {
          code: normalizeEspnTeamCode(home?.team?.abbreviation ?? ''),
          score: Number(home?.score) || 0,
        },
        away: {
          code: normalizeEspnTeamCode(away?.team?.abbreviation ?? ''),
          score: Number(away?.score) || 0,
        },
        possession: possTeam ? normalizeEspnTeamCode(possTeam.team?.abbreviation ?? '') : null,
        date: String(event.date ?? ''),
      } satisfies NflGame;
    });

    return new Response(JSON.stringify({ week, games }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return empty();
  }
};
