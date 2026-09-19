/**
 * The one door a Vercel cron bridge goes through to start a GitHub workflow.
 *
 * ## Why a shared door
 *
 * A cron bridge is four things in a fixed order: refuse a non-production
 * deployment, refuse a missing token, POST the dispatch, translate GitHub's
 * answer. Three routes now need all four (`api/cron/roster-sync`,
 * `api/cron/schefter-scan`, `api/cron/groupme-sync`), and the middle two of
 * those steps are the ones that must never be forgotten:
 *
 *  - **`outboundAllowed()`** — a dispatch is an outbound write one hop away.
 *    Staging and every PR preview carry PRODUCTION's `GH_PAT`, so an unguarded
 *    bridge lets a preview deployment start a workflow that commits to `main`
 *    and posts to the real GroupMe. `tests/staging-outbound-guard.test.ts`
 *    lists this file as the choke point that owns the dispatch endpoint.
 *  - **the token check** — a bridge with no `GH_PAT` must say so loudly rather
 *    than fall through to a 401 from GitHub that reads like a cron problem.
 *
 * Copying those into each route is how one of them eventually ships without
 * them. The CRON_SECRET bearer check deliberately stays in the ROUTE, not
 * here: it is the route's own front door, and
 * `tests/vercel-cron-targets.test.ts` reads each cron target's source to prove
 * it fails closed.
 *
 * `api/admin/schefter-announce.ts` is NOT a caller. It dispatches with
 * `inputs`, wraps the fetch in its own belt-and-suspenders timeout, and maps
 * 401 / 403 / 404 to distinct operator-facing copy — it is a human pressing a
 * button, not a tick, and flattening that into this helper would lose the
 * diagnostics. It holds its own guard call and its own choke-point entry.
 */

import { outboundAllowed } from './deploy-environment';

export interface WorkflowDispatchOptions {
  /** Branch (or tag) the workflow runs against. */
  ref?: string;
  /** `workflow_dispatch` inputs, if the workflow declares any. */
  inputs?: Record<string, string>;
  /** Milliseconds before the POST is abandoned. */
  timeoutMs?: number;
}

/**
 * The outcome, as a Response the route can return unchanged.
 *
 * Statuses are the bridge contract the roster sync shipped with, kept
 * identical so a monitor watching one route reads the same for all three:
 * 503 = this deployment may not dispatch, 500 = not configured, 502 = GitHub
 * refused, 200 = dispatched.
 */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Fire a `workflow_dispatch` for `workflowFile` (e.g. `roster-sync.yml`).
 *
 * Returns the Response to hand back to the caller — success and every refusal
 * alike, so a route cannot accidentally report a blocked dispatch as done.
 */
export async function dispatchWorkflow(
  workflowFile: string,
  { ref = 'main', inputs, timeoutMs = 10_000 }: WorkflowDispatchOptions = {},
): Promise<Response> {
  const token = process.env.GH_PAT;
  const owner = process.env.GH_REPO_OWNER ?? 'braven112';
  const repo = process.env.GH_REPO_NAME ?? 'mfl.football.v2';

  if (!token) {
    return json({ error: 'GH_PAT not configured' }, 500);
  }

  // The dispatch itself is a harmless POST; the workflow it starts is not. It
  // runs against `main` with Actions secrets — committing feeds, posting to
  // GroupMe, sending push to real devices. Staging and previews hold the same
  // token, so they never dispatch.
  if (!outboundAllowed()) {
    return json(
      {
        error: 'Workflow dispatch is disabled on this deployment.',
        detail:
          'Staging and preview share production credentials, so they never dispatch ' +
          `${workflowFile} — run it from production or the Actions tab.`,
      },
      503,
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          // The body IS JSON, so type it. Also what keeps this file out of
          // tests/origin-check-content-type.test.ts's allowlist: that scan
          // skips src/pages/api/ as "receivers", and this helper lives in
          // src/utils/, so it is read as browser-shaped even though it is a
          // server-to-GitHub call. An accurate header is cheaper than a hole.
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(inputs ? { ref, inputs } : { ref }),
      },
    );
  } catch (err) {
    // A thrown fetch (abort, DNS, TLS) is the same class of outcome as a 5xx
    // from GitHub, and an unhandled one would surface as a 500 from the route
    // with no hint of which hop failed.
    //
    // The cause is LOGGED, not returned. CodeQL flagged the returned form as
    // information exposure through a stack trace, and although the route is
    // behind the CRON_SECRET bearer check, the diagnostic value was never in
    // the response anyway: the only caller is a cron that does not read the
    // body, and the human debugging this reads the Vercel function log. So the
    // detail goes where it is actually useful and the body stays generic.
    console.error(`[workflow-dispatch] ${workflowFile} dispatch threw:`, err);
    return json({ error: 'GitHub dispatch failed', workflow: workflowFile }, 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return json({ error: 'GitHub API error', status: res.status, body }, 502);
  }

  return json({ success: true, triggered: workflowFile }, 200);
}
