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
 */

import { leagueUrl } from '../../src/config/leagues-data.mjs';

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
    return { sent: 0, skipped: 'nothing to send' };
  }
  if (!category) throw new TypeError('sendPushFanout: a `category` is required.');
  if (dryRun) {
    log.log?.(`  [dry-run] Would push ${category} to ${notifications.length} owner(s).`);
    return { sent: 0, skipped: 'dry-run' };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.warn?.(`  [push] CRON_SECRET not set — skipping ${category} push.`);
    return { sent: 0, skipped: 'no secret' };
  }

  // The origin comes from the league registry, which is the single source of
  // truth for it — never concatenated by hand, never a workflow variable.
  const base = leagueUrl(league, '').replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/api/cron/push-fanout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        league: league.slug,
        notifications: notifications.map((n) => ({ ...n, category })),
      }),
    });
    if (!res.ok) {
      log.warn?.(`  [push] ${category} fan-out failed: HTTP ${res.status}`);
      return { sent: 0, skipped: `http ${res.status}` };
    }
    const data = await res.json();
    log.log?.(`  [push] ${category} → ${data.recipients ?? 0} owners (${data.sent ?? 0} devices).`);
    return data;
  } catch (err) {
    log.warn?.(`  [push] ${category} fan-out failed: ${err.message}`);
    return { sent: 0, skipped: err.message };
  }
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
