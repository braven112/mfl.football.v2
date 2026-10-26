/**
 * MFL Live's TV settings: what the Google TV app should know about the
 * viewer's own TV service. One today — whether they have NFL Sunday Ticket,
 * which decides how the score overlay's Watch list labels a regional game.
 *
 * Keyed by the MFL Live viewer (the hashed MFL username, `sleeperViewerKey`),
 * never by league or franchise: it is a fact about the owner's TV, the same in
 * every league they play in, and a paired TV's pass resolves to that same
 * owner, so a choice made on the phone reaches the TV with nothing to sync.
 *
 * Redis down → the defaults, which render as "not set" rather than an error.
 */

import type { AuthUser } from './auth';
import { getRedis } from './redis-client';
import { sleeperViewerKey } from './sleeper/link';

export interface TvSettings {
  /** True when the viewer has NFL Sunday Ticket. Off until they say so. */
  sundayTicket: boolean;
}

export const DEFAULT_TV_SETTINGS: TvSettings = { sundayTicket: false };

export function tvSettingsKey(user: Pick<AuthUser, 'name'>): string | null {
  const viewer = sleeperViewerKey(user);
  return viewer ? `live:tv:settings:${viewer}` : null;
}

export async function getTvSettings(user: Pick<AuthUser, 'name'> | null | undefined): Promise<TvSettings> {
  const key = user ? tvSettingsKey(user) : null;
  if (!key) return DEFAULT_TV_SETTINGS;
  const redis = await getRedis().catch(() => null);
  const stored = await redis?.get<Partial<TvSettings>>(key).catch(() => null);
  return { sundayTicket: stored?.sundayTicket === true };
}

export async function setTvSettings(user: Pick<AuthUser, 'name'>, settings: TvSettings): Promise<boolean> {
  const key = tvSettingsKey(user);
  const redis = await getRedis().catch(() => null);
  if (!key || !redis) return false;
  try {
    await redis.set(key, { sundayTicket: settings.sundayTicket === true, savedAt: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}
