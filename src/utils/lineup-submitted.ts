/**
 * Has this franchise submitted a lineup for the week? A yes/no/unknown read
 * for the homepage hero, cheap enough to run on a Saturday-evening render.
 *
 * Follows docs/claude/rules/lineups.md to the letter:
 *  - The readable source is `export?TYPE=weeklyResults&W=<week>`: it carries
 *    each franchise's `starters` CSV as soon as a lineup is saved, for future
 *    weeks too, and unauthenticated. One live call, short timeout, cached in
 *    process for a few minutes per (league, year, week) — the homepage must
 *    not pay a fresh MFL round-trip per visitor.
 *  - The committed feed under data/<league>/mfl-feeds/ is ONE-WAY evidence:
 *    it syncs daily, so it can CONFIRM a lineup exists but never deny one. It
 *    is the fallback when the live read fails, and it only ever answers true.
 *  - "No lineup" and "couldn't read it" are different answers: `false` means
 *    MFL listed the franchise this week with no starters; `null` means we
 *    could not establish either — and the caller must treat null as "keep the
 *    reminder", never as "no lineup".
 */

import type { LeagueDefinition } from '../config/leagues';
import { buildMflExportUrl } from './mfl-url';
import {
  extractLineupStarters,
  findWeekResultsEntry,
  franchiseAppearsIn,
  loadWeeklyResultsFeedFromDisk,
} from './lineup-sources';

const CACHE_TTL_MS = 5 * 60 * 1000;
/** A failed live read is remembered briefly too, so an MFL outage on a Saturday evening costs one stall per minute, not one per visitor. */
const FAILURE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; payload: any }>();

/**
 * Pure: what a weeklyResults payload says about one franchise's lineup for
 * `week`. `allowUnlabeled` belongs ONLY to a week-scoped live fetch (the
 * request itself names the week); on the committed archive — an array of
 * per-week payloads — it would answer any week with the one entry on file.
 */
export function lineupSubmittedFromPayload(
  payload: any,
  week: number,
  franchiseId: string,
  { allowUnlabeled = false }: { allowUnlabeled?: boolean } = {},
): boolean | null {
  const entry = findWeekResultsEntry(payload, week, { allowUnlabeled });
  if (!entry || !franchiseAppearsIn(entry, franchiseId)) return null;
  return extractLineupStarters(entry, franchiseId).length > 0;
}

export interface HasSubmittedLineupInput {
  league: LeagueDefinition;
  franchiseId: string;
  week: number;
  /** The league's own year — `getLeagueYearForSlug` (the AFL rolls June 1). */
  leagueYear: number;
  timeoutMs?: number;
  /** Test seam: replaces the live fetch. */
  fetchImpl?: typeof fetch;
}

async function readLive(input: HasSubmittedLineupInput): Promise<any | null> {
  const { league, week, leagueYear, timeoutMs = 3000 } = input;
  const key = `${league.id}:${leagueYear}:w${week}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.payload ? CACHE_TTL_MS : FAILURE_TTL_MS)) return hit.payload;
  const remember = (payload: any) => { cache.set(key, { at: Date.now(), payload }); return payload; };
  try {
    const url = buildMflExportUrl({ type: 'weeklyResults', leagueId: league.id, year: leagueYear, params: { W: week }, host: `https://${league.mflHost}` });
    const res = await (input.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return remember(null);
    const payload = await res.json().catch(() => null);
    // `res.ok` is not "the call worked" — only a payload that carries the week counts as an answer.
    if (!findWeekResultsEntry(payload, week, { allowUnlabeled: true })) return remember(null);
    return remember(payload);
  } catch {
    return remember(null);
  }
}

export async function hasSubmittedLineup(input: HasSubmittedLineupInput): Promise<boolean | null> {
  const live = await readLive(input);
  if (live) return lineupSubmittedFromPayload(live, input.week, input.franchiseId, { allowUnlabeled: true });
  // Disk: confirm-only. A lineup saved since the last sync is simply absent.
  const disk = loadWeeklyResultsFeedFromDisk(input.league.slug as any, input.leagueYear);
  return lineupSubmittedFromPayload(disk, input.week, input.franchiseId) === true ? true : null;
}

/** Test seam. */
export function clearLineupSubmittedCache(): void {
  cache.clear();
}
