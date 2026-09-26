/**
 * Who in the league rosters players from one NFL club.
 *
 * This is what makes the Brand Book a LEAGUE page rather than a brand sheet:
 * open the Bears and you see which franchises own Bears.
 *
 * League-neutral by construction. Franchise names come from the MFL
 * `league.json` feed rather than `src/data/theleague.config.json`, which is
 * TheLeague's alone — a page that exists in both leagues cannot read one
 * league's config file (CLAUDE.md § "never hardcode league constants").
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUES, type CanonicalLeagueSlug } from '../config/leagues';
import { getPlayerMap } from './player-map';
import { getOwnersByPlayer } from './offseason-hero-data';

export interface ClubRosterEntry {
  franchiseId: string;
  franchiseName: string;
  /**
   * `espnId` and `headshot` ride along because the roster panel renders the
   * REAL PlayerCell, and that component's headshot fallback chain starts at
   * the ESPN id — without it every player falls straight through to the
   * team-coloured placeholder silhouette.
   */
  players: { id: string; name: string; position: string; espnId: string | null; headshot: string }[];
}

function feedsRoot(league: CanonicalLeagueSlug): string {
  // A demo-only slot (keeper) is absent from LEAGUES everywhere but a demo deployment.
  const entry = LEAGUES[league];
  if (!entry) throw new Error(`nfl-club-rosters: league ${league} is not registered here`);
  return join(process.cwd(), entry.dataPath, 'mfl-feeds');
}

/**
 * The newest league-year directory on disk.
 *
 * An MFL feed directory is keyed by the LEAGUE year, not the season year, and
 * the two disagree between the league rollover and Labor Day — so this reads
 * what is actually there rather than deriving a year and risking a miss
 * (CLAUDE.md § "An MFL feed directory is keyed by the LEAGUE year").
 */
export function latestFeedYear(league: CanonicalLeagueSlug): number | null {
  const root = feedsRoot(league);
  if (!existsSync(root)) return null;
  const years = readdirSync(root)
    .filter((d) => /^\d{4}$/.test(d))
    .map(Number)
    .sort((a, b) => b - a);
  return years[0] ?? null;
}

function franchiseNames(league: CanonicalLeagueSlug, year: number): Map<string, string> {
  const out = new Map<string, string>();
  const path = join(feedsRoot(league), String(year), 'league.json');
  if (!existsSync(path)) return out;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const list = raw?.league?.franchises?.franchise ?? [];
    for (const f of Array.isArray(list) ? list : [list]) {
      if (f?.id) out.set(f.id, f.name || f.id);
    }
  } catch {
    /* a feed we cannot read is an empty roster panel, never a broken page */
  }
  return out;
}

/**
 * Franchises rostering players from `code`, each with those players.
 *
 * Ownership is a LIST: an AFL player is routinely rostered in both
 * conferences, so this returns every holder rather than a single owner
 * (CLAUDE.md § player composites). `activeOnly: false` — the question here is
 * ownership, not startability, so a taxi-squad Bear still counts.
 */
export function clubRosterHolders(
  code: string,
  league: CanonicalLeagueSlug,
): { year: number | null; holders: ClubRosterEntry[] } {
  const year = latestFeedYear(league);
  if (!year) return { year: null, holders: [] };

  let players: ReturnType<typeof getPlayerMap>;
  let owners: Map<string, string[]>;
  try {
    players = getPlayerMap(year);
    owners = getOwnersByPlayer(year, league, { activeOnly: false });
  } catch {
    return { year, holders: [] };
  }

  const names = franchiseNames(league, year);
  const byFranchise = new Map<string, ClubRosterEntry>();

  for (const [mflId, identity] of players) {
    if (identity.nflTeam !== code) continue;
    for (const franchiseId of owners.get(mflId) ?? []) {
      let entry = byFranchise.get(franchiseId);
      if (!entry) {
        entry = {
          franchiseId,
          franchiseName: names.get(franchiseId) || `Franchise ${franchiseId}`,
          players: [],
        };
        byFranchise.set(franchiseId, entry);
      }
      entry.players.push({
        id: mflId,
        name: identity.name,
        position: identity.position,
        espnId: identity.espnId,
        headshot: identity.headshot,
      });
    }
  }

  const holders = [...byFranchise.values()].sort(
    (a, b) => b.players.length - a.players.length || a.franchiseName.localeCompare(b.franchiseName),
  );
  for (const h of holders) {
    h.players.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { year, holders };
}
