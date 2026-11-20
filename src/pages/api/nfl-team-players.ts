import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getPlayerMap, preloadPlayerIdentity } from '../../utils/player-map';
import type { PlayerMeta } from '../../types/live-scoring';

export const prerender = false;

/**
 * Every MFL player on up to two NFL teams — the pool behind an NFL game's
 * drill-in on the live boards (`LvNflGameDetail`).
 *
 * The board's own identity map only holds ROSTERED players, so a free agent
 * who scores in the game would otherwise have no name, position or headshot.
 * Identity only: no points (the board scores them with the league's rules) and
 * NO ESPN id — `PlayerMeta.espnId` is always null across the response
 * boundary, because the identity's `espnId` can hold a COLLEGE athlete id and
 * college and NFL ids are both plain digits (docs/claude/rules/live-scoring.md).
 *
 * The year is the SEASON being scored, the same map the board builders read,
 * so a player's club here agrees with his club on the board's own rows.
 *
 * `source=mfl` is the MFL Live app's store build, which ships no headshots.
 *
 * Public and cacheable: it is the same answer for every viewer, it reads no
 * session, and it never reaches MFL — the player map is committed league data.
 */
const TEAM = /^[A-Z]{2,3}$/;

const json = (body: unknown, status: number, cache: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });

export const GET: APIRoute = async ({ url }) => {
  const teams = [
    ...new Set(
      (url.searchParams.get('teams') ?? '')
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter((t) => TEAM.test(t)),
    ),
  ].slice(0, 2);
  if (teams.length === 0) {
    return json({ ok: false, players: [] }, 400, 'no-store');
  }

  const current = getCurrentSeasonYear();
  const yearNum = Number.parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= current + 1 ? yearNum : current;
  const storeBuild = url.searchParams.get('source') === 'mfl';

  await preloadPlayerIdentity([year]).catch(() => undefined);
  const map = getPlayerMap(year);
  if (map.size === 0) {
    // "We could not read the players" is not "these teams have none".
    return json({ ok: false, players: [] }, 200, 'no-store');
  }

  const wanted = new Set(teams);
  const players: PlayerMeta[] = [];
  for (const p of map.values()) {
    if (!wanted.has(String(p.nflTeam ?? '').toUpperCase())) continue;
    players.push({
      id: p.mflId,
      name: p.name,
      position: p.position,
      nflTeam: p.nflTeam,
      headshot: storeBuild ? '' : p.headshot,
      espnId: null,
      projected: 0,
    });
  }
  players.sort((a, b) => a.id.localeCompare(b.id));

  return json({ ok: true, year, teams, players }, 200, 'public, max-age=600, s-maxage=3600');
};
