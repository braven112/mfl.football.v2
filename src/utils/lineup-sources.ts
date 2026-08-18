/**
 * Lineup page data sources — reading a submitted lineup, and surviving a
 * failed MFL call.
 *
 * Two bugs on /theleague/lineup and /afl-fantasy/lineup motivated this
 * module, both worst on FUTURE weeks:
 *
 * 1. Both pages read the owner's saved lineup with
 *    `export?TYPE=myStarters`. `myStarters` is an IMPORT type, not an
 *    export one — MFL answers every such request with
 *    "Invalid Data Type (myStarters)". The parse then swallowed the error
 *    ("starters unavailable — slots will be empty"), so the pages NEVER
 *    showed a submitted lineup for any week; they silently rendered an
 *    optimal-by-projection fill instead. On a future week that reads as
 *    "the lineup I saved is gone".
 *
 *    `export?TYPE=weeklyResults&W=<week>` is the readable counterpart: it
 *    carries each franchise's `starters` CSV (plus a `player[]` array with
 *    `status: 'starter'`) as soon as a lineup is submitted, for future
 *    weeks as well as played ones.
 *
 * 2. Every page view fires ~9 live MFL calls. When one is throttled or
 *    times out the page degraded silently and differently depending on
 *    WHICH call died — a dead `rosters` call emptied every slot, a dead
 *    `players` call rendered "Player 13592" where a name belongs. The
 *    on-disk feed (synced every 5 minutes) is the floor under the roster
 *    call; player identity already has one in `getPlayerMap`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';

/** One player in a franchise's submitted lineup for a week. */
export interface LineupStarter {
  id: string;
  /** Actual fantasy points — 0 for a week that hasn't been played. */
  score: number;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Pull the entry for `week` out of a weeklyResults payload.
 *
 * Handles both shapes MFL returns:
 *  - `W=YTD`  → `{ allWeeklyResults: { weeklyResults: [ { week: '1', … }, … ] } }`
 *  - `W=<n>`  → `{ weeklyResults: { matchup: [ … ] } }` — note the single-week
 *    payload often omits `week` entirely, so a week-keyed lookup alone finds
 *    nothing. An unlabeled single entry is the week that was requested.
 */
export function findWeekResultsEntry(payload: any, week: number): any | null {
  if (!payload) return null;
  const unwrapped = payload?.allWeeklyResults ?? payload;

  const entries = Array.isArray(unwrapped)
    ? unwrapped
    : asArray(unwrapped?.weeklyResults);

  const normalized = entries
    .map((item: any) => item?.weeklyResults ?? item)
    .filter(Boolean);

  const matched = normalized.find((wr: any) => parseInt(wr?.week, 10) === week);
  if (matched) return matched;

  // Single unlabeled entry from a week-scoped fetch.
  if (normalized.length === 1 && normalized[0]?.week === undefined && normalized[0]?.matchup) {
    return normalized[0];
  }
  return null;
}

/**
 * The lineup a franchise has submitted for the week the entry describes,
 * in MFL's own order. Empty when no lineup is set (or the entry is missing).
 *
 * Reads BOTH channels MFL populates, because they are not redundant: the
 * `starters` CSV is present the moment a lineup is saved, while the
 * `player[]` rows carry the scores and can lag on an unplayed week.
 */
export function extractLineupStarters(weekEntry: any, franchiseId: string): LineupStarter[] {
  if (!weekEntry || !franchiseId) return [];

  for (const matchup of asArray(weekEntry.matchup)) {
    const side = asArray<any>(matchup?.franchise).find((f: any) => f?.id === franchiseId);
    if (!side) continue;

    const scoreById = new Map<string, number>();
    const startersFromRows: string[] = [];
    for (const p of asArray<any>(side.player)) {
      if (!p?.id || p.status !== 'starter') continue;
      startersFromRows.push(p.id);
      scoreById.set(p.id, parseFloat(p.score) || 0);
    }

    const csvIds = typeof side.starters === 'string'
      ? side.starters.split(',').map((id: string) => id.trim()).filter(Boolean)
      : [];

    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const id of [...csvIds, ...startersFromRows]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }

    return ordered.map((id) => ({ id, score: scoreById.get(id) ?? 0 }));
  }

  return [];
}

/**
 * The rosters feed committed under `data/<league>/mfl-feeds/<year>/` — the
 * fallback when the live `TYPE=rosters` call fails. Synced every 5 minutes,
 * so it is at worst minutes stale; an empty lineup page is worse.
 * Returns the raw MFL payload so callers parse one shape either way.
 */
export function loadRostersFeedFromDisk(slug: CanonicalLeagueSlug, leagueYear: number): any | null {
  const league = getLeagueBySlug(slug);
  if (!league) return null;
  try {
    const filePath = path.join(process.cwd(), league.dataPath, 'mfl-feeds', String(leagueYear), 'rosters.json');
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed?.rosters?.franchise ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The live rosters payload when it carries franchises, else the on-disk
 * feed. `rostersRes.ok` is not enough of a check: MFL answers a throttled
 * or malformed request with HTTP 200 and an `{ error: … }` body.
 */
export function resolveRostersPayload(
  livePayload: any,
  slug: CanonicalLeagueSlug,
  leagueYear: number,
): any | null {
  if (livePayload?.rosters?.franchise) return livePayload;
  return loadRostersFeedFromDisk(slug, leagueYear);
}
