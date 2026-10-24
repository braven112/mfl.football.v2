/**
 * Top Players' Owner column, from live rosters.
 *
 * The leaderboard (data/<league>/derived/top-players.json) is computed at
 * build time from the committed rosters.json, and since Oct 2026 the roster
 * sync commits that file once a day (scripts/lib/held-sync-files.mjs). So the
 * points are as fresh as the score feeds, but the Owner column could name
 * yesterday's owner: a player picked up this morning read as a free agent.
 * The page renders per request, so it lays the live rosters over the owners.
 *
 * Only the OWNER LIST changes. Names and crests come from the file's own owner
 * entries; a live owner the file has never named (a franchise with no scorer
 * in the leaderboard) leaves that player's committed owners untouched rather
 * than printing a bare franchise id.
 */
import { getCachedRosterFranchises, type CachedFranchiseRoster } from './mfl-roster-cache';
import { getLeagueYearForSlug } from './league-year';
import type { TopPlayerOwner, TopPlayersFile } from '../types/top-players';

/**
 * Pure half of {@link withLiveOwners}. An empty or missing live list returns
 * the file unchanged: "nobody is rostered" is never a live answer.
 */
export function overlayLiveOwners(data: TopPlayersFile, live: CachedFranchiseRoster[] | null | undefined): TopPlayersFile {
  if (!Array.isArray(live) || live.length === 0) return data;

  const known = new Map<string, TopPlayerOwner>();
  for (const p of data.players) {
    for (const o of p.owners) known.set(o.id, o);
  }

  // A LIST per player: the AFL rosters the same NFL player once per conference.
  const liveOwners = new Map<string, string[]>();
  for (const f of live) {
    for (const p of f.player ?? []) {
      if (!p?.id) continue;
      const ids = liveOwners.get(String(p.id)) ?? [];
      ids.push(String(f.id));
      liveOwners.set(String(p.id), ids);
    }
  }

  return {
    ...data,
    players: data.players.map((p) => {
      const ids = liveOwners.get(p.id) ?? [];
      if (ids.some((id) => !known.has(id))) return p;
      return { ...p, owners: ids.map((id) => known.get(id)!) };
    }),
  };
}

/**
 * The leaderboard with live owners, when its season is the league year MFL is
 * live in. A past season's rosters are final, and on any Redis or MFL failure
 * the committed owners render as before.
 */
export async function withLiveOwners(
  data: TopPlayersFile,
  league: { slug: string; id: string },
  now: Date = new Date(),
): Promise<TopPlayersFile> {
  if (data.seasonYear !== getLeagueYearForSlug(league.slug, now)) return data;
  try {
    return overlayLiveOwners(data, await getCachedRosterFranchises(String(data.seasonYear), league.id));
  } catch {
    return data;
  }
}
