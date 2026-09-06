/**
 * The one door every AUTOMATED GroupMe post goes through.
 *
 * Enforces the league-wide cap described in groupme-day-plan.mjs: one
 * automated post per Pacific day, on a weekday calendar owners can learn.
 *
 * Why a wrapper rather than a check inside postToGroupMe: exemption has to be
 * visible at the CALL SITE. A sender that bypasses the cap should say so in
 * the line that sends, not inherit it from a flag three files away — and the
 * guard test can then read the call sites and prove the list is what we think
 * it is.
 *
 * Refusing is never silent. A cron that posts nothing and logs nothing is
 * indistinguishable from one that is broken, and this cap will otherwise take
 * the blame for every message anybody thinks went missing.
 */

import { postToGroupMe } from './groupme.mjs';
import { getRedisConfig, redisCommand } from './redis.mjs';
import {
  bypassesDayCap,
  dayClaimKey,
  describeRefusal,
  isPlannedToday,
  ptDay,
  PUSH_ONLY_KINDS,
} from './groupme-day-plan.mjs';

/**
 * Try to claim today's single post for `kind`.
 *
 * SET NX, so two crons racing at the same minute cannot both win. Returns the
 * claim holder when the claim was refused.
 *
 * Fails OPEN when Redis is unavailable: a storage outage must not silence a
 * league's chat for a day. The calendar still applies — an unplanned kind is
 * refused before we ever get here — so failing open at worst allows a second
 * post of a kind that was already scheduled for today.
 */
export async function claimDay({ navSlug, kind, now = new Date(), log = console }) {
  const redis = getRedisConfig();
  if (!redis) {
    log.warn?.(`  [groupme] No Redis — cannot claim the day, allowing ${kind}.`);
    return { claimed: true, degraded: true };
  }

  const key = dayClaimKey(navSlug, now);
  try {
    // Expire a little over a day: the key only has to outlive its own Pacific
    // day, and a TTL means a failed cleanup can never wedge the chat shut.
    const res = await redisCommand(redis, ['SET', key, kind, 'NX', 'EX', String(36 * 3600)]);
    if (res === 'OK' || res === true) return { claimed: true };
    const holder = await redisCommand(redis, ['GET', key]);
    // Re-entrant on purpose: the same kind re-running (a retried job) is not a
    // second post, and refusing it would make a retry look like a cap failure.
    if (holder === kind) return { claimed: true, reclaimed: true };
    return { claimed: false, claimedBy: holder ?? 'another post' };
  } catch (err) {
    log.warn?.(`  [groupme] Day claim failed (${err.message}) — allowing ${kind}.`);
    return { claimed: true, degraded: true };
  }
}

/**
 * Post to GroupMe, subject to the league-wide daily cap.
 *
 * @param {object} args
 * @param {object} args.league Registry entry (for its navSlug).
 * @param {string} args.kind   What this post IS — see groupme-day-plan.mjs.
 * @param {string} args.botId
 * @param {string} args.text
 * @returns {{ posted: boolean, refused?: string }}
 */
export async function postToGroupMeCapped({
  league,
  kind,
  botId,
  text,
  attachments = null,
  dryRun = false,
  now = new Date(),
  log = console,
  ...handlers
}) {
  if (!kind) throw new TypeError('postToGroupMeCapped: a `kind` is required.');
  // Loud, not lenient. Falling back to a registry entry's canonical `slug`
  // ('afl-fantasy') where the nav slug ('afl') was meant would key the day
  // differently per caller and quietly hand one league two slots.
  if (!league?.navSlug) {
    throw new TypeError('postToGroupMeCapped: league.navSlug is required to scope the daily cap.');
  }

  if (!bypassesDayCap(kind)) {
    if (PUSH_ONLY_KINDS.has(kind) || !isPlannedToday(kind, now)) {
      const why = describeRefusal(kind, null, now);
      log.log?.(`  [groupme] Held: ${why}`);
      return { posted: false, refused: why };
    }
    const claim = await claimDay({ navSlug: league.navSlug, kind, now, log });
    if (!claim.claimed) {
      const why = describeRefusal(kind, claim.claimedBy, now);
      log.log?.(`  [groupme] Held: ${why}`);
      return { posted: false, refused: why };
    }
  }

  const result = await postToGroupMe({ botId, text, attachments, dryRun, ...handlers });

  // A post that never left (missing bot id, HTTP error) must not keep the day
  // claimed, or a transient failure costs the league its one message.
  if (!result.posted && !bypassesDayCap(kind) && !dryRun) {
    await releaseDay({ navSlug: league.navSlug, kind, now, log });
  }
  return result;
}

/** Give the day back — only if this kind still holds it. */
export async function releaseDay({ navSlug, kind, now = new Date(), log = console }) {
  const redis = getRedisConfig();
  if (!redis) return false;
  const key = dayClaimKey(navSlug, now);
  try {
    const holder = await redisCommand(redis, ['GET', key]);
    if (holder !== kind) return false;
    await redisCommand(redis, ['DEL', key]);
    log.log?.(`  [groupme] Released today's slot (${kind} did not send).`);
    return true;
  } catch {
    return false;
  }
}

/** Which kind holds today, or null. For status output. */
export async function readDayClaim(navSlug, now = new Date()) {
  const redis = getRedisConfig();
  if (!redis) return null;
  try {
    return (await redisCommand(redis, ['GET', dayClaimKey(navSlug, now)])) ?? null;
  } catch {
    return null;
  }
}

export { ptDay };
