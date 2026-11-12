/**
 * The Saturday lineup roll call, and the Sunday push-only rule.
 *
 * The owner's call (Nov 2026): on Saturday morning, BEFORE the Matchup Preview
 * goes out, the chat gets one post naming EVERY team whose lineup has a
 * problem — no lineup, an empty starting slot, or a starter who is OUT, on IR
 * or on a bye. The point is to fix lineups a day early, so the kickoff-time
 * warnings (push-first, with a chat fallback) have less left to catch.
 *
 * And on SUNDAY the lineup lane never posts to the chat at all — push and the
 * owner's own feed only. Saturday already said it in public; Sunday is the
 * league's busiest chat day and the last-minute call-outs were the noise.
 *
 * This differs from the kickoff fallback (reminder-fallback.mjs) on purpose:
 * that one names only the owners push did NOT reach. The Saturday roll call
 * names everyone with a problem, because it is a public "fix it before
 * tomorrow" list, not a delivery fallback.
 *
 * Pure — no network, no Redis, no clock of its own.
 * tests/lineup-broadcast.test.ts owns the invariants.
 */

import { buildMentionAttachment } from './groupme.mjs';
import { locateMentions } from './groupme-mentions.mjs';

/** GroupMe truncates past 1000 characters; leave room rather than race it. */
export const GROUPME_MAX_CHARS = 950;

/**
 * Slack allows far more, but a 99-team league can flag dozens of teams, and a
 * wall of text nobody scrolls helps nobody. Long enough for ~40 short lines.
 */
export const SLACK_MAX_CHARS = 3500;

/**
 * The weekday (0 = Sunday … 6 = Saturday) in a league's own clock. The lineup
 * lane's day rules are about the LEAGUE's Sunday, not the runner's (UTC).
 *
 * @param {Date} now
 * @param {string} zone IANA zone, the registry's `officialClock.zone`.
 */
export function leagueWeekday(now, zone = 'America/Los_Angeles') {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[short] ?? -1;
}

/** No lineup chat posts on the league's Sunday — push and feed only. */
export function isChatQuietDay(now, zone) {
  return leagueWeekday(now, zone) === 0;
}

/**
 * The franchises that actually PLAY this week: the ones inside a matchup.
 *
 * weeklyResults also lists unmatched franchises directly (a playoff bye, or a
 * team already eliminated). Naming those in public for "no lineup" would call
 * out an owner who has nothing to set, so the roll call keeps only these.
 *
 * @returns {Set<string>}
 */
export function playingFranchiseIds(weeklyResultsJson) {
  const ids = new Set();
  const wr = weeklyResultsJson?.weeklyResults;
  const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  for (const m of asArray(wr?.matchup)) {
    for (const f of asArray(m?.franchise)) if (f?.id) ids.add(String(f.id));
  }
  return ids;
}

/** Problem types as lineup-warnings.mjs emits them, written short. */
const SHORT_LABELS = {
  OUT: 'OUT',
  IR: 'IR',
  SUSPENDED: 'suspended',
  RETIRED: 'retired',
  HOLDOUT: 'holdout',
  BYE: 'bye',
};

/**
 * One owner's problem, written short for a public list. The warning's own
 * line (formatWarningLine) leads with the team name; the roll call puts the
 * name (or the @-mention) first itself.
 */
export function problemSummary(warning) {
  const parts = (warning.problems ?? []).map((p) => {
    const label = SHORT_LABELS[p.type] ?? String(p.type ?? '').toLowerCase();
    return `${p.playerName} (${label})`;
  });
  if (warning.noLineup) parts.unshift('no lineup set');
  else if (warning.emptySlots > 0) {
    parts.push(`${warning.emptySlots} empty slot${warning.emptySlots === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

/**
 * Compose the Saturday roll call.
 *
 * @param {object} args
 * @param {number} args.week
 * @param {Array<object>} args.warnings Every flagged, still-unlocked team.
 * @param {Map<string, {userId: string}>} [args.mentions] GroupMe only.
 * @param {string} args.lineupUrl Absolute, from leagueUrl. Goes LAST, with no
 *   trailing punctuation (GroupMe autolinks a glued period and 404s it).
 * @param {number} [args.maxChars]
 * @returns {{text: string, attachments: Array<object>, named: string[]} | null}
 */
export function buildSaturdayLineupPost({
  week,
  warnings,
  mentions = new Map(),
  lineupUrl,
  maxChars = GROUPME_MAX_CHARS,
}) {
  // MFL franchise names carry stray trailing spaces ("Celtics "), which would
  // print as "Celtics : …" and break the @-mention token match.
  const rows = (warnings ?? [])
    .filter((w) => w && w.franchiseId && String(w.franchiseName ?? '').trim())
    .map((w) => ({ ...w, franchiseName: String(w.franchiseName).trim() }));
  if (rows.length === 0) return null;

  // No-lineup teams first: they lose the most if nobody tells them.
  const ordered = [...rows].sort(
    (a, b) => Number(Boolean(b.noLineup)) - Number(Boolean(a.noLineup)) ||
      a.franchiseName.localeCompare(b.franchiseName),
  );

  const n = ordered.length;
  const headline =
    `📋 Week ${week} lineup check: ${n} team${n === 1 ? '' : 's'} ` +
    `${n === 1 ? 'has' : 'have'} something to fix before Sunday`;
  const cta = `Set yours: ${lineupUrl}`;

  const render = (count, withDetail) => {
    const named = ordered.slice(0, count);
    const tokens = [];
    const lines = named.map((w) => {
      const mention = mentions.get(w.franchiseId);
      const token = mention ? `@${w.franchiseName}` : w.franchiseName;
      if (mention) tokens.push({ userId: mention.userId, token });
      return withDetail ? `${token}: ${problemSummary(w)}` : token;
    });
    const overflow = n - named.length;
    if (overflow > 0) lines.push(`…and ${overflow} more`);
    return { text: [headline, lines.join('\n'), cta].join('\n\n'), tokens, named };
  };

  // Shed detail first, then names, the same order as the kickoff fallback:
  // each owner's own push carries the detail, and a name dropped here is an
  // owner nobody called out.
  let attempt = render(n, true);
  if (attempt.text.length > maxChars) attempt = render(n, false);
  for (let count = n - 1; attempt.text.length > maxChars && count >= 1; count--) {
    attempt = render(count, false);
  }

  const located = locateMentions(attempt.text, attempt.tokens);
  const attachment = buildMentionAttachment(located);
  return {
    text: attempt.text,
    attachments: attachment ? [attachment] : [],
    named: attempt.named.map((w) => w.franchiseId),
  };
}
