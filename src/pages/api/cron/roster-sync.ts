/**
 * Vercel Cron → GitHub Actions bridge
 *
 * Triggers the "Roster Sync" workflow via workflow_dispatch so we get
 * RELIABLE scheduling from Vercel while the heavy lifting (MFL fetch,
 * salary update, git commit) stays in GitHub Actions.
 *
 * Reliable is the point, not fast. GitHub drops this repo's `schedule`
 * events in bulk — `*/5` delivered 5-8 runs a day, not 288, from 2026-08-27
 * — and because the committed feeds are baked into the build, a sync that
 * does not run is a site that cannot update. The cadence lives in
 * vercel.json; the workflow's own schedule is an offset fallback.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { outboundAllowed } from '../../../utils/deploy-environment';

export const GET: APIRoute = async ({ request }) => {
  // Verify the request is from Vercel Cron.
  //
  // Fail CLOSED on an unconfigured secret, exactly as api/cron/push-fanout.ts
  // and api/groupme/sync.ts already do. Comparing straight against
  // `Bearer ${process.env.CRON_SECRET}` reads as a check but is not one when
  // the variable is missing: the template literal becomes the literal string
  // "Bearer undefined", so an environment that merely FORGOT the variable
  // accepts `Authorization: Bearer undefined` from anyone — and this route
  // dispatches a workflow that commits to main with Actions secrets.
  //
  // This is the original of the three bridges; the other two grew the guard
  // later and nobody came back for this one. It matters more now that
  // vercel.json points a cron at it.
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

  const token = process.env.GH_PAT;
  const owner = process.env.GH_REPO_OWNER ?? 'braven112';
  const repo = process.env.GH_REPO_NAME ?? 'mfl.football.v2';

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'GH_PAT not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Same one-hop write as the announce route: this POST is harmless, but the
  // workflow it starts syncs rosters and commits to main with Actions secrets.
  // Staging holds the same GH_PAT.
  if (!outboundAllowed()) {
    return new Response(
      JSON.stringify({
        error: 'Workflow dispatch is disabled on this deployment.',
        detail:
          'Staging and preview share production credentials, so they never dispatch ' +
          'the roster sync — run it from production or the Actions tab.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/roster-sync.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    return new Response(
      JSON.stringify({ error: 'GitHub API error', status: res.status, body }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, triggered: 'roster-sync.yml' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
