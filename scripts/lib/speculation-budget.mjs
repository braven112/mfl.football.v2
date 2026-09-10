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

import { schefterKey, DEFAULT_SCHEFTER_NAV_SLUG } from './schefter-keys.mjs';

/** Legacy (TheLeague) keys — the speculation lane is TheLeague-only today. */
export const RUMOR_POSTS_TODAY_KEY = schefterKey(DEFAULT_SCHEFTER_NAV_SLUG, 'rumor:posts_today');
export const RUMOR_LAST_POST_TS_KEY = schefterKey(DEFAULT_SCHEFTER_NAV_SLUG, 'rumor:last_post_ts');

export const MAX_GLOBAL_POSTS_PER_DAY = 3;
export const RESERVED_PEAK_SLOT = 1;
export const MIN_SPACING_MS = 4 * 60 * 60 * 1000;

/**
 * ── The TOPIC budget, alongside the post budget ──
 *
 * Everything above counts POSTS. Nothing counted TOPICS, and three separate
 * lanes are all trade-flavored — the trade-offer rumor lane, the trade-bait
 * lane, and this speculation lane — so trade could take the whole day's
 * budget, and did. Across Sept 4-10 2026, 13 of 16 Schefter posts were trade
 * stories; Sept 6, 7 and 8 were 100% trade. Every gate in the system reported
 * itself satisfied the entire time, because each one was answering "have we
 * posted too much today" and the complaint was "is this all he talks about".
 *
 * ONE trade story a day, across every lane. The remaining slots stay open for
 * non-trade beats — this is a topic ceiling, not a smaller post budget, so a
 * quiet trade day does not become a quiet feed.
 *
 * A trade-flavored bucket that loses to this ceiling is HELD, not dropped: the
 * rumor mill leaves its tips in the queue and the age boost in
 * `bucketPriorityScore` floats them up tomorrow. Nothing is thrown away, it
 * just waits its turn.
 */
export const MAX_TRADE_POSTS_PER_DAY = 1;

/**
 * Redis key for the day's trade-story count, per league.
 *
 * A factory rather than a constant because the rumor mill builds its keys off
 * its own `NAV_SLUG` — the speculation lane is TheLeague-only today and takes
 * the default, but a bare constant here would be the module-level literal that
 * put one league's listings in another league's chat once already (see the
 * trade-bait lane note in docs/claude/rules/schefter.md).
 */
export function tradePostsTodayKey(navSlug = DEFAULT_SCHEFTER_NAV_SLUG) {
  return schefterKey(navSlug, 'rumor:trade_posts_today');
}

/** TheLeague's key, for the lanes that are TheLeague-only. */
export const TRADE_POSTS_TODAY_KEY = tradePostsTodayKey();

/**
 * How many more trade stories today's budget allows. Never negative.
 *
 * Returned as a REMAINING count rather than a boolean because the rumor mill
 * needs the number: a single cycle can build two beats, and "one slot left"
 * has to stop the second one. The busy-morning trade split was the concrete
 * case — it ships two trade posts a second apart against one slot of the post
 * budget, which under a one-a-day topic ceiling is one post too many.
 */
export function tradeSlotsRemaining(tradePostsToday, cap = MAX_TRADE_POSTS_PER_DAY) {
  const used = Number.isFinite(tradePostsToday) ? Math.max(0, Math.floor(tradePostsToday)) : 0;
  return Math.max(0, cap - used);
}

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
