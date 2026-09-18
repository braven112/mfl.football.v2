/**
 * The Owners' Poll — server-side storage and request context.
 *
 * Key construction, ballot validation and the window shape all live in
 * owners-poll-ballot.mjs, shared verbatim with the close pass. This module is
 * the API's half: resolving who is asking, and talking to Redis.
 *
 * See docs/plans/owners-poll.md.
 */

import { getAuthUser } from './auth';
import { getRedis } from './redis-client';
import { ALL_LEAGUES, getLeagueById, type LeagueDefinition } from '../config/leagues';
import {
  ownersPollStandingKey,
  ownersPollCurrentKey,
  affirmBallotRecord,
  parseStoredBallot,
  parseStoredWindow,
  resolveBallotWindow,
} from './owners-poll-ballot.mjs';
import { getLeagueTeamBrands } from './league-team-brands';

export interface OwnersPollWindow {
  year: number;
  week: number;
  opensAt: string;
  closesAt: string;
  slots: number;
  eligibleFranchiseIds: string[];
}

export interface StoredBallot {
  franchiseId: string;
  ranking: string[];
  /** The owner's FIRST ballot of the season. Never moves after that. */
  submittedAt: string | null;
  /** Last edit — may be many weeks before the snapshot that publishes it. */
  updatedAt: string | null;
  seasonYear: number | null;
}

export interface OwnersPollCaller {
  league: LeagueDefinition;
  /** Nav slug — the KV scope segment. */
  scope: string;
  franchiseId: string;
}

/** Why a caller was refused. Routes map these to status codes and copy. */
export type OwnersPollRefusal =
  | 'unauthenticated'
  | 'no-franchise'
  | 'unknown-league'
  | 'league-mismatch'
  | 'poll-disabled';

/**
 * Resolve the authenticated caller, or the reason to refuse them.
 *
 * Every rule here has already been a bug somewhere in this repo:
 *
 * - Identity comes from the signed session cookie via `getAuthUser` and
 *   nothing else. The old unsigned `X-User-Context` / `X-Auth-User` header
 *   fallbacks allowed full auth bypass and were removed in June 2026.
 * - A session with no franchise is refused rather than allowed to address a
 *   shared key — the same reason kv-franchise-store.ts rejects it.
 * - A session whose leagueId we can't resolve is refused rather than defaulted.
 *   Franchise ids collide across leagues, so falling back to a default league
 *   is a data-exposure path, not a harmless convenience.
 * - `?league=` is a CHECK against the session, never an input to it. An owner
 *   logged into one league can browse another league's pages; without this
 *   check, a ballot cast there would land in their own league's bucket.
 */
export function resolveOwnersPollCaller(
  request: Request,
): { ok: true; caller: OwnersPollCaller } | { ok: false; reason: OwnersPollRefusal } {
  const user = getAuthUser(request);
  if (!user) return { ok: false, reason: 'unauthenticated' };
  if (!user.franchiseId) return { ok: false, reason: 'no-franchise' };

  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return { ok: false, reason: 'unknown-league' };

  const requested = new URL(request.url).searchParams.get('league');
  if (requested && requested !== league.navSlug && requested !== league.slug) {
    return { ok: false, reason: 'league-mismatch' };
  }

  if (!league.ownersPoll?.enabled) return { ok: false, reason: 'poll-disabled' };

  return {
    ok: true,
    caller: { league, scope: league.navSlug, franchiseId: user.franchiseId },
  };
}

/**
 * Resolve the league a PUBLIC (unauthenticated) caller is asking about.
 *
 * Only the turnout endpoint uses this, and it returns nothing but counts.
 * Unlike the authenticated path there is no session to check the slug
 * against, so here the slug IS the input — which is safe precisely because
 * the response carries no per-owner data. Do not reuse this for anything
 * that returns a ballot.
 */
export function resolvePublicLeague(request: Request): LeagueDefinition | null {
  const slug = new URL(request.url).searchParams.get('league');
  if (!slug) return null;
  const league =
    ALL_LEAGUES.find((l) => l.navSlug === slug || l.slug === slug) ?? null;
  if (!league?.ownersPoll?.enabled) return null;
  return league;
}

/**
 * The league's franchises, for validating ballots and sizing the field.
 *
 * Read through the brand accessor rather than a static config import, so the
 * league stays a runtime value — a static import specifier cannot be one, which
 * is why the ballot PAGE takes its issue data from its route instead.
 */
export function eligibleFranchiseIdsFor(league: LeagueDefinition): string[] {
  return Object.keys(getLeagueTeamBrands(league.slug));
}

/**
 * Open (or replace) a league's ballot window.
 *
 * The commissioner path. The Tuesday cron does the same write from node via
 * scripts/lib/owners-poll-redis.mjs — the two share the KEY and the record
 * shape (owners-poll-ballot.mjs) but not the client, because a script cannot
 * import TypeScript.
 *
 * Ballots are NOT touched. Re-opening the same week picks up every vote
 * already cast, which is what makes this safe to run to recover from a failed
 * cron.
 */
