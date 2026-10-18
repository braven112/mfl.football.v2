/**
 * Sleeper's public API — the reads MFL Live needs, and nothing else.
 *
 * Sleeper's API is READ-ONLY and needs no token (https://docs.sleeper.com):
 * a username or a league id is enough to read a league, which is why linking a
 * Sleeper account on MFL Live is a username field rather than a sign-in. The
 * one rule Sleeper asks of callers is to stay under ~1,000 requests a minute
 * per IP; every read below is cached by its caller, so a poll costs one
 * `matchups` request per Sleeper league and nothing else.
 *
 * `null` means "could not read it" — a network failure, a non-200, or a body
 * that did not parse — and is never conflated with an empty answer. Sleeper
 * answers an unknown username with a 200 and a literal `null` body, so a
 * missing user is ALSO `null` here; callers that need to tell the two apart
 * (the link form) check `ok` on `fetchSleeperUser`.
 *
 * SERVER-SIDE ONLY.
 */

export const SLEEPER_API = 'https://api.sleeper.app/v1';

/** A Sleeper read has to fit inside a poll; a slow one costs that league, not the board. */
const TIMEOUT_MS = 6000;

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  sport: string;
  total_rosters?: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  /** Every player on the roster (starters, bench, reserve). */
  players?: string[] | null;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string | null; avatar?: string | null } | null;
}

/** One roster's line in a week's matchups. */
export interface SleeperMatchupEntry {
  roster_id: number;
  /** Null for a roster with no head-to-head game this week. */
  matchup_id: number | null;
  points: number | null;
  custom_points?: number | null;
  /** Starter slots, in lineup order. An empty slot is `'0'`. */
  starters: string[] | null;
  starters_points?: number[] | null;
  /** Every rostered player, starters included. */
  players: string[] | null;
  players_points?: Record<string, number> | null;
}

/** The raw player record, trimmed to the fields the id map reads. */
export interface SleeperPlayerRecord {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  team?: string | null;
  active?: boolean;
  espn_id?: number | string | null;
  rotowire_id?: number | string | null;
}

export type SleeperFetch = (url: string) => Promise<unknown>;

/**
 * GET a Sleeper path and parse it. Never throws.
 *
 * Returns `undefined` on a failed read so a literal `null` BODY (Sleeper's
 * answer for an unknown username) stays distinguishable from a failure.
 */
export async function sleeperGet(path: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  try {
    const res = await fetchImpl(`${SLEEPER_API}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[sleeper] ${path}: HTTP ${res.status}`);
      return undefined;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[sleeper] ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** Sleeper usernames are letters, digits and underscores; bounded so a junk value never reaches the URL. */
const USERNAME = /^[A-Za-z0-9_]{1,40}$/;

export function normalizeSleeperUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^@/, '');
  return USERNAME.test(value) ? value.toLowerCase() : null;
}

/**
 * Look a username (or a numeric user id) up.
 *
 * `ok: false` is a failed read; `ok: true, user: null` is "Sleeper has no such
 * user". The link form says different things for the two.
 */
export async function fetchSleeperUser(
  usernameOrId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; user: SleeperUser | null }> {
  const body = await sleeperGet(`/user/${encodeURIComponent(usernameOrId)}`, fetchImpl);
  if (body === undefined) return { ok: false, user: null };
  const u = body as Partial<SleeperUser> | null;
  if (!u || typeof u.user_id !== 'string' || !u.user_id) return { ok: true, user: null };
  return {
    ok: true,
    user: {
      user_id: u.user_id,
      username: String(u.username ?? usernameOrId),
      display_name: String(u.display_name ?? u.username ?? usernameOrId),
      avatar: typeof u.avatar === 'string' && u.avatar ? u.avatar : null,
    },
  };
}

/** Sleeper's avatar CDN. Only ever built from an id Sleeper itself returned. */
export function sleeperAvatarUrl(avatarId: string | null | undefined): string {
  if (!avatarId) return '';
  // A league member's team avatar is a full URL already; a user avatar is an id.
  if (/^https:\/\//.test(avatarId)) return avatarId;
  return /^[A-Za-z0-9_.-]+$/.test(avatarId)
    ? `https://sleepercdn.com/avatars/thumbs/${avatarId}`
    : '';
}
