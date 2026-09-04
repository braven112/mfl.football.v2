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
  ownersPollBallotsKey,
  ownersPollCurrentKey,
  parseStoredBallot,
  parseStoredWindow,
  resolveBallotWindow,
} from './owners-poll-ballot.mjs';

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
  submittedAt: string | null;
  updatedAt: string | null;
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
    const raw = await redis.hget(ownersPollBallotsKey(scope, window.year, window.week), franchiseId);
    return parseStoredBallot(raw, {
      slots: window.slots,
      eligibleFranchiseIds: window.eligibleFranchiseIds,
    }) as StoredBallot | null;
  } catch (err) {
    console.error('[owners-poll] failed to read ballot:', err);
    return null;
  }
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
    await redis.hset(ownersPollBallotsKey(scope, window.year, window.week), {
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
    return await redis.hlen(ownersPollBallotsKey(scope, window.year, window.week));
  } catch (err) {
    console.error('[owners-poll] failed to count ballots:', err);
    return 0;
  }
}
