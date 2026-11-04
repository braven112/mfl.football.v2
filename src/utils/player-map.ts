/**
 * Unified Player Identity Map
 *
 * Single source of truth for player identity data (name, position, NFL team, headshot).
 * Reads from the MFL feed JSON on disk (synced every 5 min via GitHub Actions).
 *
 * @example
 * ```typescript
 * import { getPlayerMap, getPlayer } from '../utils/player-map';
 *
 * const players = getPlayerMap(2026);
 * const mahomes = players.get('13116');
 * // => { mflId: '13116', name: 'Patrick Mahomes', position: 'QB', nflTeam: 'KC', headshot: '...', espnId: '3139477' }
 *
 * // Convenience single lookup
 * const player = getPlayer(2026, '13116');
 * ```
 */

import { normalizeTeamCode } from './nfl-logo';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { isLeagueDataLoaded, listLeagueData, preloadLeagueData, readLeagueDataSync } from './league-data';
import {
  getCollegeHeadshot,
  getPlayerHeadshot,
  getPlayerImageUrl,
  resolveEspnId,
} from '../constants/roster-constants';

export interface PlayerIdentity {
  mflId: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /**
   * Best-guess ESPN id — may be an NFL athlete id OR a college one (see
   * `resolveEspnId`). Fine for picking a headshot, because `headshot` above
   * already picks the matching URL. NOT safe for anything that assumes an NFL
   * athlete — use `nflEspnId` for that.
   */
  espnId: string | null;
  /**
   * ESPN id that is definitely an NFL athlete, or null. Sourced from the feed's
   * own `espn_id`, falling back to the generated backfill for the players MFL
   * omits one for (see `nflIdBackfill` below). Consumers hitting NFL-scoped
   * ESPN endpoints must use this: a college id is numerically indistinguishable
   * from an NFL one, so passing one to the NFL athlete endpoints silently
   * addresses a DIFFERENT player rather than failing. Same reason `headshot`
   * splits the two URLs.
   */
  nflEspnId: string | null;
  /** NFL draft year from the MFL feed (e.g. '2026'); empty for undrafted/unknown */
  draftYear: string;
}

/** Fantasy-relevant positions to include */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def']);

/** Module-level cache: year → player map */
const cache = new Map<number, Map<string, PlayerIdentity>>();

/** College ID mapping (loaded once) */
let collegeIdMap: Record<string, { espnCollegeId?: string }> | null = null;

/**
 * ESPN NFL athlete ids for players MFL's feed omits an `espn_id` for
 * (scripts/fetch-espn-athlete-ids.mjs, refreshed in prebuild).
 *
 * MFL simply has no espn_id for a couple of dozen players, and some of them
 * are starters — D'Andre Swift, Tony Pollard and three starting kickers were
 * all in the gap. Since `nflEspnId` is the join key for every ESPN-backed
 * surface (live box scores, scoring-play attribution, player news), a missing
 * id silently drops a real starter out of features he belongs in rather than
 * failing loudly.
 *
 * This is a strict GAP FILL: MFL's own espn_id always wins below, so the
 * backfill can never override an id the feed is sure about. Its entries are
 * NFL-only by construction (matched against ESPN's NFL team rosters, or its
 * search filtered on the NFL league uid), which is what keeps a college
 * athlete id — numerically indistinguishable from an NFL one — out of this
 * field. `tests/espn-athlete-id-coverage.test.ts` fails the build if a
 * rostered player ever loses his id again.
 */
let nflIdBackfill: Record<string, string> | null = null;

/**
 * Every file this module reads lives in league data, which is read through
 * src/utils/league-data.ts rather than off disk: these helpers are sync and
 * called from ~50 places, so the files are PRELOADED — the hot set (current
 * seasons, the unions, the id maps) by `src/middleware.ts` on every request,
 * anything else by the caller through {@link preloadPlayerIdentity}. A year
 * nobody preloaded still resolves (see `readLeagueDataSync`) but is logged
 * and, once players.json leaves the function, reads back empty in
 * production.
 */
const identityDataPath = (): string => getLeagueBySlug('theleague')!.dataPath;
const collegeIdsPath = () => `${identityDataPath()}/espn-college-ids.json`;
const nflIdBackfillPath = () => `${identityDataPath()}/derived/espn-nfl-id-backfill.json`;
const playersFeedPath = (year: number) => `${identityDataPath()}/mfl-feeds/${year}/players.json`;
const unionPath = (leagueSlug: string) => `data/${leagueSlug}/derived/player-identity-union.json`;

