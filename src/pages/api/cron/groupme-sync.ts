/**
 * Vercel Cron → GitHub Actions bridge for the GroupMe poll.
 *
 * The third bridge, same shape as `api/cron/roster-sync.ts` and for the same
 * reason: GitHub drops this repo's `schedule` events in bulk, and from
 * 2026-08-27 a five-minute schedule was delivered 5-8 times a day. The poll is
 * a WATERMARKED catch-up (`getLastMessageId` → fetch since → store), so a
 * missed tick loses no message — what it costs is lateness, hours of it, in
 * the mirror the site reads the chat from.
 *
 * ## Why this one dispatches on every tick
 *
 * `groupme-sync.yml` writes nothing to the repository. It reads the group and
 * writes Redis, so a run costs one workflow run and one function invocation
 * and — unlike its two siblings — NO commit to `main`, which means no
 * production build. The tiered cadence exists to ration builds; with no build
 * to ration there is nothing to trade the freshness against, so this route has
 * no cadence gate and every tick becomes a dispatch.
 *
 * That is a claim about what the workflow does, not a general rule: if this
 * job ever grows a commit step, it inherits `sync-cadence.ts` the same day.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';

export const GET: APIRoute = async ({ request }) => {
  // Fail CLOSED on an unconfigured secret — see api/cron/roster-sync.ts. An
  // environment that merely FORGOT the variable would otherwise accept
  // `Authorization: Bearer undefined` from anyone, at a route that starts a
  // workflow holding the GroupMe service token and Redis credentials.
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

  return dispatchWorkflow('groupme-sync.yml');
};
