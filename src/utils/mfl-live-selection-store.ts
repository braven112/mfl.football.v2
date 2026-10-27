/**
 * MFL Live's league selection, kept per ACCOUNT on the server.
 *
 * The web board kept the choice in a cookie (`live_leagues`), which was fine
 * while a browser was the only screen. The phone app signs in with a Bearer
 * header and has no cookie jar, so it could never see what the owner picked on
 * `/live/settings`, and a choice made on the phone could never reach the web.
 * One stored answer per owner fixes both.
 *
 * KEYED BY THE MFL LIVE VIEWER (`sleeperViewerKey`: the hashed, lower-cased
 * MFL username), the same key the Sleeper link and the TV settings use. Never
 * by league or franchise: the selection is a fact about the owner across every
 * league they play in, and BOTH registry leagues have a franchise 0001 (the
 * `rankings-scope` lesson), so a franchise key would be shared by two people.
 * Never by `user.id` either: that is the owner's MFL cookie, a credential.
 *
 * The cookie stays as the MIGRATION FALLBACK. With nothing stored for the
 * account, the cookie answers, and is copied up once (`nx`) so the next
 * screen to ask, the phone included, sees the same choice. Once the account
 * has a value it wins over any cookie, because a cookie on a second laptop is
 * an older answer, not a second owner.
 *
 * Redis down → the cookie, exactly as before this file existed. A failed save
 * still writes the cookie on the web, so a toggle is never silently lost
 * there; the app is told the save failed.
 */

import type { AuthUser } from './auth';
import { getRedis } from './redis-client';
import { sleeperViewerKey } from './sleeper/link';
import type { BoardLeague } from './sunday-ticket-selection';
import { rememberMflLiveChoice, type CookieJar } from './mfl-live-selection';

/** Longer than the cookie's one season: refreshed on every save. */
const TTL_S = 400 * 24 * 60 * 60;

/**
 * A selection is a short list of league ids, or the literal "default".
 *
 * Validated for SHAPE only. It is never checked against the owner's real
 * leagues here and does not need to be: it is only ever read back through
 * `resolveMflLiveLeagues`, which intersects it with the leagues this owner's
 * own MFL cookie returns. A junk value can only cost its sender their own
 * selection; it can never widen what they see. The bound keeps a large string
 * out of the cookie and the store alike.
 */
const MAX_LEAGUES = 40;
const ID = /^[A-Za-z0-9_-]{1,24}$/;

export function normalizeMflLiveSelection(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value === 'default' || value === 'all') return 'default';
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_LEAGUES) return null;
  if (!ids.every((id) => ID.test(id))) return null;
  return [...new Set(ids)].join(',');
}

export function mflLiveSelectionKey(user: Pick<AuthUser, 'name'>): string | null {
  const viewer = sleeperViewerKey(user);
  return viewer ? `live:leagues:${viewer}` : null;
}

/**
 * Stored as an object, never a bare string: Upstash JSON-parses what it reads,
 * so a selection of one numeric league id would come back as a NUMBER.
 */
interface StoredSelection {
  leagues: string;
  savedAt: string;
}

async function readStored(key: string): Promise<string | null> {
  const redis = await getRedis().catch(() => null);
  const stored = await redis?.get<StoredSelection>(key).catch(() => null);
  return stored && typeof stored.leagues === 'string' ? normalizeMflLiveSelection(stored.leagues) : null;
}

/**
 * The selection to hand `resolveMflLiveLeagues` as its stored value: the
 * account's, else the cookie's, else null ("the default").
 *
 * This is the ONE read every MFL Live surface makes, web and app alike. Pass
 * whatever cookie the request carried (null for the app). Never throws.
 */
export async function readMflLiveSelection(
  user: Pick<AuthUser, 'name'> | null | undefined,
  cookie: string | null | undefined,
): Promise<string | null> {
  const key = user ? mflLiveSelectionKey(user) : null;
  if (!key) return cookie ?? null;

  const stored = await readStored(key);
  if (stored) return stored;

  // Migration: a web owner who chose before this store existed. Copy the
  // cookie up once so the phone sees it too; `nx` so a racing save from
  // another screen is never overwritten by an older cookie.
  const fromCookie = normalizeMflLiveSelection(cookie);
  if (cookie && fromCookie) {
    const redis = await getRedis().catch(() => null);
    await redis
      ?.set(key, { leagues: fromCookie, savedAt: new Date().toISOString() } satisfies StoredSelection, {
        nx: true,
      })
      .catch(() => null);
  }
  return cookie ?? null;
}

/** Save the account's selection. False when it could not be stored. */
export async function saveMflLiveSelection(
  user: Pick<AuthUser, 'name'>,
  selection: string,
): Promise<boolean> {
  const key = mflLiveSelectionKey(user);
  const leagues = normalizeMflLiveSelection(selection);
  const redis = await getRedis().catch(() => null);
  if (!key || !leagues || !redis) return false;
  try {
    await redis.set(key, { leagues, savedAt: new Date().toISOString() } satisfies StoredSelection, { ex: TTL_S });
    return true;
  } catch {
    return false;
  }
}

// ── The app's view of the selection ──────────────────────────────────────

/** One switch, as `/api/live-leagues` returns it. */
export interface MflLiveLeagueChoice {
  id: string;
  name: string;
  franchiseName: string;
  enabled: boolean;
  locked: boolean;
}

/**
 * The switches for the MFL leagues in `available`, given the resolved
 * selection over EVERY league (Sleeper included). Sleeper leagues are left
 * out of the list but still count: with one on, no MFL league is the last.
 */
export function mflLiveLeagueChoices(
  available: readonly Pick<BoardLeague, 'id' | 'name' | 'franchiseName' | 'provider'>[],
  enabled: readonly string[],
): MflLiveLeagueChoice[] {
  return available
    .filter((l) => l.provider !== 'sleeper')
    .map((l) => {
      const on = enabled.includes(l.id);
      return {
        id: l.id,
        name: l.name,
        franchiseName: l.franchiseName ?? '',
        enabled: on,
        locked: on && enabled.length <= 1,
      };
    });
}

/**
 * `rememberMflLiveChoice` for a signed-in owner: a `?leagues=` link writes the
 * cookie AND the account, or the account's older answer would win on the very
 * next page. Route frontmatter only, like the cookie write it wraps.
 */
export async function rememberMflLiveChoiceForAccount(
  url: URL,
  cookies: CookieJar,
  user: Pick<AuthUser, 'name'>,
): Promise<void> {
  const leagues = url.searchParams.get('leagues');
  if (leagues === null) return;
  rememberMflLiveChoice(url, cookies);
  await saveMflLiveSelection(user, leagues.trim() || 'default');
}
