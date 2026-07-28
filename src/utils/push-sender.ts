/**
 * Web push sender — wraps the `web-push` package (server-side ONLY).
 *
 * VAPID keys come from process.env (set in Vercel, pulled locally via
 * `vercel env pull`; generate with `pnpm generate:vapid`):
 *   - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (server signing pair)
 *   - VAPID_SUBJECT                          (optional contact URL)
 *
 * `web-push` is dynamically imported so it never lands in a client bundle
 * and a missing/broken install degrades the feature instead of crashing
 * the route (same pattern as redis-client's '@upstash/redis' import).
 *
 * Dead subscriptions (push service answered 404/410) are pruned from
 * storage automatically after each send.
 */

import { getSubscriptions, pruneSubscriptions } from './push-subscriptions';

export interface PushPayload {
  title: string;
  body: string;
  /** Site-relative URL to open when the notification is clicked. */
  url?: string;
  /** Notification tag — pushes with the same tag collapse into one. */
  tag?: string;
  /** Icon URL (site-relative). Defaults in the service worker. */
  icon?: string;
}

export interface PushSendResult {
  /** Notifications accepted by the push service. */
  sent: number;
  /** Sends that failed for transient reasons (kept for retry next time). */
  failed: number;
  /** Dead subscriptions removed from storage (404/410). */
  pruned: number;
  /** Subscriptions on file before sending. */
  total: number;
}

/** True when both server-side VAPID keys are configured. */
export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Send one payload to every stored subscription of a franchise.
 * Never throws — an unconfigured/broken push stack returns zeros.
 */
export async function sendPushToFranchise(
  leagueId: string,
  franchiseId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, failed: 0, pruned: 0, total: 0 };
  if (!isPushConfigured()) return result;

  let webpush: typeof import('web-push') | null = null;
  try {
    const mod = await import('web-push');
    webpush = (mod.default ?? mod) as typeof import('web-push');
  } catch (e) {
    console.warn('[push-sender] web-push unavailable:', e);
    return result;
  }

  const subs = await getSubscriptions(leagueId, franchiseId);
  result.total = subs.length;
  if (subs.length === 0) return result;

  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@theleague.us';
  const options = {
    vapidDetails: {
      subject,
      publicKey: process.env.VAPID_PUBLIC_KEY as string,
      privateKey: process.env.VAPID_PRIVATE_KEY as string,
    },
    TTL: 60 * 60 * 24, // give offline devices a day to pick it up
  };
  const body = JSON.stringify(payload);

  const deadEndpoints: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush!.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          options,
        );
        result.sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        } else {
          result.failed += 1;
          console.warn(
            `[push-sender] send failed (status ${statusCode ?? 'n/a'}) for franchise ${franchiseId}`,
          );
        }
      }
    }),
  );

  if (deadEndpoints.length > 0) {
    result.pruned = deadEndpoints.length;
    await pruneSubscriptions(leagueId, franchiseId, deadEndpoints);
  }

  return result;
}
