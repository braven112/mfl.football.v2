/**
 * Owner Map hometowns for the article scripts: the city each team represents,
 * read from the same Redis hash the site writes (owner-hometowns.ts).
 *
 * A hometown is the city a TEAM represents, chosen by its owner, usually where
 * they grew up and often not where they live. The fact-sheet line says so, so
 * the model never writes "the Spokane-based owner".
 *
 * Never throws and never blocks an article: no credentials, an outage or a bad
 * row all just mean fewer hometown lines.
 */
import { getRedisConfig, redisCommand } from '../lib/redis.mjs';
import { hometownsKey, milesBetween, placeLabel } from '../../src/utils/hometown-geo.mjs';

/**
 * franchiseId → place for every team that has picked one.
 * @param {string} league
 * @param {{ redis?: { url: string, token: string } | null }} [options]
 * @returns {Promise<Record<string, { name: string, region: string, lat: number, lng: number, kind: string }>>}
 */
export async function loadHometowns(league, { redis = getRedisConfig() } = {}) {
  if (!redis) return {};
  try {
    const flat = await redisCommand(redis, ['HGETALL', hometownsKey(league)]);
    /** @type {Record<string, { name: string, region: string, lat: number, lng: number, kind: string }>} */
    const out = {};
    // Upstash REST returns HGETALL as a flat [field, value, field, value] list.
    for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) {
      let value = flat[i + 1];
      try {
        if (typeof value === 'string') value = JSON.parse(value);
      } catch {
        continue;
      }
      if (value && typeof value.name === 'string' && Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
        out[flat[i]] = { name: value.name, region: value.region ?? '', lat: value.lat, lng: value.lng, kind: value.kind ?? 'city' };
      }
    }
    return out;
  } catch (err) {
    console.warn(`  [hometowns] read failed, writing without them: ${err.message}`);
    return {};
  }
}

/**
 * One fact-sheet line for a game, or null unless BOTH teams have a hometown
 * (one city alone is not a matchup angle).
 */
export function hometownFact(aId, bId, homes, nameOf) {
  const a = homes[aId];
  const b = homes[bId];
  if (!a || !b) return null;
  const miles = milesBetween(a, b);
  const where = (place) => `${placeLabel(place)}${place.kind === 'state' ? ' (a whole state, no single city)' : place.kind === 'country' ? ' (a whole country)' : ''}`;
  if (miles < 1) {
    return `Hometowns: both teams represent ${where(a)}, a same-city game.`;
  }
  return `Hometowns: ${nameOf(aId)} represent ${where(a)}; ${nameOf(bId)} represent ${where(b)}. ${miles.toLocaleString('en-US')} miles apart.`;
}
