/**
 * useNflTeamPlayers — every MFL player on two NFL teams, for an NFL game's
 * drill-in on the live boards.
 *
 * Identity only, so it is read ONCE per (teams, year) per page life rather
 * than polled: a club's players do not change during a game, and the points
 * come from the board's own live payloads. A failed read is dropped from the
 * cache so the next open retries — never pin a failure (same rule as
 * `rules-cache.ts`).
 */
import { useEffect, useState } from 'react';
import type { PlayerMeta } from '../types/live-scoring';

interface PoolResponse {
  ok: boolean;
  players: PlayerMeta[];
}

const cache = new Map<string, Promise<PoolResponse>>();

function loadPool(teams: string[], year: number, storeBuild: boolean): Promise<PoolResponse> {
  const key = `${year}:${teams.join(',')}:${storeBuild ? 'mfl' : 'web'}`;
  let hit = cache.get(key);
  if (!hit) {
    const failed: PoolResponse = { ok: false, players: [] };
    const params = new URLSearchParams({ teams: teams.join(','), year: String(year) });
    if (storeBuild) params.set('source', 'mfl');
    hit = fetch(`/api/nfl-team-players?${params}`, { headers: { Accept: 'application/json' } })
      .then((res) => res.json())
      // `res.ok` is not "the data is good" — gate on the flag.
      .then((data: PoolResponse) => (data && data.ok === true && Array.isArray(data.players) ? data : failed))
      .catch(() => failed)
      .then((data) => {
        if (!data.ok) cache.delete(key);
        return data;
      });
    cache.set(key, hit);
  }
  return hit;
}

export type PoolState = { status: 'loading' | 'error' | 'ok'; players: PlayerMeta[] };

export function useNflTeamPlayers(
  teams: readonly string[],
  year: number,
  { enabled = true, storeBuild = false }: { enabled?: boolean; storeBuild?: boolean } = {},
): PoolState {
  const sorted = [...new Set(teams.filter(Boolean).map((t) => t.toUpperCase()))].sort();
  const key = enabled && sorted.length > 0 ? `${year}:${sorted.join(',')}:${storeBuild}` : '';
  const [state, setState] = useState<{ key: string } & PoolState>({ key: '', status: 'loading', players: [] });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadPool(sorted, year, storeBuild).then((data) => {
      if (cancelled) return;
      setState({ key, status: data.ok ? 'ok' : 'error', players: data.players });
    });
    return () => {
      cancelled = true;
    };
    // `sorted` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { status: 'ok', players: [] };
  return state.key === key ? state : { status: 'loading', players: [] };
}
