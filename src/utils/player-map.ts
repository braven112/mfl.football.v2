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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTeamCode } from './nfl-logo';
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
  espnId: string | null;
}

/** Fantasy-relevant positions to include */
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'Def']);

/** Module-level cache: year → player map */
const cache = new Map<number, Map<string, PlayerIdentity>>();

/** College ID mapping (loaded once) */
let collegeIdMap: Record<string, { espnCollegeId?: string }> | null = null;

function loadCollegeIds(): Record<string, { espnCollegeId?: string }> {
  if (collegeIdMap) return collegeIdMap;
  try {
    const filePath = join(process.cwd(), 'data/theleague/espn-college-ids.json');
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    collegeIdMap = raw.players || {};
  } catch {
    collegeIdMap = {};
  }
  return collegeIdMap!;
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

  try {
    const filePath = join(process.cwd(), `data/theleague/mfl-feeds/${year}/players.json`);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const players: Array<Record<string, string>> = raw?.players?.player || [];
    const collegeIds = loadCollegeIds();

    for (const p of players) {
      const position = p.position || '';
      if (!FANTASY_POSITIONS.has(position)) continue;

      const mflId = p.id;
      const normalizedPosition = normalizePosition(position);
      const nflTeam = normalizeTeamCode(p.team || '');
      const nflEspnId = p.espn_id || '';
      const collegeEspnId = collegeIds[mflId]?.espnCollegeId || '';
      // Keep `espnId` as the best-guess ID for callers that need one, but
      // build `headshot` from the *matching* URL — ESPN's NFL headshot
      // endpoint returns 404 for a college ID, so a rookie with only a
      // college ESPN ID has to use the college-football URL instead.
      const espnId = resolveEspnId(mflId, p as { espn_id?: string }, collegeIds);
      const headshot = nflEspnId
        ? getPlayerHeadshot(mflId, nflEspnId)
        : collegeEspnId
          ? getCollegeHeadshot(collegeEspnId)
          : getPlayerImageUrl(mflId);
      const name = formatName(p.name || '', position);

      playerMap.set(mflId, {
        mflId,
        name,
        position: normalizedPosition,
        nflTeam,
        headshot,
        espnId,
      });
    }
  } catch {
    // Feed file missing for this year — return empty map
  }

  cache.set(year, playerMap);
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

/**
 * Clear the player map cache. Useful for testing or when feed files are updated.
 */
export function clearPlayerMapCache(): void {
  cache.clear();
  collegeIdMap = null;
}

// Vite HMR support — clear cache when module is hot-replaced in dev
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    cache.clear();
    collegeIdMap = null;
  });
}