/**
 * The files `getPlayerMap(year)` / `getGlobalPlayerMap()` read, for the given
 * league years. Every league's identity union is included (they are small and
 * the global map is asked for by slug).
 */
export function playerIdentityPaths(years: Iterable<number>): string[] {
  return [
    collegeIdsPath(),
    nflIdBackfillPath(),
    ...[...new Set(years)].map(playersFeedPath),
    ...listLeagueData('data/*/derived/player-identity-union.json'),
  ];
}

/** Load what `getPlayerMap(year)` needs for `years`, so the sync call is served from memory. */
export function preloadPlayerIdentity(years: Iterable<number>): Promise<void> {
  return preloadLeagueData(playerIdentityPaths(years));
}

function loadCollegeIds(): Record<string, { espnCollegeId?: string }> {
  if (collegeIdMap) return collegeIdMap;
  const raw = readLeagueDataSync<{ players?: Record<string, { espnCollegeId?: string }> }>(collegeIdsPath());
  const loaded = isLeagueDataLoaded(collegeIdsPath());
  const ids = raw?.players || {};
  if (loaded) collegeIdMap = ids;
  return ids;
}

function loadNflIdBackfill(): Record<string, string> {
  if (nflIdBackfill) return nflIdBackfill;
  // Artifact missing (fresh clone before prebuild) — degrade to MFL's own
  // ids rather than throwing. Coverage drops; nothing else breaks.
  const raw = readLeagueDataSync<{ ids?: Record<string, string> }>(nflIdBackfillPath());
  const loaded = isLeagueDataLoaded(nflIdBackfillPath());
  const ids = raw?.ids || {};
  if (loaded) nflIdBackfill = ids;
  return ids;
}

/**
 * Convert MFL name format to display format.
 * Regular players: "Last, First" → "First Last"
 * DEF/Team entries: "Bills, Buffalo" → "Buffalo Bills"
 */
function formatName(mflName: string, position: string): string {
  const commaIndex = mflName.indexOf(',');
  if (commaIndex === -1) return mflName;

  const part1 = mflName.slice(0, commaIndex).trim();
  const part2 = mflName.slice(commaIndex + 1).trim();

  // For team defenses, format as "City Team" (e.g., "Buffalo Bills")
  if (position === 'Def' || position === 'DEF') {
    return `${part2} ${part1}`;
  }

  // Regular players: "Last, First" → "First Last"
  return `${part2} ${part1}`;
}

/**
 * Normalize position codes from MFL format.
 * 'Def' → 'DEF', everything else stays uppercase as-is.
 */
function normalizePosition(pos: string): string {
  if (pos === 'Def') return 'DEF';
  return pos;
}

/**
 * Build a PlayerIdentity from one raw MFL player row.
 *
 * Shared by the per-year map and the all-years union so the two cannot drift —
 * they read different files but must agree on what a player's identity IS.
 * Returns null for positions we don't carry.
 */
function toIdentity(
  p: Record<string, string>,
  collegeIds: Record<string, { espnCollegeId?: string }>,
  backfill: Record<string, string> = {}
): PlayerIdentity | null {
  const position = p.position || '';
  if (!FANTASY_POSITIONS.has(position)) return null;

  const mflId = p.id;
  // MFL's own espn_id first, ALWAYS. The backfill only fills the gap where MFL
  // has none — it must never override an id the feed already asserts.
  const nflEspnId = p.espn_id || backfill[mflId] || '';
  const collegeEspnId = collegeIds[mflId]?.espnCollegeId || '';
  // Keep `espnId` as the best-guess ID for callers that need one, but
  // build `headshot` from the *matching* URL — ESPN's NFL headshot
  // endpoint returns 404 for a college ID, so a rookie with only a
  // college ESPN ID has to use the college-football URL instead.
  const espnId = resolveEspnId(mflId, { espn_id: nflEspnId || undefined }, collegeIds);
  const headshot = nflEspnId
    ? getPlayerHeadshot(mflId, nflEspnId)
    : collegeEspnId
      ? getCollegeHeadshot(collegeEspnId)
      : getPlayerImageUrl(mflId);

  return {
    mflId,
    name: formatName(p.name || '', position),
    position: normalizePosition(position),
    nflTeam: normalizeTeamCode(p.team || ''),
    headshot,
    espnId,
    nflEspnId: nflEspnId || null,
    draftYear: p.draft_year || '',
  };
}

/**
 * Get the complete player identity map for a given year.
 * Results are cached in memory — multiple calls with the same year return the same Map instance.
 *
 * @param year - The league year (e.g., 2026)
 * @returns Map of MFL player ID → PlayerIdentity
 */
