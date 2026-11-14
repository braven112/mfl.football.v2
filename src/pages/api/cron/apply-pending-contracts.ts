/**
 * Vercel Cron → GitHub Actions bridge for `apply-pending-contracts.yml` (owners' contract declarations).
 *
 * Same shape as `api/cron/lineup-check.ts`. The workflow used to run on its
 * own GitHub `schedule:`, which GitHub delivers late or not at all for this
 * repo (2026-11-13: 5-8 hours late; 2026-11-14: the Saturday job never
 * started). This route fires on the flat tick and dispatches on the job's
 * slots from `INTERVAL_JOBS` (sync-cadence.ts). The workflow has no
 * `schedule:` of its own; a second trigger collides with this one.
 *
 * The dispatch passes the inputs a scheduled run used to imply. A bare
 * dispatch would take the workflow's MANUAL defaults, which are dry runs.
 *
 * Required env vars: CRON_SECRET, GH_PAT (actions:write), GH_REPO_OWNER,
 * GH_REPO_NAME — see api/cron/lineup-check.ts.
 */

import type { APIRoute } from 'astro';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';
import { intervalJobDecision } from '../../../utils/sync-cadence';

export const GET: APIRoute = async ({ request }) => {
  // Fail CLOSED on an unconfigured secret — see api/cron/schefter-scan.ts.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const decision = intervalJobDecision('apply-pending-contracts', new Date());
  if (!decision.dispatch) {
    return new Response(
      JSON.stringify({ skipped: true, ...decision }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return dispatchWorkflow('apply-pending-contracts.yml', { inputs: { dry_run: 'false' } });
};
