/**
 * The current league year's rosters, live from MFL, in the rosters.json shape.
 *
 * Since Oct 2026 the roster sync holds the current year's `rosters.json` (and
 * `transactions.json`) out of its commit and lets them through once a day
 * (scripts/lib/held-sync-files.mjs), so the committed copy can be a day old.
 * Every page that shows owners who holds whom reads through here instead:
 * `getCachedRosterFranchises` (Redis, refreshed from MFL when older than 60 s)
 * replaces the franchise list, and on ANY failure — no Redis, an MFL error, an
 * empty answer — the committed feed is returned exactly as given. Stale is
 * acceptable as a fallback; "nobody is rostered" never is, so an empty live
 * list counts as no answer.
 *
 * Franchise-shaped, not the player-keyed `getCachedRosters` map, because the
 * AFL rosters the same player once per conference and a player-keyed map keeps
 * only one of them.
 *
 * `tests/sync-noise-commit-guard.test.ts` pins every reader to this (or to the
 * caches directly), so a new page that reads the committed copy alone fails.
 */
import { getCachedRosterFranchises, type CachedFranchiseRoster } from '../mfl-roster-cache';

const toArray = <T,>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : [];

/**
 * Pure half of {@link liveRostersFeed}: the committed feed with its franchise
 * list replaced by the live one. Each live row is laid over the committed row
 * for the same franchise and player, so a field the cache does not carry (or a
 * payload cached before it did, e.g. `contractInfo`) keeps its committed value
 * rather than vanishing. Fields the live row leaves undefined never blank one.
 */
export function overlayLiveFranchises<T>(committed: T, live: CachedFranchiseRoster[] | null | undefined): T {
  if (!Array.isArray(live) || live.length === 0) return committed;
  const base = (committed ?? {}) as any;
  const committedById = new Map<string, any>();
  for (const f of toArray<any>(base?.rosters?.franchise)) {
    if (f?.id) committedById.set(String(f.id), f);
  }
  const franchise = live.map((lf) => {
    const prev = committedById.get(String(lf.id));
    const prevPlayers = new Map<string, any>();
    for (const p of toArray<any>(prev?.player)) {
      if (p?.id) prevPlayers.set(String(p.id), p);
    }
    const player = lf.player.map((lp) => {
      const merged: Record<string, unknown> = { ...(prevPlayers.get(String(lp.id)) ?? {}) };
      for (const [key, value] of Object.entries(lp)) {
        if (value !== undefined) merged[key] = value;
      }
      return merged;
    });
    return { ...(prev ?? {}), id: lf.id, player };
  });
  return { ...base, rosters: { ...(base?.rosters ?? {}), franchise } } as T;
}

/**
 * The rosters feed to render for `season`: live when the cache answers, the
 * committed feed otherwise. Call it only for the CURRENT league year — the
 * cache fetches whatever year it is asked for, and an archive season's
 * committed file is already final.
 */
export async function liveRostersFeed<T>(committed: T, season: number | string, leagueId: string): Promise<T> {
  try {
    return overlayLiveFranchises(committed, await getCachedRosterFranchises(String(season), leagueId));
  } catch {
    return committed;
  }
}

/** Every player id on any roster in a rosters-shaped feed. */
export function rosteredIdsOf(feed: unknown): Set<string> {
  const ids = new Set<string>();
  for (const f of toArray<any>((feed as any)?.rosters?.franchise)) {
    for (const p of toArray<any>(f?.player)) {
      if (p?.id) ids.add(String(p.id));
    }
  }
  return ids;
}
