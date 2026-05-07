/**
 * Speculation Budget Gate — shared rumor-mill / speculation post counter.
 *
 * The rumor-mill (`scripts/schefter-rumor-scan.mjs`) writes a daily counter
 * to Redis at `schefter:rumor:posts_today`, capped at MAX_GLOBAL_POSTS_PER_DAY.
 * Speculation participates in the same budget so the news feed never gets
 * more than 3 Schefter-voiced posts in a single PT day.
 *
 * Two extra rules layered on top of the raw counter:
 *
 *   - MIN_SPACING_MS — speculation can't post within 4 hours of any prior
 *     Schefter post (rumor or speculation). Mirrors the rumor-mill's spacing
 *     rule so multiple Schefter beats in the same morning don't blur together.
 *   - reservesGlobalSlot — only the trade-deadline peak-week cadence may
 *     exceed the soft cap by RESERVED_PEAK_SLOT (=1). This lets a marquee
 *     Wednesday-of-deadline-week speculation still ship even if the
 *     rumor-mill already burned all 3 normal slots.
 */

export const RUMOR_POSTS_TODAY_KEY = 'schefter:rumor:posts_today';
export const RUMOR_LAST_POST_TS_KEY = 'schefter:rumor:last_post_ts';

export const MAX_GLOBAL_POSTS_PER_DAY = 3;
export const RESERVED_PEAK_SLOT = 1;
export const MIN_SPACING_MS = 4 * 60 * 60 * 1000;

/**
 * @param {object} args
 * @param {{ reservesGlobalSlot:boolean }} args.cadence - resolved cadence object
 * @param {number} args.globalPostsToday - current value of the shared counter
 * @param {number|null} args.lastPostTs - ms-epoch of last shared post, or null
 * @param {Date} [args.now]
 * @returns {{ allowed:boolean, reason?:string, ceiling:number }}
 */
export function checkGlobalBudgetGate({ cadence, globalPostsToday, lastPostTs, now = new Date() }) {
  const ceiling = cadence.reservesGlobalSlot
    ? MAX_GLOBAL_POSTS_PER_DAY + RESERVED_PEAK_SLOT
    : MAX_GLOBAL_POSTS_PER_DAY;

  if (globalPostsToday >= ceiling) {
    return {
      allowed: false,
      reason: `posts_today=${globalPostsToday} ≥ ceiling=${ceiling} (${cadence.reservesGlobalSlot ? 'peak-week reservation already used' : 'normal cap'})`,
      ceiling,
    };
  }

  if (lastPostTs) {
    const age = now.getTime() - Number(lastPostTs);
    if (age >= 0 && age < MIN_SPACING_MS) {
      const minutesAgo = Math.round(age / 60000);
      const minutesNeeded = MIN_SPACING_MS / 60000;
      return {
        allowed: false,
        reason: `last Schefter post was ${minutesAgo}m ago; need ${minutesNeeded}m spacing`,
        ceiling,
      };
    }
  }

  return { allowed: true, ceiling };
}
