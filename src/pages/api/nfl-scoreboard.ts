import type { APIRoute } from 'astro';
import type { NflGame, NflScoreboardResponse } from '../../types/live-scoring';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { canonicalNflCode, parseGameSituation } from '../../utils/espn-game-detail';
import { buildEspnScoreboardUrl, espnSeasonSlot } from '../../utils/espn-scoreboard-url';

export const prerender = false;

/**
 * Real NFL scoreboard for the live-scoring page — score, quarter, real clock,
 * possession, and the in-progress drive situation (red zone, down & distance,
 * last play). Proxies ESPN's public scoreboard API.
 *
 * `no-store`: scores must never be cached. A CDN copy of a live scoreboard is
 * not stale, it is wrong while looking live.
 *
 * Note `ok` in the response. An empty `games` array on a Tuesday is a healthy
 * answer; an empty one because ESPN 500'd is an outage. Collapsing the two
 * makes an outage render as "no games today", which is the exact failure mode
 * this repo keeps re-learning (resolveLineupFillState, player-news).
 */
export const GET: APIRoute = async ({ url }) => {
  const parsedWeek = parseInt(url.searchParams.get('week') ?? '', 10);
  const week = Number.isFinite(parsedWeek) && parsedWeek > 0 ? parsedWeek : 1;

  const yearNum = parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? yearNum
    : getCurrentSeasonYear();

  const espnUrl = buildEspnScoreboardUrl(espnSeasonSlot(week), year);

  const respond = (body: NflScoreboardResponse) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  try {
    const res = await fetch(espnUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return respond({ ok: false, week, games: [] });
    const data = await res.json();
    const events: any[] = data?.events ?? [];

    const games: NflGame[] = events.map((event: any) => {
      const comp = event?.competitions?.[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');
      const status = comp.status ?? event.status ?? {};
      const state: 'pre' | 'in' | 'post' = status?.type?.state ?? 'pre';

      // `situation` is present only while the game is being played. Parsing it
      // resolves possession from ESPN's numeric team id and canonicalizes the
      // code, so a consumer can compare it against a player's own NFL team.
      const situation = state === 'in' ? parseGameSituation(comp) : null;

      return {
        id: String(event.id ?? ''),
        state,
        shortDetail: status?.type?.shortDetail ?? '',
        period: Number(status?.period) || 0,
        clock: status?.displayClock ?? '',
        home: {
          code: canonicalNflCode(home?.team?.abbreviation ?? ''),
          score: Number(home?.score) || 0,
        },
        away: {
          code: canonicalNflCode(away?.team?.abbreviation ?? ''),
          score: Number(away?.score) || 0,
        },
        possession: situation?.possession || null,
        date: String(event.date ?? ''),
        situation,
      } satisfies NflGame;
    });

    return respond({ ok: true, week, games });
  } catch (error) {
    console.error('Error fetching NFL scoreboard:', error);
    return respond({ ok: false, week, games: [] });
  }
};
