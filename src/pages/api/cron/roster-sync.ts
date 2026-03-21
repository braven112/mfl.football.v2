/**
 * Vercel Cron → GitHub Actions bridge
 *
 * Triggers the "Roster Sync" workflow via workflow_dispatch so we get
 * precise 4-minute scheduling from Vercel while the heavy lifting
 * (MFL fetch, salary update, git commit) stays in GitHub Actions.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/roster-sync.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
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
