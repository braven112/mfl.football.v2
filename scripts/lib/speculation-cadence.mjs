/**
 * Speculation Cadence — calendar-aware daily quota for trade-speculation posts.
 *
 * Reads `src/data/theleague/resolved-events.json` and returns the maximum number
 * of speculation posts to publish on a given calendar day, plus a tag describing
 * which window we're in. Higher quotas during the week before the trade deadline,
 * NFL Draft week, the rookie draft, the tagging period, and offseason FA opens.
 *
 * Output values are intentionally small. Speculation shares the rumor-mill's
 * 3-posts-per-day budget (`schefter:rumor:posts_today`) — see
 * scripts/schefter-trade-speculation.mjs. The cadence quota is the LOCAL cap
 * for THIS lane; the daily-rumor cap is the global cap.
 *
 * The schedule is intentionally tunable as a single CADENCE_LADDER constant.
 * If Brandon wants a different ramp, change the numbers here, not the matcher.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Highest priority wins. Each rule looks at the current calendar day and the
// `resolved-events.json` event list, returns true/false. The first match
// supplies the day's `maxPerDay` and tag.
//
// `maxPerDay` is interpreted as a daily cap for THIS speculation lane only.
// Fractional caps (e.g. 0.5) mean "1 post every 1/x days" — the runner script
// honors this by checking the date of the most recent speculation post in the
// rotation ledger before deciding to publish.
export const CADENCE_LADDER = [
  {
    id: 'trade-deadline-peak-week',
    label: 'Trade Deadline week (≤7d before)',
    maxPerDay: 2,
    reservesGlobalSlot: true, // peak week reserves 1 of the 3 daily rumor slots
    daysBeforeEvent: { eventId: 'trading-deadline', range: [0, 7] },
  },
  {
    id: 'trade-deadline-ramp',
    label: 'Trade Deadline ramp (8–21d before)',
    maxPerDay: 1,
    reservesGlobalSlot: false,
    daysBeforeEvent: { eventId: 'trading-deadline', range: [8, 21] },
  },
  {
    id: 'nfl-draft-window',
    label: 'NFL Draft week (≤7d before through 1d after)',
    maxPerDay: 1,
    reservesGlobalSlot: false,
    daysAroundEvent: { eventId: 'nfl-draft', before: 7, after: 1 },
  },
  {
    id: 'rookie-draft-window',
    label: 'Rookie Draft week (≤7d before through 1d after)',
    maxPerDay: 1,
    reservesGlobalSlot: false,
    daysAroundEvent: { eventId: 'rookie-draft', before: 7, after: 1 },
  },
  {
    id: 'tagging-period-window',
    label: 'Tagging period (Feb 1 → tag-matching close)',
    maxPerDay: 1,
    reservesGlobalSlot: false,
    betweenEvents: { startId: 'tagging-period', endId: 'tag-matching-period', endOffsetDays: 14 },
  },
  {
    id: 'fa-opens-window',
    label: 'Offseason FA opens (±7 days)',
    maxPerDay: 1,
    reservesGlobalSlot: false,
    daysAroundEvent: { eventId: 'offseason-fa-opens', before: 7, after: 7 },
  },
  {
    id: 'regular-season-default',
    label: 'Regular season default (1 every 5 days)',
    maxPerDay: 1 / 5,
    reservesGlobalSlot: false,
    betweenEvents: { startId: 'nfl-season-starts', endId: 'trading-deadline', endOffsetDays: -22 },
  },
  {
    id: 'post-deadline-regular-season',
    label: 'Post-deadline regular season (no in-season trades possible)',
    maxPerDay: 0,
    reservesGlobalSlot: false,
    afterEvent: { eventId: 'trading-deadline', untilEventId: 'league-championship' },
  },
  {
    id: 'quiet-offseason-default',
    label: 'Quiet offseason (1 every 14 days)',
    maxPerDay: 1 / 14,
    reservesGlobalSlot: false,
    fallback: true,
  },
];

/**
 * Return the calendar-day diff (midnight-to-midnight in PT) between two
 * timestamps. Positive = `target` is in the future relative to `from`.
 */
export function calendarDaysUntil(target, from = new Date()) {
  const targetDate = new Date(target);
  const fromDate = new Date(from);
  // Normalize both to UTC midnight of their PT calendar day. Using the
  // en-CA YYYY-MM-DD format in the LA tz makes this round-trip clean.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const targetDay = new Date(`${fmt.format(targetDate)}T00:00:00Z`).getTime();
  const fromDay = new Date(`${fmt.format(fromDate)}T00:00:00Z`).getTime();
  return Math.round((targetDay - fromDay) / DAY_MS);
}

