/**
 * Throwback Week reminder helpers — NFL-week date derivation + Roger copy.
 *
 * Extracted into a lib (same pattern as roger-reminder-window.mjs) so vitest
 * can lock the behavior in tests/throwback-week-reminder.test.ts without
 * importing schefter-scan.mjs, which runs the full scan at import time.
 *
 * Date derivation is COMPUTED, never hardcoded to a calendar date:
 *   Labor Day (1st Monday of September)
 *     → NFL kickoff (Thursday after Labor Day, Labor Day + 3)
 *     → NFL Week N starts kickoff Thursday + (N - 1) * 7 days.
 *
 * The week number itself comes from THROWBACK_WEEKS in
 * src/data/theleague/throwback-config.ts (single source of truth) —
 * compute-league-events.mjs parses it out of the TS source via
 * parseThrowbackWeeks() and falls back to DEFAULT_THROWBACK_WEEKS only if
 * the parse fails.
 */

/** First Monday of September. */
export function getLaborDay(year) {
  const first = new Date(year, 8, 1);
  const firstDow = first.getDay();
  let diff = 1 - firstDow;
  if (diff < 0) diff += 7;
  return new Date(year, 8, 1 + diff);
}

/** NFL kickoff: the Thursday after Labor Day. */
export function getNflKickoff(year) {
  const ld = getLaborDay(year);
  return new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
}

/**
 * Start of NFL week `week` (1-based): kickoff Thursday + (week - 1) * 7 days.
 * Week 1 starts on kickoff Thursday itself; Week 4 = kickoff + 21 days.
 */
export function getNflWeekStart(year, week) {
  if (!Number.isInteger(week) || week < 1) {
    throw new Error(`Invalid NFL week: ${week}`);
  }
  const kickoff = getNflKickoff(year);
  return new Date(
    kickoff.getFullYear(),
    kickoff.getMonth(),
    kickoff.getDate() + (week - 1) * 7,
  );
}

/**
 * Fallback if parsing throwback-config.ts ever fails. Mirrors the config the
 * same way compute-league-events.mjs's EVENTS list mirrors league-events.ts.
 */
export const DEFAULT_THROWBACK_WEEKS = [4];

/**
 * Extract THROWBACK_WEEKS from the TypeScript source of
 * src/data/theleague/throwback-config.ts. Returns an array of valid week
 * numbers, or null when the export can't be found / parses to nothing —
 * callers should fall back to DEFAULT_THROWBACK_WEEKS (with a warning).
 *
 * @param {string} source - raw contents of throwback-config.ts
 * @returns {number[] | null}
 */
export function parseThrowbackWeeks(source) {
  const m = String(source).match(
    /export\s+const\s+THROWBACK_WEEKS[^=]*=\s*\[([^\]]*)\]/,
  );
  if (!m) return null;
  const weeks = m[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 18);
  return weeks.length > 0 ? weeks : null;
}

/** Event id convention for resolved-events.json entries. */
export function throwbackEventId(week) {
  return `throwback-week-${week}`;
}

export function isThrowbackEventId(id) {
  return /^throwback-week-\d+$/.test(String(id));
}

/** Parse the NFL week number back out of a throwback event id, or null. */
export function throwbackWeekFromEventId(id) {
  const m = /^throwback-week-(\d+)$/.exec(String(id));
  return m ? parseInt(m[1], 10) : null;
}

// ── Roger copy ──
//
// Template-based, NOT LLM-backed — same contract as the generic ROGER_* pools
// in schefter-scan.mjs. Placeholders: {week} = NFL week number, {days} =
// calendar days until the event. Pre-event touches nudge owners to pick their
// era (the caller links /theleague/throwback-settings); day-of announces the
// legacy identities are live on live scoring / matchups / lineup.

