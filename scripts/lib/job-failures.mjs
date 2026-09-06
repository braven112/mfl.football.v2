/**
 * Pure logic for the scheduled-job failure watch (scripts/push-job-failures.mjs).
 *
 * Split out so the selection rules can be tested against fixture runs with no
 * network and no push — see tests/job-failures.test.ts. Everything here is a
 * pure function of the GitHub Actions run list plus a watermark.
 *
 * WHAT IT WATCHES AND WHY THAT SET. 25 of this repo's workflows are on a cron,
 * and until now a failing one produced exactly nothing: no post, no issue, no
 * email — a red X in a tab nobody has open. PR checks are deliberately NOT in
 * scope: those already announce themselves on the pull request, and alerting on
 * them would bury the one signal that has no other home. So the filter is
 * `event === 'schedule'`, plus manual `workflow_dispatch` runs, which are how a
 * human retries a failed cron and therefore the moment they most want to know.
 */

/** Which triggering events count as "an automation nobody is watching". */
const WATCHED_EVENTS = new Set(['schedule', 'workflow_dispatch']);

/**
 * Alerts allowed in a single run.
 *
 * When something breaks broadly — an expired MFL cookie, a dead API key —
 * every cron fails at once, and the honest report of that is one line saying so
 * rather than twenty notifications that all mean the same thing. The overflow
 * is summarized, never silently dropped.
 */
export const MAX_ALERTS = 5;

/**
 * Has this watch ever run against this repo?
 *
 * A first run has no watermark, and every failure still on GitHub's retention
 * window looks brand new — the same trap the player-news push has, where an
 * empty snapshot would open with a hundred stale alerts. The first run seeds
 * the watermark and stays quiet.
 */
export function isFirstRun(watermark) {
  return watermark == null || watermark === '';
}

/** Epoch ms for a run's completion, or 0 when it cannot be parsed. */
function completedAt(run) {
  const t = Date.parse(run?.updated_at ?? run?.run_started_at ?? '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * The failed runs worth alerting on, newest first.
 *
 * Deduped by workflow: a cron that fails every hour is ONE broken thing, and
 * the newest run is the one whose log is worth opening. Without this, a job
 * failing on a 15-minute schedule would send 96 notifications a day and the
 * category would be turned off inside a week — which is the same way a
 * default-on firehose costs push permission outright.
 */
export function selectNewFailures(runs, { watermark } = {}) {
  const since = isFirstRun(watermark) ? 0 : Date.parse(watermark);
  const floor = Number.isFinite(since) ? since : 0;

  const candidates = (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.conclusion === 'failure')
    .filter((run) => WATCHED_EVENTS.has(run?.event))
    .filter((run) => completedAt(run) > floor)
    .sort((a, b) => completedAt(b) - completedAt(a));

  const seen = new Set();
  const deduped = [];
  for (const run of candidates) {
    const key = run.workflow_id ?? run.name;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(run);
  }
  return deduped;
}

/**
 * The newest completion time in a set of runs, as an ISO string.
 *
 * This — not "now" — is the next watermark. A run that finishes while this
 * script is mid-flight would otherwise land before a `now` watermark and never
 * be alerted on, which is the silent-miss the whole job exists to prevent.
 * Returns null when there is nothing to advance to, and the caller then leaves
 * the stored watermark alone.
 */
export function nextWatermark(runs) {
  const times = (Array.isArray(runs) ? runs : []).map(completedAt).filter((t) => t > 0);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

/**
 * One notification for one failed run.
 *
 * The tag is per workflow per run id, so a re-run of the same workflow does not
 * collapse into the notification for the failure it is retrying.
 */
export function buildFailureNotification(run, { repoUrl } = {}) {
  const name = run?.name || 'A scheduled job';
  const attempt = Number(run?.run_attempt) > 1 ? ` (attempt ${run.run_attempt})` : '';
  const url = run?.html_url || (repoUrl ? `${repoUrl}/actions` : undefined);
  return {
    title: `${name} failed`,
    body: `The scheduled run failed${attempt}. Open the Actions log to see which step broke.`,
    ...(url ? { url } : {}),
    tag: `ops-job-failure-${run?.id ?? name}`,
  };
}

/**
 * The one alert that stands in for an overflowing batch.
 *
 * Named separately from `buildFailureNotification` because it reports a
 * DIFFERENT fact — "the automation is broadly broken" — and reads as such on a
 * lock screen, rather than looking like one more individual failure.
 */
export function buildOverflowNotification(count, { repoUrl } = {}) {
  return {
    title: `${count} scheduled jobs failed`,
    body: 'Several automations failed at once — usually a shared credential or an upstream outage.',
    ...(repoUrl ? { url: `${repoUrl}/actions?query=is%3Afailure` } : {}),
    tag: 'ops-job-failure-many',
  };
}

/**
 * The alerts to send for a set of failures: either one per failure, or the
 * single overflow alert once past MAX_ALERTS.
 */
export function buildAlerts(failures, { repoUrl } = {}) {
  const list = Array.isArray(failures) ? failures : [];
  if (list.length === 0) return [];
  if (list.length > MAX_ALERTS) return [buildOverflowNotification(list.length, { repoUrl })];
  return list.map((run) => buildFailureNotification(run, { repoUrl }));
}
