/**
 * League-wide GroupMe cap: ONE automated post per Pacific day.
 *
 * The league gets a lot of bots. Transactions scan every 15 minutes, rumors
 * every 15, trade speculation daily, and seven scheduled columns land across
 * the week — two of them on the same Tuesday morning. Owners were getting
 * pinged for things that are not news, which is how a chat gets muted, and a
 * muted chat is worse than a quiet one because the ONE post that mattered goes
 * unread too.
 *
 * So the chat now runs on a schedule an owner can learn: each weekday has a
 * designated post, and everything else goes to web push, where it can be
 * personal and where an owner controls it per category
 * (/<league>/notifications).
 *
 * THE MODEL — a fixed weekday calendar, not a priority queue. Each weekday
 * names an ORDERED list of post kinds. The first kind that actually has
 * something to say claims the day; the rest hold. The ordering exists for one
 * reason only: a few kinds (a schedule release) are no-ops on 364 days a year
 * and genuinely newsworthy on the 365th, so they sit ahead of the day's
 * regular column and yield to it automatically by producing nothing.
 *
 * WHAT IS EXEMPT, and why it has to be:
 *   - anything a human sent by hand or through the admin panel — a person
 *     decided to send it, and a bot must not swallow that;
 *   - Roger's replies — he is answering an owner who spoke to him, and a
 *     suppressed reply reads as broken or rude to the person who asked;
 *   - Roger's deadline reminders — draft dates, lineup and cut deadlines. An
 *     owner who misses one loses real value, which is a far worse outcome
 *     than an extra message.
 *
 * DEADLINES ARE PUSH-FIRST AS OF SEP 2026, which is what keeps that last
 * exemption from being a hole big enough to drive the whole season through.
 * The exempt deadline kinds no longer mirror every reminder into the chat:
 *
 *   - `roger-reminder` now fires ONLY for an event's first touch, and only out
 *     of season. In season it never posts — the chat has real football in it
 *     and the phone already has the reminder.
 *   - `roger-fallback` and `lineup-deadline` are FALLBACKS. They post only when
 *     the push fan-out reports owners it could not reach, they name exactly
 *     those owners, and they @-mention them with a link to turn notifications
 *     on. Every owner who subscribes is one fewer name; a league where everyone
 *     has subscribed gets no post at all.
 *
 * So these stay exempt not because deadlines get a free pass, but because what
 * they now emit is already the minimum: a message to the specific people no
 * other channel reaches. See scripts/lib/reminder-fallback.mjs.
 *
 * The claim itself is atomic (Redis SET NX): the scanners run every 15 minutes
 * in parallel with the article crons, so "read then write" would let two posts
 * through on the same day.
 */

/** 0 = Sunday. Ordered: the first kind with something to say takes the day. */
export const GROUPME_DAY_PLAN = {
  0: ['schedule-release', 'cut-watch'],
  1: ['schedule-release'],
  2: ['schedule-release', 'pecking-order'],
  3: ['schedule-release', 'schedule-strength'],
  4: ['schedule-release', 'owners-poll-close'],
  5: ['schedule-release', 'weekend-preview'],
  6: ['schedule-release', 'matchup-preview'],
};

/**
 * Kinds the cap never applies to. Keep this list SHORT and argued — every
 * entry is a message the league will receive on top of the day's one post.
 */
export const EXEMPT_KINDS = new Set([
  'human',          // scripts/post-groupme-message.mjs
  'admin-announce', // the commissioner's broadcast panel
  'roger-reply',    // Roger answering an owner who spoke to him
  // An event's FIRST touch, offseason only — the save-the-date. Later touches
  // are push-only and never reach this file.
  'roger-reminder',
  // The day-of deadline post, sent only to the owners push could not reach and
  // naming only them. Exempt because it is already the narrowest thing we can
  // send: hold it and those specific owners hear about the deadline nowhere.
  'roger-fallback',
  // Schefter's pre-kickoff "your lineup is broken" warning, same shape — the
  // flagged owners push did not reach, and nobody else. Miss it and you start
  // an empty slot for real points.
  'lineup-deadline',
]);

