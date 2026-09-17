#!/usr/bin/env node
/**
 * Tell the admins when the roster sync has STOPPED — not failed, stopped.
 *
 * THE GAP THIS CLOSES. `push-job-failures.mjs` next door catches a scheduled
 * job that ran and went red. It cannot catch a job that never ran at all,
 * because absence produces no failed run to find. That is precisely the shape
 * of the 2026-09-16 outage: GitHub quietly stopped delivering this repo's
 * `schedule` events on 2026-08-27, nothing failed, no check went red, and the
 * site drifted hours behind the league for three weeks until an owner noticed
 * it was an hour past waivers still showing pre-waiver rosters.
 *
 * The sync now runs off a Vercel cron (`vercel.json` → `api/cron/roster-sync`),
 * which removes GitHub's scheduler from the critical path. It does not remove
 * the failure MODE: a rotated `CRON_SECRET`, an expired `GH_PAT`, a dropped
 * `crons` entry or a Vercel incident all stop the sync exactly as silently.
 *
 * WHY THIS RUNS ON GITHUB, NOT ON THE VERCEL CRON. A watchdog on the same
 * substrate as the thing it watches dies with it. A Vercel-cron health check
 * would be dark for precisely the outage it exists to report — the same flaw
 * this repo already has in the other direction, where `job-failure-watch.yml`
 * rides the GitHub scheduler it is meant to police. Running here means the two
 * mechanisms cover each other: GitHub's delivery is unreliable, so detection
 * may be hours late, but late detection of a dead sync still beats none, and
 * "eventually" is guaranteed in a way "never" is not.
 *
 * WHAT COUNTS AS FRESH. The newest commit on `main` from the sync bot. That is
 * the honest signal rather than "did the workflow run", because a run that
 * fetched nothing and committed nothing leaves the SITE unchanged — and the
 * site is what owners see. The committed feeds are baked into the build, so no
 * commit means no deploy means the page cannot move.
 *
 * Never fails the workflow: an alerting job that goes red is one more silent
 * failure of the kind it exists to report.
 *
 * Env:
 *   GITHUB_TOKEN       required — reads the commits API
 *   GITHUB_REPOSITORY  owner/repo (set by Actions)
 *   CRON_SECRET        required to push; unset logs and sends nothing
 *
 * Usage:
 *   node scripts/check-sync-freshness.mjs
 *   node scripts/check-sync-freshness.mjs --dry-run
 */

import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { sendOpsAlert } from './lib/ops-alert.mjs';

const TAG = '[sync-freshness]';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * How stale `main` may get before this is worth waking someone for.
 *
 * The cadence floor is hourly — `sync-cadence.ts`'s `idle` tier always runs on
 * the hour, in every month of the year — so anything past two hours means the
 * chain is broken rather than quiet. Two hours also clears a slow build and a
 * genuinely unchanged hour without crying wolf.
 */
const STALE_AFTER_HOURS = 2;

/** The committer the sync workflow pushes as. */
const SYNC_AUTHOR = 'Roster Sync Bot';

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

async function latestSyncCommit(repo, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits?sha=main&per_page=40`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`commits API HTTP ${res.status}`);
  const commits = await res.json();
  if (!Array.isArray(commits)) throw new Error('commits API returned a non-array');
  return (
    commits.find((c) => c?.commit?.author?.name === SYNC_AUTHOR) ?? null
  );
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn(`${TAG} GITHUB_REPOSITORY/GITHUB_TOKEN unset — cannot check.`);
    return;
  }

  const commit = await latestSyncCommit(repo, token);
  if (!commit) {
    // Forty commits deep with no sync commit is itself the alarm: on a healthy
    // day the sync is the most common commit on main by a wide margin.
    console.warn(`${TAG} no sync commit in the last 40 on main — treating as stale.`);
  }

  const at = commit?.commit?.author?.date ?? null;
  const age = at ? hoursSince(at) : Infinity;
  console.log(
    `${TAG} newest sync commit: ${at ?? 'none found'}` +
      (Number.isFinite(age) ? ` (${age.toFixed(1)}h ago)` : ''),
  );

  if (age <= STALE_AFTER_HOURS) {
    console.log(`${TAG} fresh — under the ${STALE_AFTER_HOURS}h threshold.`);
    return;
  }

  const league = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
  const readableAge = Number.isFinite(age) ? `${age.toFixed(1)} hours` : 'an unknown time';
  const result = await sendOpsAlert({
    league,
    category: 'ops-job-failure',
    dryRun: DRY_RUN,
    title: 'Roster sync has stopped',
    body:
      `No roster sync has landed on main for ${readableAge}. The site is frozen ` +
      `at the last deploy. Check the Vercel cron, CRON_SECRET and GH_PAT.`,
    // NO `url`, matching buildFailureNotification next door: the service worker
    // takes `data.url` only when it startsWith('/'), so a push cannot send a
    // tap off-site and an absolute GitHub link would silently open the
    // homepage instead. tests/push-notification-urls.test.ts pins that.
    // The destination lives in the body text, where it survives.
    // Stable tag so repeat alerts collapse on the device into one notification
    // rather than stacking hourly while the outage is being fixed.
    tag: 'ops-sync-stale',
  });
  if (result?.skipped) console.warn(`${TAG} alert not delivered (${result.skipped}).`);
}

main().catch((err) => {
  // Deliberately exit 0 — see the header.
  console.error(`${TAG} check failed: ${err.message}`);
});
