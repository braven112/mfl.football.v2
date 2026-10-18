/**
 * Which Sleeper account an MFL Live viewer has linked.
 *
 * Keyed by the MFL USERNAME (lower-cased, hashed), never by `user.id`: that
 * field is the owner's MFL cookie — a credential, and one that can change
 * between sign-ins — so it is neither safe nor stable as a storage key. The
 * username is what the owner typed at sign-in and is the same on every device.
 *
 * What is stored is what Sleeper itself told us when the link was made: the
 * numeric user id (the lookup key for every later read) plus the display name
 * and avatar the settings page shows back. Never a password — Sleeper's API
 * needs none.
 *
 * Redis down → no link, which renders as "not linked" rather than as an
 * error; the board simply shows MFL leagues alone.
 */

import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth';
import { getRedis } from '../redis-client';

export interface SleeperLink {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  linkedAt: string;
}

/** One season and change; re-linking is one form post. */
const TTL_S = 400 * 24 * 60 * 60;

/**
 * A stable, non-reversible id for the MFL Live viewer: the hashed, lower-cased
 * MFL username. Also who a crowd player fix is credited to (`player-fixes.ts`),
 * so two fixes from one account always count as one owner.
 */
export function sleeperViewerKey(user: Pick<AuthUser, 'name'>): string | null {
  const account = String(user.name ?? '').trim().toLowerCase();
  if (!account) return null;
  return createHash('sha256').update(account).digest('hex').slice(0, 32);
}

export function sleeperLinkKey(user: Pick<AuthUser, 'name'>): string | null {
  const viewer = sleeperViewerKey(user);
  return viewer ? `live:sleeper:link:${viewer}` : null;
}

export async function getSleeperLink(user: Pick<AuthUser, 'name'>): Promise<SleeperLink | null> {
  const key = sleeperLinkKey(user);
  if (!key) return null;
  const redis = await getRedis().catch(() => null);
  const value = await redis?.get<SleeperLink>(key).catch(() => null);
  return value && typeof value.userId === 'string' && value.userId ? value : null;
}

export async function setSleeperLink(
  user: Pick<AuthUser, 'name'>,
  link: Omit<SleeperLink, 'linkedAt'>,
): Promise<boolean> {
  const key = sleeperLinkKey(user);
  const redis = await getRedis().catch(() => null);
  if (!key || !redis) return false;
  try {
    await redis.set(key, { ...link, linkedAt: new Date().toISOString() }, { ex: TTL_S });
    return true;
  } catch {
    return false;
  }
}

export async function clearSleeperLink(user: Pick<AuthUser, 'name'>): Promise<boolean> {
  const key = sleeperLinkKey(user);
  const redis = await getRedis().catch(() => null);
  if (!key || !redis) return false;
  try {
    await redis.del(key);
    return true;
  } catch {
    return false;
  }
}