export function getPlayerMap(year: number): Map<string, PlayerIdentity> {
  const cached = cache.get(year);
  if (cached) return cached;

  const playerMap = new Map<string, PlayerIdentity>();

  // Feed file missing for this year — empty map.
  const path = playersFeedPath(year);
  const raw = readLeagueDataSync<any>(path);
  const loaded = isLeagueDataLoaded(path);
  const players: Array<Record<string, string>> = raw?.players?.player || [];
  const collegeIds = loadCollegeIds();
  const backfill = loadNflIdBackfill();

  for (const p of players) {
    const identity = toIdentity(p, collegeIds, backfill);
    if (identity) playerMap.set(identity.mflId, identity);
  }

  // A year whose file could not be read (not preloaded, and not on disk) is
  // not cached: the next request that preloads it must get the real map.
  if (loaded) cache.set(year, playerMap);
  return playerMap;
}

/**
 * Get a single player's identity by MFL ID.
 * Convenience wrapper around getPlayerMap().
 *
 * @param year - The league year
 * @param mflId - MFL player ID
 * @returns PlayerIdentity or undefined if not found
 */
export function getPlayer(year: number, mflId: string): PlayerIdentity | undefined {
  return getPlayerMap(year).get(mflId);
}

/** Per-league union caches. Keyed by league slug — the AFL has its own
 * artifact, and one shared cache would serve whichever league asked first. */
const globalMapCache = new Map<string, Map<string, PlayerIdentity>>();

/**
 * Union of every season's player map into one lookup, keyed by MFL ID.
 *
 * MFL player IDs are global and stable across seasons, so a player who is
 * missing from one season's feed (e.g. pre-2011 years have no `players.json`
 * at all) can still be resolved from a later season in which he appears.
 * The most recent season a player appears in wins, so his `espnId`/`headshot`
 * reflect the freshest feed data. This is the resolver historical pages
 * (Dead Money Awards, records) need to attach ESPN headshots to legacy
 * players whose own season predates the feed archive.
 *
 * Reads the precomputed union (`scripts/compute-player-identity-union.mjs`,
 * run in prebuild) rather than scanning every season's feed at request time.
 * Past seasons are immutable, so the union is a build artifact — deriving it
 * per cold start meant 23.5 MB of reads for a 0.37 MB answer, and the
 * `readdirSync` on a runtime-constructed path defeated Vercel's file tracer,
 * which then copied all of `data/` into the serverless bundle.
 *
 * Each league has its OWN artifact. The AFL needs one because its Draft
 * Results page reaches back to 2003 while TheLeague's union only covers
 * players who appeared in TheLeague. MFL player ids are global, so the two
 * unions COMPOSE — the AFL page reads its own first and falls back to
 * TheLeague's for anyone it misses.
 *
 * @param leagueSlug - Which league's union to read. Defaults to TheLeague,
 *   which is what every pre-existing caller means. Typed to the registry's
 *   slugs rather than `string`: it is interpolated into a filesystem path,
 *   so a typo would silently read nothing and return an empty map, and a
 *   non-constant caller could otherwise walk out of `data/`.
 * @returns Map of MFL player ID → PlayerIdentity (most-recent-season wins)
 */
export function getGlobalPlayerMap(
  leagueSlug: CanonicalLeagueSlug = 'theleague'
): Map<string, PlayerIdentity> {
  const cached = globalMapCache.get(leagueSlug);
  if (cached) return cached;

  const merged = new Map<string, PlayerIdentity>();
  // Union artifact missing — an empty map, matching the previous behaviour
  // when the feeds directory was absent.
  const path = unionPath(leagueSlug);
  const raw = readLeagueDataSync<any>(path);
  const loaded = isLeagueDataLoaded(path);
  const collegeIds = loadCollegeIds();
  const backfill = loadNflIdBackfill();

  for (const p of (raw?.players || []) as Array<Record<string, string>>) {
    const identity = toIdentity(p, collegeIds, backfill);
    if (identity) merged.set(identity.mflId, identity);
  }

  if (loaded) globalMapCache.set(leagueSlug, merged);
  return merged;
}

/**
 * Clear the player map cache. Useful for testing or when feed files are updated.
 */
export function clearPlayerMapCache(): void {
  cache.clear();
  collegeIdMap = null;
  nflIdBackfill = null;
  globalMapCache.clear();
}

// Vite HMR support — clear cache when module is hot-replaced in dev
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    cache.clear();
    collegeIdMap = null;
    nflIdBackfill = null;
    globalMapCache.clear();
  });
}