function findEvent(events, id) {
  return events.find((e) => e.id === id) ?? null;
}

function ruleMatches(rule, events, now) {
  if (rule.fallback) return true;

  if (rule.daysBeforeEvent) {
    const event = findEvent(events, rule.daysBeforeEvent.eventId);
    if (!event) return false;
    const days = calendarDaysUntil(event.startDate, now);
    const [lo, hi] = rule.daysBeforeEvent.range;
    return days >= lo && days <= hi;
  }

  if (rule.daysAroundEvent) {
    const event = findEvent(events, rule.daysAroundEvent.eventId);
    if (!event) return false;
    const days = calendarDaysUntil(event.startDate, now);
    return days >= -rule.daysAroundEvent.after && days <= rule.daysAroundEvent.before;
  }

  if (rule.betweenEvents) {
    const start = findEvent(events, rule.betweenEvents.startId);
    const end = findEvent(events, rule.betweenEvents.endId);
    if (!start || !end) return false;
    const startDays = calendarDaysUntil(start.startDate, now);
    const endDays = calendarDaysUntil(end.startDate, now) + (rule.betweenEvents.endOffsetDays ?? 0);
    return startDays <= 0 && endDays >= 0;
  }

  if (rule.afterEvent) {
    const start = findEvent(events, rule.afterEvent.eventId);
    if (!start) return false;
    const startDays = calendarDaysUntil(start.startDate, now);
    if (startDays > 0) return false; // event still in future
    if (rule.afterEvent.untilEventId) {
      const end = findEvent(events, rule.afterEvent.untilEventId);
      if (end && calendarDaysUntil(end.startDate, now) < 0) return false;
    }
    return true;
  }

  return false;
}

/**
 * Resolve today's speculation cadence based on the league calendar.
 *
 * @param {object} args
 * @param {Array<{id:string,startDate:string}>} args.events - resolved-events.json `.events`
 * @param {Date} [args.now] - reference time, defaults to `new Date()`
 * @returns {{ tag: string, label: string, maxPerDay: number, reservesGlobalSlot: boolean, ladderId: string }}
 */
export function resolveCadence({ events, now = new Date() }) {
  const list = Array.isArray(events) ? events : [];
  for (const rule of CADENCE_LADDER) {
    if (ruleMatches(rule, list, now)) {
      return {
        tag: rule.id,
        ladderId: rule.id,
        label: rule.label,
        maxPerDay: rule.maxPerDay,
        reservesGlobalSlot: rule.reservesGlobalSlot,
      };
    }
  }
  // Defensive: ladder ends with the fallback rule, but if someone re-orders
  // the ladder accidentally, return zero rather than blow up.
  return {
    tag: 'no-rule',
    ladderId: 'no-rule',
    label: 'No rule matched',
    maxPerDay: 0,
    reservesGlobalSlot: false,
  };
}

/**
 * Decide whether today's cadence permits a fresh post given the rotation
 * ledger. Handles fractional `maxPerDay` (1 post every N days) by checking
 * the most recent post timestamp.
 */
export function permitsPost({ cadence, postsTodayInLane, lastPostAt, now = new Date() }) {
  if (!cadence || cadence.maxPerDay === 0) {
    return { allowed: false, reason: `cadence ${cadence?.tag ?? 'unknown'} bans posts` };
  }
  if (cadence.maxPerDay >= 1) {
    if (postsTodayInLane >= Math.floor(cadence.maxPerDay)) {
      return { allowed: false, reason: `lane cap ${cadence.maxPerDay}/day already met` };
    }
    return { allowed: true };
  }
  // Fractional cap (e.g. 1/2 → "every other day", 1/3 → "every 3 days").
  // Express as "must wait at least (1/maxPerDay - 1) full calendar days
  // since the most recent post". 1 every 2 days = wait 1 day. 1 every 3
  // days = wait 2 days.
  if (!lastPostAt) return { allowed: true };
  const minCalendarGap = Math.max(0, Math.round(1 / cadence.maxPerDay) - 1);
  const daysSince = -calendarDaysUntil(lastPostAt, now); // positive = past
  if (daysSince < minCalendarGap) {
    return {
      allowed: false,
      reason: `fractional cadence ${cadence.maxPerDay.toFixed(2)}/day — wait ${minCalendarGap}d, only ${daysSince}d since last post`,
    };
  }
  return { allowed: true };
}
