/**
 * Resolve GroupMe @-mentions for a set of franchises.
 *
 * The deadline lanes post to the group chat only to reach owners that push
 * notifications did NOT reach (see reminder-fallback.mjs). Naming those owners
 * in the body is not enough — the whole point of the post is that this person
 * does not get notifications, and a plain line of text in a busy chat is
 * exactly what they will scroll past. A GroupMe @-mention rings their phone
 * through GroupMe's own notification, which is the one channel we already know
 * works for them. It is also the thing they escape by subscribing, which is
 * the incentive the migration runs on.
 *
 * THE MAPPING ONLY EXISTS IN ONE DIRECTION. `map-groupme-owners.mjs` writes
 * `groupme:<navSlug>:user:<userId>` → franchiseId, one key per GroupMe member,
 * and there is no reverse index. Rather than add a second index that can drift
 * out of sync with the first (and that every already-applied mapping would be
 * missing), this reads the group's member list and inverts the forward keys on
 * the spot. Costs one members call plus one GET per member, on a lane that
 * runs at most a few times a week.
 *
 * DEGRADES, NEVER THROWS. No service token, no group, no Redis, an unmapped
 * owner — every one of those yields "no mention for that franchise", and the
 * caller falls back to naming them in plain text. A missing mention must never
 * cost someone their deadline notice.
 */

import { resolveLeagueGroupId, fetchGroupMembers } from './groupme-groups.mjs';
// The forward-key shape has ONE implementation, and it is the one Roger's
// clapback reader already uses — `tests/roger-afl-mapping.test.ts` pins it
// against the writer in map-groupme-owners.mjs. Re-deriving the string here is
// how the AFL ends up reading TheLeague's franchise ids.
import { franchiseMapKeys } from '../roger-groupme-reply.mjs';

const DEFAULT_LOG = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
};

/**
 * franchiseId → { userId, nickname } for every franchise we can @-mention.
 *
 * @param {object} args
 * @param {object} args.league Schefter league object (`slug` is the navSlug).
 * @param {object|null} [args.redis] Upstash client; null disables lookup.
 * @param {typeof fetch} [args.fetchImpl]
 * @param {{log?: Function, warn?: Function}} [args.log]
 * @returns {Promise<Map<string, {userId: string, nickname: string}>>} Empty on
 *   any failure — an empty map means "name them in text", not "skip the post".
 */
export async function resolveFranchiseMentions({
  league,
  redis = null,
  fetchImpl = fetch,
  log = DEFAULT_LOG,
} = {}) {
  const empty = new Map();
  if (!league || !redis) return empty;

  let members;
  try {
    const { groupId } = await resolveLeagueGroupId({ league, redis, fetchImpl });
    if (!groupId) {
      log.warn?.(`  [mentions] No GroupMe group for ${league.slug} — naming owners in text only.`);
      return empty;
    }
    members = await fetchGroupMembers({ groupId, fetchImpl });
  } catch (err) {
    log.warn?.(`  [mentions] Group lookup failed (${err.message}) — naming owners in text only.`);
    return empty;
  }
  if (!members) return empty;

  const byFranchise = new Map();
  for (const member of members) {
    const userId = member?.user_id;
    if (!userId) continue;
    for (const key of franchiseMapKeys(league.slug, userId)) {
      let franchiseId;
      try {
        const raw = await redis.get(key);
        // @upstash/redis deserializes on read, and a franchise id is only
        // accidentally string-safe (leading zeros are not valid JSON). Coerce
        // rather than bet a public callout on that accident — same posture as
        // resolveFranchiseId in roger-groupme-reply.mjs.
        franchiseId = raw == null ? '' : String(raw);
      } catch (err) {
        log.warn?.(`  [mentions] Lookup failed on ${key}: ${err.message}`);
        continue;
      }
      if (!franchiseId) continue;
      // First member to claim a franchise wins. The writer already refuses to
      // apply a file that maps one franchise to two members, so a collision
      // here means stale keys — and tagging the wrong owner in front of the
      // league is worse than tagging nobody.
      if (!byFranchise.has(franchiseId)) {
        byFranchise.set(franchiseId, { userId, nickname: member.nickname ?? '' });
      }
      break;
    }
  }
  return byFranchise;
}

/**
 * Build the mention loci for text that already contains the mention tokens.
 *
 * GroupMe's `loci` are [start, length] offsets into the message body, so the
 * text and the attachment have to be built together or the highlight lands on
 * the wrong words. Callers therefore hand us the finished text plus the exact
 * substring each mention covers, and this locates them left to right —
 * `indexOf` from a moving cursor, so two owners with the same display name do
 * not both resolve to the first occurrence.
 *
 * Offsets are UTF-16 code units, which is what `String.prototype.indexOf`
 * returns and what GroupMe's clients expect.
 *
 * @param {string} text The exact bytes being sent.
 * @param {Array<{userId: string, token: string}>} tokens In the order they appear.
 * @returns {Array<{userId: string, start: number, length: number}>}
 */
export function locateMentions(text, tokens) {
  const out = [];
  let cursor = 0;
  for (const { userId, token } of tokens ?? []) {
    if (!userId || !token) continue;
    const start = text.indexOf(token, cursor);
    if (start === -1) continue;
    out.push({ userId, start, length: token.length });
    cursor = start + token.length;
  }
  return out;
}
