/**
 * The Owners' Poll — reveal push fan-out.
 *
 * The close pass runs in GitHub Actions as a node script, and web push has to
 * be sent server-side from src/utils/push-sender.ts, which a script cannot
 * import (TypeScript). So the pass POSTs already-composed notifications here
 * and this route fans them out — the same shape as the existing Vercel-cron
 * bridge at api/cron/roster-sync.ts, and gated by the same CRON_SECRET.
 *
 * WHY PUSH AT ALL, when the reveal already goes to GroupMe: the chat post is a
 * broadcast, and broadcasts only move people who were already going to act.
 * This one is personal — where the room put YOUR team, and how your ballot
 * did. Only voters get a number, so a non-voter watching others compare theirs
 * has nothing of their own, which is a better nudge than any reminder.
 *
 * Notifications arrive fully composed. This route deliberately does NOT build
 * copy from league data: it is a transport, and keeping the wording with the
 * rest of the poll's voice (scripts/lib/owners-poll-posts.mjs) means there is
 * one place to read it.
 */

import type { APIRoute } from 'astro';
import { sendPushToFranchise, isPushConfigured } from '../../../utils/push-sender';
import { getLeagueById, getLeagueBySlug } from '../../../config/leagues';

/** Field limits, so a malformed caller cannot post a novel to every device. */
const MAX_NOTIFICATIONS = 64;
const MAX_TITLE = 120;
const MAX_BODY = 400;

interface Incoming {
  league?: string;
  notifications?: Array<{
    franchiseId?: string;
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  }>;
}

export const POST: APIRoute = async ({ request }) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  const secret = process.env.CRON_SECRET;
  // Fail CLOSED on an unconfigured secret. Without this an environment that
  // simply forgot the variable would accept `Bearer undefined` from anyone.
  if (!secret) return json({ error: 'Not configured' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!isPushConfigured()) {
    // Not an error: push is optional, and the reveal still reached GroupMe.
    return json({ ok: true, skipped: 'push not configured', sent: 0 });
  }

  let payload: Incoming;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const league =
    getLeagueBySlug(payload.league ?? '') ?? getLeagueById(payload.league ?? '');
  if (!league) return json({ error: 'Unknown league' }, 400);

  const notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
  if (notifications.length === 0) return json({ ok: true, sent: 0, recipients: 0 });
  if (notifications.length > MAX_NOTIFICATIONS) {
    return json({ error: `At most ${MAX_NOTIFICATIONS} notifications per call` }, 400);
  }

  let sent = 0;
  let recipients = 0;
  for (const n of notifications) {
    const franchiseId = typeof n.franchiseId === 'string' ? n.franchiseId.trim() : '';
    const title = typeof n.title === 'string' ? n.title.slice(0, MAX_TITLE) : '';
    const body = typeof n.body === 'string' ? n.body.slice(0, MAX_BODY) : '';
    if (!franchiseId || !title || !body) continue;

    // One push per franchise; a franchise with no subscriptions is a no-op
    // inside the sender, which never throws.
    const result = await sendPushToFranchise(league.id, franchiseId, {
      title,
      body,
      url: typeof n.url === 'string' ? n.url : undefined,
      // Same tag collapses repeats on the device, so a re-run of the close
      // pass cannot stack duplicate reveals in someone's notification tray.
      tag: typeof n.tag === 'string' ? n.tag : 'owners-poll',
    });
    sent += result.sent;
    if (result.sent > 0) recipients += 1;
  }

  return json({ ok: true, sent, recipients, attempted: notifications.length });
};
