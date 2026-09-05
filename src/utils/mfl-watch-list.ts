/**
 * MFL My Watch List — read and incrementally update an owner's watch list.
 *
 * MFL is the source of truth; our Redis mirror (see /api/watch-list) is a
 * read cache so pages feel instant. Everything MFL-facing lives here.
 *
 * What makes this DIFFERENT from `mfl-draft-list.ts`, and why the two are not
 * one module:
 *
 * - **The write is incremental, not an overwrite.** `import?TYPE=myWatchList`
 *   takes `ADD=id,id` and/or `REMOVE=id,id` and touches nothing else, so a
 *   click can go straight through to MFL — there is no board to snapshot and
 *   no "refuse an empty list" rule, because a single REMOVE never erases what
 *   the owner did not ask to remove.
 * - **The list is a SET.** MFL keeps no order for it, so callers must never
 *   read meaning into position; ids are normalized and sorted for stable
 *   comparisons.
 * - **The export shape is unconfirmed live** (docs/features/mfl-api.md). MFL's
 *   other per-owner lists emit `{ <type>: { player: [{id}] } }` with a bare
 *   object for a one-player list, so the reader accepts that, a `players`
 *   wrapper, bare id strings, and a comma-joined string. A shape none of
 *   those cover is reported as a failed read, never as an empty list.
 *
 * What is the SAME, and inherited from the draft list module:
 *
 * - Owner cookie only. No APIKEY, no FRANCHISE_ID, no commissioner path, so
 *   no cron can read or write this — every call carries a live session's
 *   MFL_USER_ID (`user.id` from the JWT).
 * - HTTP 200 means nothing; every body goes through `parseMflError`.
 * - `import` answers in XML and ignores JSON=1; `export` honors it.
 * - TYPE/L in the query string, and writes go to the league's own host.
 */

import { mflFetch } from './mfl-fetch';
import { parseMflError, normalizePlayerIds } from './mfl-draft-list';
import type { LeagueDefinition } from '../config/leagues';

export interface WatchListResult {
  ok: boolean;
  /** MFL player ids, normalized and sorted. Empty array is a legitimate "nothing watched". */
  playerIds: string[];
  error?: string;
}

export interface WatchListWriteResult {
  ok: boolean;
  error?: string;
}

interface WatchListParams {
  league: LeagueDefinition;
  year: number | string;
  /** Raw MFL_USER_ID cookie value — the session JWT's userId. */
  mflUserCookie: string;
}

const READ_HOST = 'https://api.myfantasyleague.com';
const writeHost = (league: LeagueDefinition) => `https://${league.mflHost}`;

/** Normalize, then sort: the list is a set and callers compare it as one. */
export function normalizeWatchIds(ids: unknown[]): string[] {
  return normalizePlayerIds(ids).sort((a, b) => Number(a) - Number(b));
}

/**
 * Pull the ids out of whatever MFL's export hands back.
 *
 * Returns null when the payload has no recognizable list — the caller turns
 * that into a failed read. An owner with an empty list is expected to come
 * back as an empty `player` array/absent key UNDER a `myWatchList` object,
 * which is a recognizable shape and yields `[]`.
 */
export function extractWatchListIds(parsed: unknown): string[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const list = root.myWatchList ?? root.myWatchlist ?? root.watchList;
  if (list === undefined || list === null) return null;
  if (typeof list === 'string') return normalizeWatchIds(list.split(','));
  if (typeof list !== 'object') return null;

  const container = list as Record<string, unknown>;
  const inner = container.players && typeof container.players === 'object'
    ? (container.players as Record<string, unknown>)
    : container;

  let raw = inner.player;
  if (raw === undefined) raw = inner.players;
  if (raw === undefined) {
    // A `myWatchList` object with no player key at all is MFL's "nothing
    // watched yet" (its draft list does the same).
    return [];
  }
  if (typeof raw === 'string') return normalizeWatchIds(raw.split(','));
  const rows = Array.isArray(raw) ? raw : [raw];
  return normalizeWatchIds(
    rows.map((row) => (row && typeof row === 'object' ? (row as { id?: unknown }).id : row)),
  );
}

/** Read the authenticated owner's watch list from MFL. */
export async function pullWatchList(
  { league, year, mflUserCookie }: WatchListParams,
): Promise<WatchListResult> {
  const url = `${READ_HOST}/${year}/export?TYPE=myWatchList&L=${encodeURIComponent(league.id)}&JSON=1`;

  let body: string;
  try {
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    body = await response.text();
  } catch (err) {
    return { ok: false, playerIds: [], error: `Could not reach MFL: ${(err as Error).message}` };
  }

  const error = parseMflError(body);
  if (error) return { ok: false, playerIds: [], error };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, playerIds: [], error: 'Could not read MFL’s watch list response.' };
  }
  const ids = extractWatchListIds(parsed);
  if (ids === null) {
    return { ok: false, playerIds: [], error: 'MFL’s watch list response was not in a shape we recognize.' };
  }
  return { ok: true, playerIds: ids };
}

/**
 * Add and/or remove players on the authenticated owner's MFL watch list.
 *
 * Both lists may be given in one call; either may be empty. A call with
 * nothing to do is a no-op success rather than a request MFL would answer
 * with an error for.
 */
export async function updateWatchList(
  { league, year, mflUserCookie, add = [], remove = [] }:
    WatchListParams & { add?: string[]; remove?: string[] },
): Promise<WatchListWriteResult> {
  const addIds = normalizeWatchIds(add);
  const removeSet = new Set(normalizeWatchIds(remove));
  // An id in both lists is a contradiction; treat the add as the intent.
  for (const id of addIds) removeSet.delete(id);
  const removeIds = [...removeSet];
  if (addIds.length === 0 && removeIds.length === 0) return { ok: true };

  const url = `${writeHost(league)}/${year}/import?TYPE=myWatchList&L=${encodeURIComponent(league.id)}`;
  const parts: string[] = [];
  if (addIds.length) parts.push(`ADD=${encodeURIComponent(addIds.join(','))}`);
  if (removeIds.length) parts.push(`REMOVE=${encodeURIComponent(removeIds.join(','))}`);
  const body = parts.join('&');

  let text: string;
  try {
    const response = await mflFetch({ url, method: 'POST', mflUserCookie, body });
    text = await response.text();
    if (!response.ok) {
      const detail = parseMflError(text);
      return {
        ok: false,
        error: detail
          ? `MFL returned HTTP ${response.status}: ${detail}`
          : `MFL returned HTTP ${response.status}.`,
      };
    }
  } catch (err) {
    return { ok: false, error: `Could not reach MFL: ${(err as Error).message}` };
  }

  const error = parseMflError(text);
  if (error) return { ok: false, error };
  return { ok: true };
}
