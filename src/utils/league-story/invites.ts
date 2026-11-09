/**
 * League story intake — INVITES. The form is not open to the public (Brandon,
 * 2026-11-08: "I don't want random people to fill it out either. I need to
 * ask them"). The admin makes a link per league on /live/league-stories; only
 * a request carrying a live invite token sees the form or can save answers.
 *
 * One Redis key per invite (`league-story:invite:<token>`, expiring after
 * INVITE_TTL_DAYS) plus a list of tokens for the admin page. The token is 24
 * random bytes, so it cannot be guessed; it is a capability, not an identity.
 * SERVER ONLY.
 */
import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';

export const INVITE_KEY_PREFIX = 'league-story:invite:';
export const INVITES_LIST_KEY = 'league-story:invites';
export const INVITE_TTL_DAYS = 120;
export const MAX_INVITES = 500;

export interface LeagueStoryInvite {
  token: string;
  league: string;
  createdAt: string;
  /** Set when the league sends its answers. A league may send again to add more. */
  submittedAt: string | null;
}

/** A token is base64url of 24 bytes: 32 characters. Anything else is not one of ours. */
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);
}

export async function createInvite(league: string, now = new Date()): Promise<LeagueStoryInvite | null> {
  const redis = await getRedis();
  if (!redis) return null;
  if ((await redis.llen(INVITES_LIST_KEY)) >= MAX_INVITES) return null;
  const name = league.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  if (name.length < 2) return null;
  const invite: LeagueStoryInvite = { token: randomBytes(24).toString('base64url'), league: name, createdAt: now.toISOString(), submittedAt: null };
  await redis.set(INVITE_KEY_PREFIX + invite.token, JSON.stringify(invite), { ex: INVITE_TTL_DAYS * 86_400 });
  await redis.lpush(INVITES_LIST_KEY, invite.token);
  return invite;
}

function parse(raw: unknown): LeagueStoryInvite | null {
  try {
    const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as LeagueStoryInvite | null;
    return v && isInviteTokenShape(v.token) && typeof v.league === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The live invite for this token, or null (unknown, expired, malformed, or storage down). */
export async function getInvite(token: unknown): Promise<LeagueStoryInvite | null> {
  if (!isInviteTokenShape(token)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  return parse(await redis.get(INVITE_KEY_PREFIX + token));
}

/** Record that the league sent its answers, keeping the invite's remaining life. */
export async function markInviteSubmitted(invite: LeagueStoryInvite, now = new Date()): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const key = INVITE_KEY_PREFIX + invite.token;
  const ttl = await redis.ttl(key);
  if (ttl <= 0) return;
  await redis.set(key, JSON.stringify({ ...invite, submittedAt: now.toISOString() }), { ex: ttl });
}

/** Newest invites first; expired ones drop out. Null when storage is down. */
export async function listInvites(): Promise<LeagueStoryInvite[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const tokens = await redis.lrange<string>(INVITES_LIST_KEY, 0, MAX_INVITES - 1);
  const rows = await Promise.all(tokens.filter(isInviteTokenShape).map((t) => redis.get(INVITE_KEY_PREFIX + t)));
  return rows.flatMap((r) => {
    const v = parse(r);
    return v ? [v] : [];
  });
}
