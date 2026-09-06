/**
 * Send an operations alert to a league's admins — and to nobody else.
 *
 * WHY THIS EXISTS: the league's plumbing used to talk in the group chat. A
 * failed cron or a drifted MFL setting is an action item for one person and
 * noise for the other eleven, and the chat is capped at one automated post a
 * day (`groupme-capped.mjs`) — a budget that should be spent on owners, not on
 * telling them a sync died. These alerts now go out as push, to the admin
 * franchises only, under the `ops` notification group an admin can turn off
 * per category like anything else.
 *
 * ADMIN-NESS IS RESOLVED TWICE, ON PURPOSE. Here, to decide who to address;
 * and again server-side in `sendPushToFranchise`, which recomputes it from the
 * franchise id and refuses an `adminOnly` category for anyone else. This side
 * picks the recipients, the server decides what may reach them — so a bug in
 * this file can silence an alert but can never broadcast one to the league.
 *
 * The admin list is `adminFranchiseIds` in src/config/nav-config.json, read
 * directly rather than through src/config/nav-config.ts: that module is
 * TypeScript with a JSON import assertion and a node script cannot load it.
 * The JSON is the same source of truth either way, which is the point — a
 * second hardcoded list of admin franchises is how one league's admin ends up
 * receiving the other league's alerts.
 */

import { createRequire } from 'node:module';

import { sendPushFanout } from './push-fanout.mjs';

const require = createRequire(import.meta.url);
const navConfig = require('../../src/config/nav-config.json');

/**
 * The admin franchise ids for a league, by its NAV slug.
 *
 * Nav slugs and registry slugs are not the same string — the AFL is
 * `afl-fantasy` in the registry and `afl` in nav-config — so passing the wrong
 * one returns an empty list and the alert silently reaches nobody. Callers
 * pass the registry entry and this reads `navSlug` off it rather than making
 * each caller remember which slug this file wants.
 *
 * @param {{ navSlug?: string }} league Registry entry.
 * @returns {string[]}
 */
export function adminFranchiseIds(league) {
  const slug = league?.navSlug;
  if (!slug) return [];
  const ids = navConfig?.adminFranchiseIds?.[slug];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
}

/**
 * Push one alert to every admin franchise of a league.
 *
 * Returns the fan-out result, plus `skipped: 'no admins'` when the league has
 * no admin franchises configured — a case worth reporting rather than
 * swallowing, because it looks identical to a healthy quiet run from the
 * outside and would hide every future alert for that league.
 *
 * @param {object} args
 * @param {object} args.league Registry entry.
 * @param {string} args.category An `adminOnly` notification category id.
 * @param {string} args.title
 * @param {string} args.body
 * @param {string} [args.url] Site-relative link to open.
 * @param {string} [args.tag] Pushes sharing a tag collapse into one.
 * @param {boolean} [args.dryRun]
 * @param {{ log?: (...args: any[]) => void, warn?: (...args: any[]) => void }} [args.log]
 */
export async function sendOpsAlert({ league, category, title, body, url, tag, dryRun = false, log }) {
  const franchiseIds = adminFranchiseIds(league);
  if (franchiseIds.length === 0) {
    log?.warn?.(`  [ops-alert] no admin franchises for ${league?.slug ?? 'unknown league'}.`);
    return { sent: 0, skipped: 'no admins' };
  }

  return sendPushFanout({
    league,
    category,
    dryRun,
    ...(log ? { log } : {}),
    notifications: franchiseIds.map((franchiseId) => ({
      franchiseId,
      title,
      body,
      ...(url ? { url } : {}),
      ...(tag ? { tag } : {}),
    })),
  });
}
