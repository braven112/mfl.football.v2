/**
 * Every league the signed-in MFL account belongs to — `export?TYPE=myleagues`.
 *
 * The login flow (`mfl-login.ts`) already makes this call and keeps only the
 * league it was asked for. The Sunday Ticket board wants the whole list: it
 * is how an owner signed into TheLeague sees their AFL team (and any league
 * outside this site) without a second login, because `user.id` in the session
 * IS the MFL cookie for the same person.
 *
 * Two things this call means that its shape does not say:
 *
 *  - **An empty list is a DEAD COOKIE, not "no leagues."** MFL answers an
 *    expired or invalid MFL_USER_ID with a well-formed `{"leagues":{}}`, HTTP
 *    200. `api/autocut-list.ts` has used exactly that as its step-up liveness
 *    check since it shipped; `isMflCookieLive` below is that check, lifted.
 *  - **The wrapper key varies by host/year** — `myleagues.league` on some,
 *    `leagues.league` on others (docs/claude/insights/domains/mfl-api.md) —
 *    and a one-league account gets a bare object, not a one-element array.
 *
 * Results are cached in Redis for an hour under a HASH of the cookie: the
 * cookie is a credential and must never be a key in the clear. Only a
 * non-empty answer is cached — a dead cookie is cheap to re-check and must
 * not be remembered past a re-login.
 */

import { createHash } from 'node:crypto';
import { mflFetch } from './mfl-fetch';
import { getRedis } from './redis-client';

export interface MyLeague {
  /** MFL league id, e.g. '13522'. */
  id: string;
  name: string;
  /** 4-digit, zero-padded. */
  franchiseId: string;
  franchiseName: string;
  /** `https://www49.myfantasyleague.com` — where this league's exports live; null when MFL gave no url. */
  host: string | null;
}

export type MyLeaguesFailure = 'dead-cookie' | 'fetch-failed' | 'unparseable';

export interface MyLeaguesResult {
  ok: boolean;
  leagues: MyLeague[];
  reason?: MyLeaguesFailure;
  fromCache?: boolean;
}

const CACHE_TTL_SECONDS = 60 * 60;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function normalizeFranchise(value: unknown): string {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
}

/**
 * The league's MFL host, and ONLY an MFL host. The origin is later used to
 * send the owner's MFL_USER_ID cookie (`loadOutsideContribution`), so a
 * payload naming anything else — however it got there — must not become a
 * destination for that credential. HTTPS `*.myfantasyleague.com` or nothing.
 */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'myfantasyleague.com' && !u.hostname.endsWith('.myfantasyleague.com')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Parse a `myleagues` payload. `null` means the payload is not a myleagues
 * response at all (HTML, an error object); `[]` means MFL answered and listed
 * nothing — which, for this export, means the cookie is dead.
 */
export function parseMyLeagues(payload: unknown): MyLeague[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as any;
  // Per PATH, not per wrapper: a host that answers `{"myleagues":{},"leagues":{"league":[…]}}`
  // (the inconsistency mfl-api.md records) must still resolve to the list.
  const rows = p.myleagues?.league ?? p.leagues?.league;
  if (rows === undefined && !(p.myleagues && typeof p.myleagues === 'object') && !(p.leagues && typeof p.leagues === 'object')) return null;

  const leagues: MyLeague[] = [];
  for (const l of asArray<any>(rows)) {
    const id = `${l?.id ?? l?.league_id ?? l?.leagueId ?? l?.league ?? ''}`.trim();
    if (!id) continue;
    leagues.push({
      id,
      name: `${l?.name ?? ''}`.trim(),
      franchiseId: normalizeFranchise(l?.franchise_id ?? l?.franchiseId ?? l?.team_id ?? l?.teamId),
      franchiseName: `${l?.franchise_name ?? l?.franchiseName ?? ''}`.trim(),
      host: hostOf(l?.url),
    });
  }
  return leagues;
}

function cacheKey(mflUserCookie: string, year: number): string {
  const hash = createHash('sha256').update(mflUserCookie).digest('hex').slice(0, 32);
  return `st:myleagues:${year}:${hash}`;
}

/**
 * The account's leagues for `year`, from cache when fresh.
 *
 * `year` is the MFL league year to list: a league that has not been created
 * for the new year yet is simply absent from that year's answer (the AFL
 * login page documents the same trap for its June rollover).
 */
export async function fetchMyLeagues(
  mflUserCookie: string,
  year: number,
  opts: { skipCache?: boolean } = {},
): Promise<MyLeaguesResult> {
  if (!mflUserCookie) return { ok: false, leagues: [], reason: 'dead-cookie' };

  const redis = opts.skipCache ? null : await getRedis().catch(() => null);
  const key = cacheKey(mflUserCookie, year);

  if (redis) {
    try {
      const cached = await redis.get<MyLeague[]>(key);
      if (Array.isArray(cached) && cached.length > 0) {
        return { ok: true, leagues: cached, fromCache: true };
      }
    } catch (error) {
      console.warn('[my-leagues] cache read failed:', error);
    }
  }

  let payload: unknown;
  try {
    const response = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`,
      method: 'GET',
      mflUserCookie,
    });
    if (!response.ok) return { ok: false, leagues: [], reason: 'fetch-failed' };
    payload = await response.json().catch(() => null);
  } catch {
    return { ok: false, leagues: [], reason: 'fetch-failed' };
  }

  const leagues = parseMyLeagues(payload);
  if (leagues === null) return { ok: false, leagues: [], reason: 'unparseable' };
  // A row we could not id is still a row: the cookie is live even if the list is unusable.
  const rawRows = asArray<any>((payload as any)?.myleagues?.league ?? (payload as any)?.leagues?.league).length;
  if (leagues.length === 0 && rawRows === 0) return { ok: false, leagues: [], reason: 'dead-cookie' };

  if (redis) {
    try {
      await redis.set(key, leagues, { ex: CACHE_TTL_SECONDS });
    } catch (error) {
      console.warn('[my-leagues] cache write failed:', error);
    }
  }
  return { ok: true, leagues };
}

/**
 * Is this MFL_USER_ID cookie live RIGHT NOW? Never served from cache — the
 * callers are step-up checks before a write, and a cached "yes" is the one
 * answer they must not get.
 */
export async function isMflCookieLive(mflUserCookie: string, year: number): Promise<boolean> {
  const result = await fetchMyLeagues(mflUserCookie, year, { skipCache: true });
  return result.ok;
}