export async function writeOwnersPollWindow(
  scope: string,
  window: OwnersPollWindow,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    // Expire a week after the close, so a pointer can never outlive its ballot
    // if the close pass never runs. An expired pointer reads as "no ballot
    // open", which is the safe state; a stale one would keep taking votes into
    // a week that has already published.
    const ttl = Math.max(
      3600,
      Math.ceil((Date.parse(window.closesAt) - Date.now()) / 1000) + 7 * 86400,
    );
    await redis.set(ownersPollCurrentKey(scope), JSON.stringify(window), { ex: ttl });
    return true;
  } catch (err) {
    console.error('[owners-poll] failed to open window:', err);
    return false;
  }
}

/**
 * Stop a ballot accepting votes.
 *
 * Removes the pointer ONLY. It never tallies and never deletes ballots, so an
 * accidental call cannot publish a consensus or destroy votes — the tally is
 * generate-pecking-order.mjs --close-poll, deliberately a separate action.
 */
export async function clearOwnersPollWindow(scope: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.del(ownersPollCurrentKey(scope));
    return true;
  } catch (err) {
    console.error('[owners-poll] failed to close window:', err);
    return false;
  }
}

/** Read the currently-open window for a league, or null if none is open. */
export async function readOwnersPollWindow(scope: string): Promise<OwnersPollWindow | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(ownersPollCurrentKey(scope));
    return parseStoredWindow(raw) as OwnersPollWindow | null;
  } catch (err) {
    console.error('[owners-poll] failed to read window:', err);
    return null;
  }
}

/** 'pending' | 'open' | 'closed' for a window at a given instant. */
export function windowState(
  window: OwnersPollWindow | null,
  now: Date = new Date(),
): 'none' | 'pending' | 'open' | 'closed' {
  if (!window) return 'none';
  return resolveBallotWindow(now, window) as 'pending' | 'open' | 'closed';
}

/** Read one franchise's ballot for a week. Null when they haven't voted. */
export async function readBallot(
  scope: string,
  window: OwnersPollWindow,
  franchiseId: string,
): Promise<StoredBallot | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.hget(ownersPollStandingKey(scope, window.year), franchiseId);
    return parseStoredBallot(raw, {
      slots: window.slots,
      eligibleFranchiseIds: window.eligibleFranchiseIds,
      seasonYear: window.year,
    }) as StoredBallot | null;
  } catch (err) {
    console.error('[owners-poll] failed to read ballot:', err);
    return null;
  }
}

/**
 * Re-affirm the caller's standing ballot without changing it — "Still good".
 *
 * Read-modify-write, deliberately: the ranking comes from the STORED record,
 * never from the request. An owner who edited their ballot on a phone and then
 * pressed the button on a stale desktop tab would otherwise write the older
 * ranking back over the newer one. The client sends no ranking at all, so that
 * race cannot be expressed.
 *
 * This replaced `readPreviousBallot`, which prefilled a new week's ballot from
 * the previous week's. Under standing votes there is nothing to prefill FROM —
 * your ballot simply is your ballot — so the prefill machinery went with it.
 *
 * Returns the bumped record, or null when there is nothing on file.
 */
export async function affirmBallot(
  scope: string,
  window: OwnersPollWindow,
  franchiseId: string,
  now: Date = new Date(),
): Promise<StoredBallot | null> {
  const current = await readBallot(scope, window, franchiseId);
  if (!current) return null;
  const bumped = affirmBallotRecord(current, now) as StoredBallot | null;
  if (!bumped) return null;
  const ok = await writeBallot(scope, window, bumped);
  return ok ? bumped : null;
}

/**
 * Upsert one franchise's ballot.
 *
 * HSET on a per-franchise field, so two owners submitting simultaneously
 * cannot clobber each other — which a read-modify-write on a single JSON blob
 * for the whole week absolutely would.
 */
export async function writeBallot(
  scope: string,
  window: OwnersPollWindow,
  record: StoredBallot,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.hset(ownersPollStandingKey(scope, window.year), {
      [record.franchiseId]: JSON.stringify(record),
    });
    return true;
  } catch (err) {
    console.error('[owners-poll] failed to write ballot:', err);
    return false;
  }
}

/**
 * How many ballots are in.
 *
 * HLEN, not HGETALL: the turnout meter is public, and it must never be
 * possible to read anyone's ballot — or infer who has voted — from the
 * endpoint that powers it.
 */
export async function countBallots(scope: string, window: OwnersPollWindow): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  try {
    return await redis.hlen(ownersPollStandingKey(scope, window.year));
  } catch (err) {
    console.error('[owners-poll] failed to count ballots:', err);
    return 0;
  }
}
