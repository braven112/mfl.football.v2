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
export async function countBallots(redis, navSlug, year, week) {
  const n = await redisCommand(redis, ['HLEN', ownersPollBallotsKey(navSlug, year, week)]);
  return Number(n) || 0;
}

/**
 * Every ballot for a week, validated.
 *
 * Anything that no longer validates is DROPPED, not repaired — see
 * parseStoredBallot. The count of dropped ballots is returned so the close
 * pass can say so out loud rather than quietly publishing a smaller poll than
 * the turnout meter promised.
 */
export async function readAllBallots(redis, navSlug, year, week, { slots, eligibleFranchiseIds }) {
  const raw = await redisCommand(redis, ['HGETALL', ownersPollBallotsKey(navSlug, year, week)]);

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
    const parsed = parseStoredBallot(value, { slots, eligibleFranchiseIds });
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
