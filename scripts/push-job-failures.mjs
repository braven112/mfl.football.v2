#!/usr/bin/env node
/**
 * Tell the admins when a scheduled job failed.
 *
 * THE GAP THIS CLOSES: 25 of this repo's workflows run on a cron, and a failing
 * one used to produce nothing at all — three of them open a GitHub issue, the
 * rest just go red in a tab nobody has open. That is how a monitor stops
 * monitoring without anyone noticing, which is the exact failure the deleted
 * gameday health check documented on its way out (see
 * docs/claude/insights/features/live-scoring.md, 2026-09-03).
 *
 * WHY POLLING RATHER THAN `workflow_run`. A `workflow_run` trigger has to name
 * the workflows it watches, so every new cron would need adding to a list —
 * a registry that drifts silently, and drifts in the direction of LESS
 * coverage. Polling the runs API needs no list and cannot go stale.
 *
 * WHERE THE ALERT GOES: push, to the default league's admin franchises, under
 * the `ops-job-failure` category. Not the group chat: eleven owners cannot fix
 * a cron. Not both leagues either — the same human is admin of both, and the
 * failures are repo-wide rather than league-scoped, so addressing both leagues
 * would just notify one person twice.
 *
 * Never fails the workflow. An alerting job that goes red is one more silent
 * failure of exactly the kind it exists to report.
 *
 * Env:
 *   GITHUB_TOKEN     required — reads the Actions runs API
 *   GITHUB_REPOSITORY  owner/repo (set by Actions)
 *   CRON_SECRET      required to push; unset logs and sends nothing
 *   UPSTASH_*        watermark storage; unset degrades to a 3h lookback, never silence
 *
 * Usage:
 *   node scripts/push-job-failures.mjs
 *   node scripts/push-job-failures.mjs --dry-run   # prints, never sends or writes
 */

import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { sendOpsAlert } from './lib/ops-alert.mjs';
import {
  allDelivered,
  buildAlerts,
  isFirstRun,
  nextWatermark,
  selectNewFailures,
} from './lib/job-failures.mjs';

const TAG = '[job-failures]';
const DRY_RUN = process.argv.includes('--dry-run');
const WATERMARK_KEY = 'ops:job-failure:watermark';

/**
 * How far back to look when the watermark is unavailable.
 *
 * The watermark is an OPTIMIZATION, not the mechanism. Treating "no Redis" as
 * a first run made the watcher permanently silent — indistinguishable from a
 * healthy repo, which is the precise failure this job exists to prevent, now
 * built into the job itself. Treating a read ERROR as the epoch was the
 * opposite failure: weeks of already-fixed runs re-qualify at once and, past
 * MAX_ALERTS, collapse into a false "several automations failed" alert.
 *
 * A bounded lookback answers both. Wider than the hourly cadence so a skipped
 * run is still covered, narrow enough that a stale floor cannot resurrect old
 * history. Per-workflow dedup keeps the worst case to one alert per workflow.
 */
const FALLBACK_LOOKBACK_MS = 3 * 60 * 60 * 1000;

const lookbackFloor = () => new Date(Date.now() - FALLBACK_LOOKBACK_MS).toISOString();

/** How many recent runs to consider. Comfortably more than an hour produces. */
const RUNS_PER_PAGE = 60;

async function readWatermark() {
  const config = getRedisConfig();
  if (!config) {
    // NOT a first run — see FALLBACK_LOOKBACK_MS. Storage being absent must
    // degrade the watch, never silence it.
    console.warn(`${TAG} no Redis config — falling back to a ${FALLBACK_LOOKBACK_MS / 3600000}h lookback.`);
    return lookbackFloor();
  }
  try {
    return await redisCommand(config, ['GET', WATERMARK_KEY]);
  } catch (err) {
    console.warn(`${TAG} watermark read failed: ${err.message} — using the lookback window.`);
    return lookbackFloor();
  }
}

async function writeWatermark(value) {
  const config = getRedisConfig();
  if (!config || !value) return;
  try {
    await redisCommand(config, ['SET', WATERMARK_KEY, value]);
  } catch (err) {
    console.warn(`${TAG} watermark write failed: ${err.message}`);
  }
}

async function fetchFailedRuns(repo, token) {
  const url =
    `https://api.github.com/repos/${repo}/actions/runs`
    + `?status=failure&per_page=${RUNS_PER_PAGE}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`Actions API ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn(`${TAG} GITHUB_REPOSITORY/GITHUB_TOKEN unset — nothing to do.`);
    return;
  }

  const runs = await fetchFailedRuns(repo, token);
  const watermark = await readWatermark();

  // Seed and stay quiet. Everything on GitHub's retention window is "new" to a
  // watch that has never run, and opening with twenty alerts for failures that
  // were already dealt with teaches the reader to swipe the category away.
  if (isFirstRun(watermark)) {
    // `?? now` matters: with no failed runs at all, nextWatermark is null, the
    // watermark stays unset, and the NEXT run is a first run too — so the
    // first real failure would be consumed as a seed instead of alerted on.
    const seed = nextWatermark(runs) ?? new Date().toISOString();
    console.log(`${TAG} first run — seeding watermark at ${seed} and staying quiet.`);
    if (!DRY_RUN) await writeWatermark(seed);
    return;
  }

  const failures = selectNewFailures(runs, { watermark });
  if (failures.length === 0) {
    console.log(`${TAG} no new scheduled-job failures since ${watermark}.`);
    return;
  }

  const league = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
  const alerts = buildAlerts(failures);
  console.log(`${TAG} ${failures.length} new failure(s) → ${alerts.length} alert(s):`);
  for (const run of failures) console.log(`  - ${run.name} (${run.html_url})`);

  // `sendOpsAlert` never throws — a push outage comes back as `{ skipped }`
  // (no secret, HTTP 5xx, no admin franchises). Advancing the watermark on
  // that result would mark an UNDELIVERED failure as reported and lose it
  // permanently, which is what the "advance only after the sends" comment
  // claimed to prevent while actually ignoring the return value.
  const results = [];
  for (const alert of alerts) {
    const result = await sendOpsAlert({
      league,
      category: 'ops-job-failure',
      dryRun: DRY_RUN,
      ...alert,
    });
    if (result?.skipped) console.warn(`${TAG} alert not delivered (${result.skipped}).`);
    results.push(result);
  }
  const delivered = allDelivered(results);

  // Held on a failed send, so the next run re-reports. Re-sending a failure is
  // cheap and collapses on the device by tag; dropping one is silent.
  if (!DRY_RUN && delivered) await writeWatermark(nextWatermark(failures) ?? watermark);
}

main().catch((err) => {
  // Deliberately exit 0: see the header. A red X here is one more unwatched
  // failure, and this job's own failure would be reported by... this job.
  console.error(`${TAG} failed: ${err.message}`);
});
