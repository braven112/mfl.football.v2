/**
 * Send push notifications from a cron script.
 *
 * The counterpart to src/pages/api/cron/push-fanout.ts. A script composes the
 * copy — it is the one that knows what happened — and this posts it to the
 * site, which owns delivery and preference filtering.
 *
 * Never throws and never fails a job. Every caller here has already done its
 * real work (an article written, a scan committed) by the time it sends, so a
 * push outage must not turn a successful run into a failed one.
 *
 * RETURNS `delivered` and `undelivered` franchise-id arrays, which is what the
 * deadline lanes use to decide whether the group chat needs to carry a message
 * at all (see scripts/lib/reminder-fallback.mjs). The contract that matters:
 * **a push that did not run counts as reaching nobody.** No CRON_SECRET, a dry
 * run, an HTTP error, push not configured — every one of those puts the whole
 * batch in `undelivered`, so the chat post goes out to everyone exactly as it
 * did before this existed. The failure mode of the notification migration must
 * be "the league gets a redundant group post", never "nobody is told the
 * deadline".
 */

import { leagueUrl } from '../../src/config/leagues-data.mjs';

/**
 * Must not exceed MAX_NOTIFICATIONS in src/pages/api/cron/push-fanout.ts.
 * The route answers an oversized batch with a 400 and delivers none of it.
 */
const MAX_PER_CALL = 64;

/**
 * Defaulting to `console` itself types the parameter as the full Console
 * interface, which rejects any two-method stub a caller (or a test) passes.
 * Narrow it to the two methods this module actually calls.
 *
 * @type {{ log: (...args: any[]) => void, warn: (...args: any[]) => void }}
 */
const DEFAULT_LOG = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
};

/**
 * @param {object} args
 * @param {object} args.league Registry entry.
 * @param {string} args.category Notification category — see
 *   src/config/notification-categories.ts. Owners control these per category,
 *   so a wrong or missing one means the alert is silently dropped by the
 *   server rather than delivered to someone who did not ask for it.
 * @param {Array<{franchiseId: string, title: string, body: string, url?: string, tag?: string}>} args.notifications
 * @param {boolean} [args.dryRun] Never sends. Guarded HERE rather than at each
 *   call site: a push is the one side effect a dry run must not have, and five
 *   scripts remembering it is five chances to forget.
 * @param {{ log?: (...args: any[]) => void, warn?: (...args: any[]) => void }} [args.log]
 */
export async function sendPushFanout({ league, category, notifications, dryRun = false, log = DEFAULT_LOG }) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return { sent: 0, skipped: 'nothing to send', delivered: [], undelivered: [] };
  }
  if (!category) throw new TypeError('sendPushFanout: a `category` is required.');

  // Every franchise this call was asked to reach. The unreached set is derived
  // by subtraction from this, so a lane that never sent anything reports the
  // full roster as unreached rather than an empty list — an empty list would
  // read as "everybody got it" and silence the chat fallback.
  const requested = [...new Set(notifications.map((n) => n.franchiseId).filter(Boolean))];
  const nobodyReached = (skipped) => ({ sent: 0, skipped, delivered: [], undelivered: requested });

  if (dryRun) {
    log.log?.(`  [dry-run] Would push ${category} to ${notifications.length} owner(s).`);
    return nobodyReached('dry-run');
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.warn?.(`  [push] CRON_SECRET not set — skipping ${category} push.`);
    return nobodyReached('no secret');
  }

  // The origin comes from the league registry, which is the single source of
  // truth for it — never concatenated by hand, never a workflow variable.
  const base = leagueUrl(league, '').replace(/\/$/, '');

  // Chunked, because the route rejects a batch over MAX_NOTIFICATIONS (64)
  // with a 400 and sends NOTHING. That ceiling is easy to cross without
  // noticing: the deadline sender fans one alert per franchise per reminder
  // post, so the 24-team AFL crosses it at three posts, and TheLeague at
  // five. Batching here rather than at each sender means no caller has to
  // know the route's limit — the same reason the dry-run guard lives here.
  const batches = [];
  for (let i = 0; i < notifications.length; i += MAX_PER_CALL) {
    batches.push(notifications.slice(i, i + MAX_PER_CALL));
  }

  let sent = 0;
  let recipients = 0;
  const delivered = new Set();
  // Why nothing went out, for a caller (or a test) that needs to tell a push
  // outage apart from an empty batch. Chunking made this a per-batch fact, so
  // it records the LAST failure rather than the only one.
  let skipped = null;
  for (const batch of batches) {
    try {
      const res = await fetch(`${base}/api/cron/push-fanout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          league: league.slug,
          notifications: batch.map((n) => ({ ...n, category })),
        }),
      });
      if (!res.ok) {
        log.warn?.(`  [push] ${category} fan-out failed: HTTP ${res.status}`);
        skipped = `http ${res.status}`;
        continue;
      }
      const data = await res.json();
      sent += data.sent ?? 0;
      recipients += data.recipients ?? 0;
      // Absent on a route that short-circuited (push not configured). Leaving
      // the batch out of `delivered` is the right read: nothing was sent.
      for (const id of data.delivered ?? []) delivered.add(id);
    } catch (err) {
      // Per batch, so one failed chunk cannot cost the others.
      log.warn?.(`  [push] ${category} fan-out failed: ${err.message}`);
      skipped = err.message;
    }
  }
  const undelivered = requested.filter((id) => !delivered.has(id));
  log.log?.(
    `  [push] ${category} → ${recipients} owners (${sent} devices)` +
      (undelivered.length > 0 ? `, ${undelivered.length} unreached` : '') +
      '.',
  );
  return {
    sent,
    recipients,
    batches: batches.length,
    delivered: [...delivered],
    undelivered,
    ...(skipped ? { skipped } : {}),
  };
}

/**
 * The same alert to every franchise in a league.
 *
 * Used for league-wide news — a column publishing, a big trade. The server
 * still filters per owner by category, so "everyone" means "everyone who asked
 * for this kind of thing".
 *
 * @param {object} args
 * @param {Iterable<string>} [args.franchiseIds] Missing or empty yields no
 *   notifications — a league with nobody to tell is not an error.
 * @param {string} [args.title]
 * @param {string} [args.body]
 * @param {string} [args.url]
 * @param {string} [args.tag]
 */
export function broadcast({ franchiseIds, title, body, url, tag } = {}) {
  return Array.from(franchiseIds ?? [], (franchiseId) => ({
    franchiseId,
    title,
    body,
    url,
    tag,
  }));
}
