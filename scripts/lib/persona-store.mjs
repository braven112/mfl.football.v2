/**
 * Read a league's persona from Redis for the node-side writers.
 *
 * The commissioner saves it through /api/admin/persona; this is the read half
 * the article runner uses. It FAILS SOFT on purpose: no Redis config, a
 * network error or a malformed value all resolve to the league's default
 * persona. A column written as Schefter is a far smaller failure than a column
 * not written at all because a settings read timed out.
 */

import { LEAGUES, SHARED_APP_ORIGIN, leagueOrigin } from '../../src/config/leagues-data.mjs';
import { absolutePersonaAvatar, personaKey, resolvePersona } from '../../src/utils/persona.mjs';
import { getRedisConfig, redisCommand } from './redis.mjs';

/**
 * @param {string} slug  Canonical registry slug ('theleague', 'afl-fantasy', …).
 * @param {{ redis?: {url: string, token: string} | null, command?: typeof redisCommand, log?: Pick<Console, 'warn'> }} [opts]
 */
export async function loadLeaguePersona(slug, { redis = getRedisConfig(), command = redisCommand, log = console } = {}) {
  const entry = /** @type {Record<string, any>} */ (LEAGUES)[slug];
  if (!entry) throw new Error(`Unknown league: ${slug}`);
  // A registry avatar may be a site path; the node-side senders (Slack's
  // icon_url) need it absolute.
  const origin = leagueOrigin(entry) ?? SHARED_APP_ORIGIN;
  const withAbsoluteAvatar = (/** @type {ReturnType<typeof resolvePersona>} */ p) => ({ ...p, avatarUrl: absolutePersonaAvatar(p, origin) });
  if (!redis) return withAbsoluteAvatar(resolvePersona(entry, null));
  try {
    const stored = await command(redis, ['GET', personaKey(slug)]);
    return withAbsoluteAvatar(resolvePersona(entry, stored));
  } catch (err) {
    log.warn?.(`  [persona] Could not read ${personaKey(slug)} (${/** @type {Error} */ (err).message}) — using the default.`);
    return withAbsoluteAvatar(resolvePersona(entry, null));
  }
}
