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
 * WHAT COUNTS AS FRESH. The newest SUCCESSFUL Roster Sync run on `main` —
 * not the newest sync commit. A healthy run that found nothing changed commits
 * nothing on purpose (`writeJsonIfChanged`), so on a quiet night MFL can go
 * four hours without a single change and the commit trail goes silent while
 * the chain is perfectly healthy. Measuring commits paged an admin at 3:34 AM
 * on 2026-10-21 for exactly that: every hourly run from 00:00 to 04:00 PT had
 * succeeded with nothing to commit. A finished run is the thing that actually
 * stops when the Vercel cron, `CRON_SECRET` or `GH_PAT` breaks — the dispatch
 * never arrives, so no run exists. A run that dispatches and goes red is
 * `push-job-failures.mjs`'s to report, which is why only `success` counts here.
 *
 * Never fails the workflow: an alerting job that goes red is one more silent
 * failure of the kind it exists to report.
 *
 * Env:
 *   GITHUB_TOKEN       required — reads the Actions runs API (actions: read)
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
 * How long since the last successful sync run before this is worth waking
 * someone for.
 *
 * The cadence floor is hourly — `sync-cadence.ts`'s `idle` tier always runs on
 * the hour, in every month of the year — so two hours without a finished run
 * means one whole tick was missed: the chain is broken, not quiet. A run takes
 * ~2 minutes, so a slow one cannot reach the threshold on its own.
 */
const STALE_AFTER_HOURS = 2;

/** The workflow the Vercel cron dispatches. */
const SYNC_WORKFLOW = 'roster-sync.yml';

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

async function latestSuccessfulRun(repo, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${SYNC_WORKFLOW}/runs` +
      '?branch=main&status=success&per_page=1',
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`workflow runs API HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.workflow_runs)) {
    throw new Error('workflow runs API returned no workflow_runs array');
  }
  return body.workflow_runs[0] ?? null;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn(`${TAG} GITHUB_REPOSITORY/GITHUB_TOKEN unset — cannot check.`);
    return;
  }

  const run = await latestSuccessfulRun(repo, token);
  if (!run) {
    // The repo has run this workflow thousands of times; none at all succeeding
    // is itself the alarm.
    console.warn(`${TAG} no successful ${SYNC_WORKFLOW} run on main — treating as stale.`);
  }

  // `updated_at` is when a completed run finished.
  const at = run?.updated_at ?? null;
  const age = at ? hoursSince(at) : Infinity;
  console.log(
    `${TAG} newest successful sync run finished: ${at ?? 'none found'}` +
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
      `No roster sync has run for ${readableAge}, so the site is frozen at the ` +
      `last deploy. Check the Vercel cron, CRON_SECRET and GH_PAT.`,
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
