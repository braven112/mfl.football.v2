/**
 * Admin — Schefter announcement compose/send.
 *
 * Commissioner-only endpoint powering the "Broadcast an announcement" card on
 * the Schefter Ops dashboard. Two actions:
 *
 *   POST { action: 'preview', ... }  → returns the EXACT feed post + GroupMe
 *     text that would ship, computed from the shared core so the preview can't
 *     drift from reality. Touches nothing.
 *
 *   POST { action: 'send', ... }     → fires `workflow_dispatch` on
 *     schefter-announce.yml (with dry_run=false). The workflow writes the feed
 *     post, commits it (→ Vercel redeploy makes it visible), and pings the
 *     Schefter GroupMe bot. We dispatch rather than write here because the feed
 *     is a build-time artifact and GROUPME_SCHEFTER_BOT_ID lives only in
 *     Actions — same reason api/cron/roster-sync.ts bridges to a workflow.
 *
 * Auth: signed session JWT + isCommissionerOrAdmin (redirect/403 pattern from
 * the other admin surfaces). Requires GH_PAT (actions:write) in the runtime env.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  ANNOUNCE_TARGETS,
  announcePostId,
  buildAnnouncePost,
  buildGroupMeText,
  validateAnnounceInput,
} from '../../../utils/schefter-announce-core.mjs';

export const prerender = false;

const WORKFLOW_FILE = 'schefter-announce.yml';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Map the resolved league list back to the workflow's choice input. */
function dispatchLeaguesValue(leagues: string[]): 'theleague' | 'afl' | 'both' {
  if (leagues.length > 1) return 'both';
  return leagues[0] === 'afl' ? 'afl' : 'theleague';
}

export const POST: APIRoute = async ({ request }) => {
 try {
  const user = getAuthUser(request);
  if (!user || !isCommissionerOrAdmin(user)) {
    return json({ error: 'forbidden' }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const action = payload.action === 'send' ? 'send' : 'preview';

  const { errors, resolved } = validateAnnounceInput({
    slug: payload.slug as string | undefined,
    headline: payload.headline as string | undefined,
    body: payload.body as string | undefined,
    leagues: payload.leagues,
    link: payload.link as string | undefined,
    sendGroupMe: payload.sendGroupMe !== false,
  });
  if (errors.length) {
    return json({ error: 'validation', errors }, 400);
  }

  const { slug, headline, body, leagues, sendGroupMe, link } = resolved as {
    slug: string;
    headline: string;
    body: string;
    leagues: Array<'theleague' | 'afl'>;
    sendGroupMe: boolean;
    link: string;
  };

  // ── Preview: compute exactly what would ship; dispatch nothing. ──────────
  if (action === 'preview') {
    const timestamp = new Date().toISOString();
    const postId = announcePostId(slug);
    const previews = leagues.map((key) => {
      const target = ANNOUNCE_TARGETS[key];
      return {
        league: key,
        label: target.label,
        post: buildAnnouncePost({
          slug, headline, body, navSlug: target.navSlug, timestamp,
          link: link || undefined,
        }),
        groupMeText: sendGroupMe
          ? buildGroupMeText({ body, baseUrl: target.baseUrl, newsPath: target.newsPath, postId, link: link || undefined })
          : null,
      };
    });
    return json({ ok: true, action: 'preview', sendGroupMe, previews });
  }

  // ── Send: rate-limit, then dispatch the workflow. ───────────────────────
  const { allowed } = await checkRateLimit('schefter-announce', user.franchiseId, 10, 3600);
  if (!allowed) {
    return json({ error: 'rate-limited', message: 'Too many announcements this hour. Try again later.' }, 429);
  }

  const token = process.env.GH_PAT;
  const owner = process.env.GH_REPO_OWNER ?? 'braven112';
  const repo = process.env.GH_REPO_NAME ?? 'mfl.football.v2';
  if (!token) {
    return json({ error: 'GH_PAT not configured in the runtime environment.' }, 500);
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            slug,
            leagues: dispatchLeaguesValue(leagues),
            headline,
            body,
            link,
            send_groupme: String(sendGroupMe),
            dry_run: 'false',
          },
        }),
      },
    );
  } catch (err) {
    return json({ error: 'dispatch failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 401/403/404 from the dispatch endpoint almost always means the token,
    // not the request — surface an actionable hint instead of a raw dump.
    const hint =
      res.status === 401 || res.status === 403 || res.status === 404
        ? 'GH_PAT is likely missing the "actions: write" permission or access to this repo (GitHub returns 404 for both). Check the token in the Vercel env.'
        : undefined;
    return json({ error: 'GitHub API error', status: res.status, detail, hint }, 502);
  }

  return json({
    ok: true,
    action: 'sent',
    dispatched: WORKFLOW_FILE,
    runsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}`,
    message:
      'Announcement dispatched. The feed post lands after the run commits and the site redeploys (~1–2 min); GroupMe fires during the run.',
  });
 } catch (err) {
  // Never leak a bare platform 502 — always return a readable JSON error so the
  // admin UI can show the cause.
  return json({ error: 'server error', detail: err instanceof Error ? err.message : String(err) }, 500);
 }
};