const THROWBACK_14D = [
  {
    h: 'Throwback Week is {days} days out — pick your era',
    b: 'Week {week} is Throwback Week: every team in this league suits up in a legacy identity on live scoring, matchups, and lineups. You have {days} days to decide which chapter of your franchise history gets exhumed. Choose for yourself, or the commissioner chooses for you — and he has a long memory and zero mercy.',
  },
  {
    h: '{days} days until Throwback Week',
    b: 'The time machine leaves in {days} days. Come Week {week}, your team wears an old name and an old logo whether you picked one or not. Pick your era now, or get assigned one like it\'s middle school PE.',
  },
  {
    h: 'Throwback Week approaching — {days} days',
    b: 'Consider this your {days}-day notice: Week {week} is Throwback Week. Old names. Old logos. Old grudges. Lock in the era your team throws back to before the commissioner\'s default locks it in for you.',
  },
];

const THROWBACK_7D = [
  {
    h: 'One week until Throwback Week',
    b: 'Seven days until the whole league parties like it\'s 2007. Week {week} is Throwback Week, and if you haven\'t picked your era yet, the commissioner\'s default pick is warming up in the bullpen. Nobody has ever been happy with the bullpen.',
  },
  {
    h: 'Throwback Week — {days} days',
    b: 'Throwback Week hits in Week {week} — that\'s next week. Every roster page, matchup, and live score wears your franchise\'s old identity. Pick which one, or spend the week explaining why you\'re in the commissioner\'s hand-me-downs.',
  },
  {
    h: 'T-minus one week: Throwback Week',
    b: 'One week out from Throwback Week. The eras are on the table, the settings page is open, and history is watching. Make your pick before Week {week} makes it for you.',
  },
];

const THROWBACK_2D = [
  {
    h: 'Throwback Week — 48 hours to pick your era',
    b: 'Two days until Week {week} flips the whole league into throwback mode. If you still haven\'t picked an era, this is me reminding you that the default is a commissioner pick, not a democracy.',
  },
  {
    h: 'Two days until Throwback Week',
    b: 'Last call at the nostalgia bar. Throwback Week starts in two days — lock in your era now or ride whatever the commissioner picked for you all week. No refunds, no rebrand appeals.',
  },
];

const THROWBACK_DAYOF = [
  {
    h: 'THROWBACK WEEK IS LIVE',
    b: 'It\'s Week {week} and the league just hit the wayback machine. Legacy names and logos are live right now on live scoring, matchups, and lineups. Go see who your rivals used to be — and remind them why they rebranded.',
  },
  {
    h: 'Welcome to Throwback Week',
    b: 'Throwback Week is officially live. All week, every team wears an old identity across live scoring, matchups, and the lineup page. Some of these eras aged like wine. Others aged like the 2007 logo art. Enjoy both.',
  },
];

const THROWBACK_TEMPLATES = {
  '14d': THROWBACK_14D,
  '7d': THROWBACK_7D,
  '2d': THROWBACK_2D,
  dayof: THROWBACK_DAYOF,
};

/**
 * Build the Roger headline/body for a Throwback Week reminder touch.
 *
 * @param {'14d'|'7d'|'2d'|'dayof'} touchId
 * @param {object} opts
 * @param {number} opts.week - NFL week number (from the event id)
 * @param {number} opts.days - calendar days until the event (event.daysUntil)
 * @param {number|null} [opts.defaultCount] - how many teams are still on the
 *   commissioner default. null/undefined = unknown (Redis unavailable) →
 *   generic copy. Only surfaced on pre-event touches; day-of never nags.
 * @returns {{ headline: string, body: string } | null}
 */
export function buildThrowbackReminder(touchId, { week, days, defaultCount = null } = {}) {
  const pool = THROWBACK_TEMPLATES[touchId];
  if (!pool) return null;

  // Deterministic pick, same convention as pickRogerTemplate in the scanner:
  // hash the event id so a given event+touch always renders the same template.
  const eventId = throwbackEventId(week);
  const hash = eventId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const template = pool[hash % pool.length];

  const fill = (s) =>
    s.replace(/\{week\}/g, String(week)).replace(/\{days\}/g, String(days));

  let body = fill(template.b);
  if (touchId !== 'dayof' && Number.isInteger(defaultCount) && defaultCount > 0) {
    body +=
      defaultCount === 1
        ? ' As of this reminder, one team is still riding the commissioner\'s default pick. You know who you are.'
        : ` As of this reminder, ${defaultCount} teams are still riding the commissioner's default pick. You know who you are.`;
  }

  return { headline: fill(template.h), body };
}
