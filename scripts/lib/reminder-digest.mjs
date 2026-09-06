/**
 * One chat message when several deadlines land in the same run.
 *
 * TheLeague's "Declare Contracts / Cut to 22" and "Offseason FA Closes" are
 * both the third Sunday in August, so their 7-day touches fire on the same
 * day and the chat got two back-to-back Roger monologues. Two bot messages in
 * a row is how a chat gets muted, which costs far more than the second message
 * was worth.
 *
 * WHY THE POSTS MERGE AND THE EVENTS DO NOT. They are genuinely two different
 * deadlines: each has its own row on /calendar, its own Schefter Report entry,
 * its own dedup id, and its own push. Collapsing them at the event level to
 * fix a chat-formatting problem would quietly rewrite the league's calendar.
 * Only the group post — the one surface where adjacency is the problem —
 * combines.
 *
 * THE DIGEST IS DELIBERATELY TERSER THAN A SINGLE REMINDER. One deadline gets
 * Roger's full voice: headline, body, link. Two or more get a list and one
 * link to the calendar, because concatenating two monologues overruns
 * GroupMe's 1000-character cap and reads worse than the bullets do. The full
 * copy for each still exists — on the site, and in each owner's push.
 *
 * Pure. tests/reminder-digest.test.ts owns the invariants.
 */

/** Spelled out to about where it stops reading naturally; digits after that. */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function countWord(n) {
  return COUNT_WORDS[n] ?? String(n);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * How far out a deadline is, in the words a reminder would use.
 *
 * `daysUntil` is a calendar-day diff (midnight to midnight), so 0 really is
 * today rather than "within 24 hours" — see roger-reminder-window.mjs.
 */
export function describeDaysUntil(daysUntil) {
  if (!Number.isInteger(daysUntil)) return '';
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil === 7) return 'in a week';
  return `in ${daysUntil} days`;
}

/**
 * Merge several due reminders into one chat message.
 *
 * @param {object} args
 * @param {Array<{name: string, daysUntil?: number}>} args.items One per event.
 * @param {string} [args.lead] Opening line; a default is supplied.
 * @returns {{ headline: string, body: string } | null} null for fewer than two
 *   items — one reminder must keep its own voice, and callers check this
 *   rather than passing a single item through a list renderer.
 */
export function buildReminderDigest({ items, lead } = {}) {
  const rows = (items ?? []).filter((i) => i && i.name);
  if (rows.length < 2) return null;

  const headline = lead ?? `${capitalize(countWord(rows.length))} deadlines on the board`;
  const lines = rows.map((r) => {
    const when = describeDaysUntil(r.daysUntil);
    return when ? `• ${r.name} — ${when}` : `• ${r.name}`;
  });

  return {
    headline,
    body: [
      'Same stretch of calendar, so you are getting them together rather than one message at a time.',
      lines.join('\n'),
    ].join('\n\n'),
  };
}