/**
 * Kinds that are capped and have NO day of their own — they never post to
 * chat and always go to push. Listed explicitly rather than inferred, so that
 * "this is push-only" is a decision recorded in one place rather than an
 * accident of being absent from the calendar.
 *
 * `transaction` is the firehose that started all of this: every add, drop and
 * waiver claim, scanned every 15 minutes. It stays here.
 */
export const PUSH_ONLY_KINDS = new Set([
  'transaction',
  'weekly-recap',
  'waiver-pickups',
]);

/**
 * Kinds that skip the day cap because they already have a STRICTER budget of
 * their own — not because they are urgent.
 *
 * The trade lanes (rumor mill, trade bait, algorithmic speculation) exist to
 * get owners trading, and that only works in the room where trades get talked
 * about. They are not reminders competing with the league's chatter; they are
 * the chatter. So they post to chat, governed by the budget the rumor mill has
 * always carried in scripts/lib/schefter-groupme-budget.mjs:
 *
 *   - at most MAX_POSTS_PER_DAY (3) per Pacific day, shared across the lanes
 *   - at least MIN_SPACING_MS (4 hours) between them
 *   - a one-hour marinate window before a fresh tip may post
 *   - quiet hours, and an LLM quality gate on top
 *
 * That is tighter than the one-a-day calendar in practice and far better
 * targeted, because it can tell a real tip from filler. Routing these through
 * the weekday calendar instead would have meant a trade rumor waiting until
 * its assigned weekday, which is worthless — a rumor is news or it is nothing.
 *
 * The bar for adding a kind here is a real, enforced budget somewhere else.
 * Absent that, this set is just a hole in the cap.
 */
export const OWN_BUDGET_KINDS = new Set([
  'rumor',            // the rumor mill, which carries trade-bait listings
  'trade-speculation',
]);

/** Does this kind skip the one-post-a-day cap, and why does it get to? */
export function bypassesDayCap(kind) {
  return isExempt(kind) || OWN_BUDGET_KINDS.has(kind);
}

const TZ = 'America/Los_Angeles';

/** Pacific calendar date (YYYY-MM-DD) and weekday for an instant. */
export function ptDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** The kinds allowed to claim today, in order. */
export function plannedKindsFor(weekday) {
  return GROUPME_DAY_PLAN[weekday] ?? [];
}

/** True when this kind bypasses the cap entirely. */
export function isExempt(kind) {
  return EXEMPT_KINDS.has(kind);
}

/**
 * May this kind post to chat today at all?
 *
 * Pure — no Redis, no clock of its own. Answers the CALENDAR question only;
 * whether the day has already been claimed is a separate, atomic check.
 */
export function isPlannedToday(kind, now = new Date()) {
  if (bypassesDayCap(kind)) return true;
  return plannedKindsFor(ptDay(now).weekday).includes(kind);
}

/** Redis key holding today's claim for a league. */
export function dayClaimKey(navSlug, now = new Date()) {
  if (typeof navSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(navSlug)) {
    throw new TypeError(`groupme-day-plan: invalid league scope ${JSON.stringify(navSlug)}`);
  }
  return `groupme:${navSlug}:day:${ptDay(now).date}`;
}

/**
 * Explain a refusal, for logs. A cron that silently posts nothing is
 * indistinguishable from one that is broken.
 */
export function describeRefusal(kind, claimedBy, now = new Date()) {
  if (PUSH_ONLY_KINDS.has(kind)) {
    return `${kind} is push-only — it never posts to chat.`;
  }
  // Should not be reachable: these bypass the cap entirely. Answer honestly
  // rather than blaming the calendar if a caller asks anyway.
  if (OWN_BUDGET_KINDS.has(kind)) {
    return `${kind} is governed by the rumor budget, not the daily calendar.`;
  }
  if (!isPlannedToday(kind, now)) {
    const planned = plannedKindsFor(ptDay(now).weekday);
    return `${kind} is not today's designated post (today: ${planned.join(', ') || 'none'}).`;
  }
  return `today's post was already claimed by ${claimedBy}.`;
}
