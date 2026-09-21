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
  ownersPollPauseKey,
  affirmBallotRecord,
  parseStoredBallot,
} from './owners-poll-ballot.mjs';
import { getLeagueTeamBrands } from './league-team-brands';
import { getCurrentWeekForYear } from './current-week';
import { getCurrentSeasonYear } from './league-year';
import { resolveOwnersPollCycle } from './owners-poll-window.mjs';

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
 * The league's CURRENT voting cycle — the always-open path.
 *
 * Derived, never read from storage. Voting never stops, so there is always an
 * answer: the pending announce instant, the league's field, and its ballot
 * depth. The old `readOwnersPollWindow` pointer survives for exactly one
 * purpose now — a commissioner PAUSE — and this returns null only when one is
 * in force.
 *
 * The year is the SEASON year, matching the standing hash: the poll ranks how
 * teams are playing, so it rolls at Labor Day with the standings rather than
 * on MFL's February league rollover. `week` is informational — it labels the
 * ballot in the UI and no longer selects any key.
 */
export function resolvePollCycle(
  league: LeagueDefinition,
  now: Date = new Date(),
): OwnersPollWindow | null {
  const poll = league.ownersPoll;
  if (!poll?.enabled) return null;

  const seasonYear = getCurrentSeasonYear(now);
  const eligibleFranchiseIds = eligibleFranchiseIdsFor(league);
  // A field no larger than the ballot cannot produce a ranking — the same
  // refusal the open pass makes, applied where the API can see it too.
  //
  // Said out loud, because every caller renders a null cycle as "voting is
  // paused". A misconfiguration and a deliberate pause are different facts and
  // must not merge into one silent state; the log line is what tells them
  // apart when someone asks why the ballot says paused with nothing paused.
  if (eligibleFranchiseIds.length <= poll.slots) {
    console.error(
      `[owners-poll] ${league.name} has ${eligibleFranchiseIds.length} franchises but a ballot ` +
        `depth of ${poll.slots} — no cycle can be derived.`,
    );
    return null;
  }

  const cycle = resolveOwnersPollCycle({
    now,
    closeHourPT: poll.closeHourPT,
    closeWeekday: poll.closeWeekday,
  });

  return {
    year: seasonYear,
    week: getCurrentWeekForYear(seasonYear),
    // NOTE getCurrentWeekForYear reads the system clock rather than `now`, so
    // a ?testDate render labels the ballot with today's week. Informational
    // only — `week` selects no key under standing votes.
    opensAt: cycle.opensAt,
    closesAt: cycle.closesAt,
    slots: poll.slots,
    eligibleFranchiseIds,
  };
}

/** Is the poll suspended by the commissioner? Absent key = open. */
export async function isPollPaused(scope: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    return Boolean(await redis.get(ownersPollPauseKey(scope)));
  } catch (err) {
    // Fails OPEN, on purpose. A storage blip must not silently stop the league
    // voting; the worst case is that a deliberate pause lapses, which someone
    // will notice, rather than the poll disappearing, which nobody would.
    console.error('[owners-poll] failed to read pause flag:', err);
    return false;
  }
}

/** Suspend or resume voting. `hours` expires the pause automatically. */
export async function setPollPaused(
  scope: string,
  paused: boolean,
  hours?: number,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    if (!paused) {
      await redis.del(ownersPollPauseKey(scope));
      return true;
    }
    const ttl = Number.isFinite(hours) && (hours as number) > 0
      ? Math.ceil((hours as number) * 3600)
      : undefined;
    await redis.set(
      ownersPollPauseKey(scope),
      new Date().toISOString(),
      ttl ? { ex: ttl } : undefined,
    );
    return true;
  } catch (err) {
    console.error('[owners-poll] failed to set pause flag:', err);
    return false;
  }
}

/**
 * The window a request should act on: the derived cycle, unless paused.
 *
 * Every route goes through this rather than reading storage for a window, so
 * "is voting open?" has exactly one answer and one implementation.
 */
export async function activePollWindow(
  league: LeagueDefinition,
  scope: string,
  now: Date = new Date(),
): Promise<OwnersPollWindow | null> {
  if (await isPollPaused(scope)) return null;
  return resolvePollCycle(league, now);
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
