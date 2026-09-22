/**
 * The Owners' Poll — node-side Redis access.
 *
 * The app's half of this lives in src/utils/owners-poll-store.ts; the two
 * share the KEY SHAPE (src/utils/owners-poll-ballot.mjs) but not the client,
 * because scripts cannot import TypeScript and the app cannot use the raw REST
 * helper. Sharing the keys is what matters — a second key format would mean
 * the close pass reads a different hash than the API wrote.
 */

import { getRedisConfig, redisCommand } from './redis.mjs';
import {
  ownersPollBallotsKey,
  ownersPollStandingKey,
  ownersPollCurrentKey,
  parseStoredBallot,
  parseStoredWindow,
} from '../../src/utils/owners-poll-ballot.mjs';

/**
 * Resolve credentials, or null.
 *
 * Returns null rather than throwing so a caller can decide: the Tuesday pass
 * treats "no Redis" as "publish the column without a poll section", which is
 * strictly better than failing the column over a feature that is additive to
 * it. The close pass treats it as fatal, because tallying nothing and writing
 * an empty consensus would erase real ballots.
 */
export function ownersPollRedis() {
  return getRedisConfig();
}

/** Write the open-window pointer. */
export async function writeWindow(redis, navSlug, window) {
  await redisCommand(redis, [
    'SET',
    ownersPollCurrentKey(navSlug),
    JSON.stringify(window),
    // Expire a week after the close so a pointer can never outlive its ballot
    // if the close pass fails to run. An expired pointer reads as "no ballot
    // open", which is the safe state; a stale one would keep accepting votes
    // into a week that has already been published.
    'EX',
    String(Math.max(3600, Math.ceil((Date.parse(window.closesAt) - Date.now()) / 1000) + 7 * 86400)),
  ]);
}

/** Read the open-window pointer, or null. */
export async function readWindow(redis, navSlug) {
  const raw = await redisCommand(redis, ['GET', ownersPollCurrentKey(navSlug)]);
  return parseStoredWindow(raw);
}

/** Remove the pointer — the ballot is done and must stop accepting writes. */
export async function clearWindow(redis, navSlug) {
  await redisCommand(redis, ['DEL', ownersPollCurrentKey(navSlug)]);
}

/** How many ballots are in. HLEN, so no ballot content is transferred. */
export async function countStandingBallots(redis, navSlug, seasonYear) {
  // Coerced, like the week-scoped twin below: Upstash answers HLEN with a
  // string over REST, and handing a caller "0" — which is truthy — instead of
  // 0 is how a "nobody has voted" check silently inverts.
  const n = await redisCommand(redis, ['HLEN', ownersPollStandingKey(navSlug, seasonYear)]);
  return Number(n) || 0;
}

/**
 * Every standing ballot a league has on file this season.
 *
 * One HGETALL. Nothing is cleared afterwards — that is the whole point of a
 * standing vote, and it is the single most important difference from the
 * week-scoped read this replaced.
 */
export async function readStandingBallots(redis, navSlug, seasonYear, opts) {
  return readAllBallots(redis, navSlug, ownersPollStandingKey(navSlug, seasonYear), {
    ...opts,
    seasonYear,
  });
}

/** Upsert one franchise's standing ballot. Atomic per field. */
export async function writeStandingBallot(redis, navSlug, seasonYear, record) {
  await redisCommand(redis, [
    'HSET',
    ownersPollStandingKey(navSlug, seasonYear),
    record.franchiseId,
    JSON.stringify(record),
  ]);
}

/** LEGACY week-scoped count — used only by the adopt one-shot. */
export async function countBallots(redis, navSlug, year, week) {
  const n = await redisCommand(redis, ['HLEN', ownersPollBallotsKey(navSlug, year, week)]);
  return Number(n) || 0;
}

/**
 * Lift a week's LEGACY ballots into the standing hash — the cut-over, done by
 * the passes themselves rather than by hand.
 *
 * Standing votes shipped mid-week (2026-09-22, 16:40 PT). The Tuesday open pass
 * ran on the old code and opened that week's week-scoped hash, and owners voted
 * into it until the promotion; the new code only ever reads the standing hash.
 * `scripts/owners-poll-adopt-standing.mjs` is the one-shot for exactly this,
 * but it needs Upstash credentials on someone's machine and it has to run
 * before Thursday's close — a manual step on a deadline is a step that gets
 * missed. The close and turnout passes already run with the credentials, so
 * they call this first.
 *
 * Merge rule, per franchise: the legacy ballot is written only when the owner
 * has NO standing ballot, or the legacy one is strictly newer (`updatedAt`).
 * Never the other way round: an owner who re-voted after the promotion has a
 * newer standing ballot, and that is their current opinion. Idempotent — a
 * second run finds every legacy ballot already present or older, and writes
 * nothing — so it is safe to leave in the passes until the legacy hashes stop
 * existing.
 *
 * @returns {Promise<number>} how many ballots were written
 */
export async function adoptLegacyWeekBallots(redis, navSlug, seasonYear, week, { slots, eligibleFranchiseIds }) {
  const legacy = await readAllBallots(redis, navSlug, ownersPollBallotsKey(navSlug, seasonYear, week), {
    slots,
    eligibleFranchiseIds,
  });
  if (legacy.ballots.length === 0) return 0;
  const { ballots: standing } = await readStandingBallots(redis, navSlug, seasonYear, {
    slots,
    eligibleFranchiseIds,
  });
  const byFid = new Map(standing.map((b) => [b.franchiseId, b]));
  let adopted = 0;
  for (const ballot of legacy.ballots) {
    const current = byFid.get(ballot.franchiseId);
    if (current && !(Date.parse(ballot.updatedAt ?? '') > Date.parse(current.updatedAt ?? ''))) {
      continue;
    }
    // Stamped on the way across, as the one-shot does: a ballot adopted INTO
    // this season is, by construction, this season's.
    await writeStandingBallot(redis, navSlug, seasonYear, { ...ballot, seasonYear });
    adopted += 1;
  }
  return adopted;
}

/**
 * Every ballot for a week, validated.
 *
 * Anything that no longer validates is DROPPED, not repaired — see
 * parseStoredBallot. The count of dropped ballots is returned so the close
 * pass can say so out loud rather than quietly publishing a smaller poll than
 * the turnout meter promised.
 */
export async function readAllBallots(redis, navSlug, key, { slots, eligibleFranchiseIds, seasonYear = null }) {
  const raw = await redisCommand(redis, ['HGETALL', key]);

  // Upstash returns a flat [field, value, field, value, …] array for HGETALL.
  const entries = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i += 2) entries.push([raw[i], raw[i + 1]]);
  } else if (raw && typeof raw === 'object') {
    entries.push(...Object.entries(raw));
  }

  const ballots = [];
  let dropped = 0;
  for (const [field, value] of entries) {
    const parsed = parseStoredBallot(value, { slots, eligibleFranchiseIds, seasonYear });
    if (!parsed) {
      dropped += 1;
      continue;
    }
    // The hash field is the authoritative franchise: a record whose body
    // disagrees with the key it is stored under is not trustworthy either way.
    if (parsed.franchiseId !== field) {
      dropped += 1;
      continue;
    }
    ballots.push(parsed);
  }

  // Deterministic order so a tie in the tally never depends on Redis.
  ballots.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));
  return { ballots, dropped, stored: entries.length };
}
