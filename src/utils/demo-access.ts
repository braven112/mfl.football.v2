/**
 * Access to the custom-site demo (docs/plans/custom-site-demo.md): a private,
 * expiring link per prospect, no password.
 *
 *   https://demo.mfl.football/dynasty/demo-start?t=<token>
 *
 * The token lives in the demo deployment's OWN Redis (production's is scrubbed
 * from a demo process — demo-isolation-core.mjs) as `demo:tokens:<token>`, with
 * a TTL equal to the link's life. Opening the link lets the prospect pick any
 * franchise; that mints an ordinary owner session for the demo league whose
 * user id is `demo:<token>` and whose expiry is the link's. Everything a
 * prospect does is keyed by that id, so two prospects never see each other's
 * moves, and a session can never outlive its link.
 *
 * A demo session cannot authorize anything real: the demo signs sessions with
 * its own JWT secret, and every real MFL call from a demo process is answered
 * by the demo stand-in.
 */

import { getRedis } from './redis-client';
import {
  buildDemoLink,
  DEFAULT_DEMO_DAYS,
  DEMO_START_PATH,
  DEMO_TOKEN_PREFIX,
  DEMO_USER_PREFIX,
  isWellFormedDemoToken,
} from './demo-access-core.mjs';

export { DEFAULT_DEMO_DAYS, DEMO_START_PATH, DEMO_TOKEN_PREFIX, DEMO_USER_PREFIX };

export interface DemoLink {
  token: string;
  /** Which pre-built demo league the link opens. */
  type: 'dynasty';
  /** Who it was issued to — for the owner, never shown to other prospects. */
  label: string;
  createdAt: number;
  /** Unix seconds. */
  expiresAt: number;
  leadId?: string;
}

/** The demo token behind a session user id, or null for a non-demo session. */
export function demoTokenFromUserId(userId: string | null | undefined): string | null {
  if (!userId || !userId.startsWith(DEMO_USER_PREFIX)) return null;
  const token = userId.slice(DEMO_USER_PREFIX.length);
  return isWellFormedDemoToken(token) ? token : null;
}

export async function createDemoLink(
  { label, days = DEFAULT_DEMO_DAYS, leadId }: { label: string; days?: number; leadId?: string },
  now = Math.floor(Date.now() / 1000),
): Promise<DemoLink> {
  const redis = await getRedis();
  if (!redis) throw new Error('Demo links need the demo Redis (DEMO_REDIS_REST_URL / DEMO_REDIS_REST_TOKEN).');
  const link: DemoLink = buildDemoLink({ label, days, leadId }, now) as DemoLink;
  await redis.set(`${DEMO_TOKEN_PREFIX}${link.token}`, JSON.stringify(link), { ex: link.expiresAt - now });
  return link;
}

/** The live link for a token, or null when unknown, malformed, or expired. */
export async function lookupDemoLink(token: unknown, now = Math.floor(Date.now() / 1000)): Promise<DemoLink | null> {
  if (!isWellFormedDemoToken(token)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${DEMO_TOKEN_PREFIX}${token}`);
  if (!raw) return null;
  const link = (typeof raw === 'string' ? JSON.parse(raw) : raw) as DemoLink;
  return link.expiresAt > now ? link : null;
}

/** Push a link's expiry out by `days` from now (or from its current end, whichever is later). */
export async function extendDemoLink(token: string, days: number, now = Math.floor(Date.now() / 1000)): Promise<DemoLink | null> {
  if (!isWellFormedDemoToken(token)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${DEMO_TOKEN_PREFIX}${token}`);
  if (!raw) return null;
  const link = (typeof raw === 'string' ? JSON.parse(raw) : raw) as DemoLink;
  link.expiresAt = Math.max(link.expiresAt, now) + Math.round(days * 86_400);
  await redis.set(`${DEMO_TOKEN_PREFIX}${token}`, JSON.stringify(link), { ex: link.expiresAt - now });
  return link;
}

/** End a link now. Its sessions stop working on their next request (middleware checks the link). */
export async function revokeDemoLink(token: string): Promise<boolean> {
  if (!isWellFormedDemoToken(token)) return false;
  const redis = await getRedis();
  if (!redis) return false;
  await redis.del(`${DEMO_TOKEN_PREFIX}${token}`);
  return true;
}
