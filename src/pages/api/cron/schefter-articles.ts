/**
 * Vercel Cron → GitHub Actions bridge for Schefter's scheduled columns.
 *
 * The fifth bridge, same shape as `api/cron/lineup-check.ts`. The workflow
 * (`schefter-articles.yml`) used to run on its own GitHub `schedule:` — seven
 * UTC crons, two of them a DST pair for the Saturday 11am PT Matchup Preview.
 * GitHub delivers this repo's scheduled events whenever it likes: the Friday
 * 2026-11-13 runs landed 5-8 hours late, and on Saturday 2026-11-14 the
 * preview and its lineup roll call never started and were run by hand.
 *
 * So this route fires on the flat tick and dispatches only on the tick a
 * column is due, read from `SCHEFTER_ARTICLE_SLOTS` (sync-cadence.ts) on the
 * league's own Pacific clock. Most ticks skip without touching GitHub.
 *
 * Two columns due on one tick are dispatched in slot order; the workflow's
 * concurrency group queues the second behind the first rather than cancelling.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';
import { schefterArticleDecision } from '../../../utils/sync-cadence';

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

  const decision = schefterArticleDecision(new Date());
  if (decision.types.length === 0) {
    return new Response(
      JSON.stringify({ skipped: true, ...decision }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Sequential, not parallel: dispatch order is queue order, and the first
  // refusal is the one worth returning.
  let last: Response | undefined;
  for (const type of decision.types) {
    last = await dispatchWorkflow('schefter-articles.yml', { inputs: { type, week: '' } });
    if (!last.ok) return last;
  }
  return last!;
};
