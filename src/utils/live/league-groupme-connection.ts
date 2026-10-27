/**
 * Which GroupMe group an MFL league's Chat tab shows, when an owner connected
 * one in the MFL Football app (plan doc decision 19, step 3).
 *
 * Any owner, for now (recommended to the owner 2026-10-27): the app cannot yet tell
 * who a league's commissioner is in someone else's MFL league, so any owner in
 * the league may connect a group they are a member of, or switch the tab back
 * to MFL chat, and the tab says who connected it. Narrow it to commissioners
 * here once that check exists.
 *
 * The group is read with the CONNECTING owner's own GroupMe sign-in
 * (groupme-owner-auth.ts) — the service token is in no such group — so the
 * row names their account, never holds a token itself.
 *
 *   mfl-live:groupme-league:{mflLeagueId} → LeagueGroupMeConnection
 *
 * Keyed by MFL league id: the app serves any MFL league, and every league has
 * a franchise 0001.
 */

import { getRedis } from '../redis-client';

export interface LeagueGroupMeConnection {
  groupId: string;
  groupName: string;
  /** pushAccountKey of the owner whose sign-in reads the group. */
  account: string;
  franchiseId: string;
  franchiseName: string;
  connectedAt: string;
}

export function leagueConnectionKey(leagueId: string): string {
  return `mfl-live:groupme-league:${leagueId}`;
}

export async function readLeagueConnection(leagueId: string): Promise<LeagueGroupMeConnection | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const raw = await redis.get(leagueConnectionKey(leagueId));
    const row = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<LeagueGroupMeConnection> | null;
    if (!row || typeof row !== 'object') return null;
    // Group ids are all digits; Upstash may hand one back as a number.
    const groupId = row.groupId == null ? '' : `${row.groupId}`;
    if (!groupId || typeof row.account !== 'string') return null;
    return {
      groupId,
      groupName: `${row.groupName ?? ''}`,
      account: row.account,
      franchiseId: `${row.franchiseId ?? ''}`,
      franchiseName: `${row.franchiseName ?? ''}`,
      connectedAt: `${row.connectedAt ?? ''}`,
    };
  } catch {
    return null;
  }
}

export async function saveLeagueConnection(leagueId: string, row: LeagueGroupMeConnection): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    await redis.set(leagueConnectionKey(leagueId), JSON.stringify(row));
    return true;
  } catch {
    return false;
  }
}

/** Back to MFL's own chat. */
export async function removeLeagueConnection(leagueId: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    await redis.del(leagueConnectionKey(leagueId));
    return true;
  } catch {
    return false;
  }
}
