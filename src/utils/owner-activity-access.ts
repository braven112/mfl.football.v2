/**
 * Who may open a league's Owner Activity report.
 *
 * Every league has the report, and it is PRIVATE by default (the owner's
 * call, Oct 2026): it names which owners have gone quiet, which is not
 * something every owner should be able to read about every other one.
 *
 *   - The site's PLATFORM ADMINS (league-admin.ts) always see it, in every
 *     league, without holding a franchise there.
 *   - A league's COMMISSIONER sees it only once a platform admin has opened it
 *     to them, one league at a time. Off until someone turns it on.
 *   - Everyone else never does.
 *
 * The commissioner switch is a per-league Redis flag. Reading it fails CLOSED:
 * no Redis, a read error or a value that is not exactly "1" all mean "off",
 * so an outage can hide the report from a commissioner but never open it to
 * one who was not given it.
 */
import type { AuthUser } from './auth';
import { isCommissionerOrAdminForLeague } from './auth';
import { isPlatformAdmin } from './league-admin';
import { getRedis } from './redis-client';
import type { LeagueDefinition } from '../config/leagues';

/** Redis key holding one league's commissioner switch. Keyed by registry slug. */
export function commissionerAccessKey(slug: string): string {
  return `owner-activity:commissioner-access:${slug}`;
}

export type OwnerActivityAccess =
  | { kind: 'login' }
  | { kind: 'forbidden' }
  /** `canManage`: may flip the commissioner switch (platform admins only). */
  | { kind: 'allow'; canManage: boolean };

/**
 * The decision itself, with the switch already read. Pure, so the rule is
 * tested without Redis.
 */
export function decideOwnerActivityAccess(
  user: AuthUser | null | undefined,
  league: Pick<LeagueDefinition, 'id'>,
  commissionerAccess: boolean,
): OwnerActivityAccess {
  if (!user) return { kind: 'login' };
  if (isPlatformAdmin(user)) return { kind: 'allow', canManage: true };
  // League-scoped: another league's commissioner session is never this
  // league's commissioner, even with the switch on.
  if (commissionerAccess && isCommissionerOrAdminForLeague(user, league.id)) {
    return { kind: 'allow', canManage: false };
  }
  return { kind: 'forbidden' };
}

/** Has a platform admin opened this league's report to its commissioner? */
export async function getCommissionerAccess(slug: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    const value = await redis.get(commissionerAccessKey(slug));
    return value === '1' || value === 1;
  } catch {
    return false;
  }
}

/** Turn a league's commissioner access on or off. Throws if storage is down. */
export async function setCommissionerAccess(slug: string, on: boolean): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error('Settings storage is unavailable.');
  if (on) await redis.set(commissionerAccessKey(slug), '1');
  else await redis.del(commissionerAccessKey(slug));
}

/** The gate a route asks. Reads the switch only when it could matter. */
export async function resolveOwnerActivityAccess(
  user: AuthUser | null | undefined,
  league: LeagueDefinition,
): Promise<OwnerActivityAccess> {
  if (!user || isPlatformAdmin(user)) return decideOwnerActivityAccess(user, league, false);
  if (!isCommissionerOrAdminForLeague(user, league.id)) return { kind: 'forbidden' };
  return decideOwnerActivityAccess(user, league, await getCommissionerAccess(league.slug));
}
