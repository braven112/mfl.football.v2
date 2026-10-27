/**
 * Vercel Cron → the one-minute MFL checker for app alerts (push-watch.ts).
 *
 * Unlike the four bridges beside it, this route does its work in-process: it
 * dispatches no workflow and commits nothing, so it costs no build and cannot
 * collide with a job that pushes (tests/vercel-cron-targets.test.ts,
 * IN_PROCESS_CRONS). It reads MFL for the leagues app phones are registered in
 * and sends the alerts; that is all.
 *
 * Vercel runs crons on production only, and push-sender's outbound guard keeps
 * any other deploy from reaching a real phone besides.
 *
 * Required env vars:
 *   CRON_SECRET – shared secret Vercel sends as Bearer token
 */

import type { APIRoute } from 'astro';
import { getRedis } from '../../../utils/redis-client';
import { runPushWatch } from '../../../utils/push-watch';

/** A run that overlaps the next minute's would read and alert twice. */
const LOCK_KEY = 'push:watch:lock';
const LOCK_SECONDS = 55;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  // Fail CLOSED on an unconfigured secret — see api/cron/schefter-scan.ts.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'CRON_SECRET not configured' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const redis = await getRedis();
  if (!redis) return json({ ok: true, skipped: 'no redis' });
  const claimed = await redis.set(LOCK_KEY, Date.now(), { nx: true, ex: LOCK_SECONDS });
  if (!claimed) return json({ ok: true, skipped: 'previous run still going' });

  try {
    const run = await runPushWatch();
    const sent = run.results.reduce((n, r) => n + r.sent, 0);
    return json({ ok: true, leagues: run.leagues, checked: run.results.length, unfinished: run.unfinished, sent });
  } finally {
    await redis.del(LOCK_KEY).catch(() => undefined);
  }
};
