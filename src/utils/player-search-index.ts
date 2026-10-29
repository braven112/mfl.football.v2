/**
 * The player half of the header's inline search (HeaderSearch.astro).
 *
 * Built from the league's committed MFL feeds — players.json for names,
 * rosters.json for who holds each player, league.json for team names — and
 * served as a prerendered file (src/pages/api/player-search/[league].json.ts),
 * so it is exactly as fresh as the build-baked pages around it and costs no
 * function call or MFL request per search.
 *
 * Only positions this league actually rosters are listed (players.json is
 * every player MFL knows, defensive linemen and punters included), and a
 * player can have MORE than one owner: an AFL player is routinely held once
 * in each conference, so ownership is a list (getOwnersByPlayer), never one id.
 */
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { getLeagueYearForSlug } from './league-year';
import { getOwnersByPlayer, OWNERSHIP_FEEDS, preloadOffseasonHeroData } from './offseason-hero-data';
import { asArray } from './mfl-normalize';
import { formatMflName } from './player-name-matching';
import { leagueFeedPath, preloadLeagueData, readLeagueDataSync } from './league-data';

export interface PlayerSearchEntry {
  id: string;
  /** "First Last" — MFL stores "Last, First". */
  name: string;
  pos: string;
  team: string;
  /** Franchise ids holding him, in roster order; empty for a free agent. */
  owners: string[];
}

export interface PlayerSearchIndex {
  year: number;
  /** Franchise id → team name, for the owners above. */
  teams: Record<string, string>;
  players: PlayerSearchEntry[];
}

/**
 * League data through src/utils/league-data.ts. The index is PRERENDERED, so
 * this runs at build time; the route still awaits {@link preloadPlayerSearchIndex}
 * first, so the sync build is served from memory rather than a disk fallback
 * (players.json is not shipped inside the function).
 */
function readFeed(dataPath: string, year: number, file: string): any {
  return readLeagueDataSync(leagueFeedPath(dataPath, year, file));
}

/** Load what `buildPlayerSearchIndex(league)` reads: this and last league year's feeds. */
export async function preloadPlayerSearchIndex(league: CanonicalLeagueSlug): Promise<void> {
  const def = getLeagueBySlug(league);
  if (!def) return;
  const current = getLeagueYearForSlug(league);
  const years = [current, current - 1];
  await Promise.all([
    preloadLeagueData(years.flatMap((y) => ['players.json', 'league.json'].map((f) => leagueFeedPath(def.dataPath, y, f)))),
    preloadOffseasonHeroData(league, years, OWNERSHIP_FEEDS),
  ]);
}

export function buildPlayerSearchIndex(league: CanonicalLeagueSlug): PlayerSearchIndex {
  const def = getLeagueBySlug(league);
  if (!def) return { year: 0, teams: {}, players: [] };

  // Between a league rollover and the first sync the new year's directory can
  // be missing; last year's feeds are the honest fallback.
  const current = getLeagueYearForSlug(league);
  const year = [current, current - 1].find((y) => readFeed(def.dataPath, y, 'players.json')) ?? current;

  const players = asArray<any>(readFeed(def.dataPath, year, 'players.json')?.players?.player);
  const owners = getOwnersByPlayer(year, league, { activeOnly: false });
  const franchises = asArray<any>(readFeed(def.dataPath, year, 'league.json')?.league?.franchises?.franchise);
  const teams: Record<string, string> = {};
  for (const f of franchises) if (f?.id) teams[f.id] = String(f.name ?? f.id).trim();

  const byId = new Map(players.map((p) => [String(p.id), p]));
  const rosteredPositions = new Set(
    [...owners.keys()].map((id) => byId.get(id)?.position).filter(Boolean) as string[],
  );

  const entries: PlayerSearchEntry[] = [];
  for (const p of players) {
    if (!p?.id || !p.name || !rosteredPositions.has(p.position)) continue;
    const id = String(p.id);
    entries.push({
      id,
      name: formatMflName(String(p.name)),
      pos: String(p.position),
      team: String(p.team ?? ''),
      owners: owners.get(id) ?? [],
    });
  }
  return { year, teams, players: entries };
}
