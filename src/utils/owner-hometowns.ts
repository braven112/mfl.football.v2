/**
 * Owner Map hometowns — the city each team represents, kept in Redis.
 *
 * Not in git: the repo is public, and where an owner grew up is theirs to
 * share with the league, not with the internet. One hash per league
 * (`owner-map:hometowns:<slug>`), one field per franchise, because both
 * leagues have a franchise 0001.
 *
 * A place is always one of the bundled places (src/data/owner-map-places.json)
 * and is looked up HERE from the name and region the browser sends, so a
 * request cannot put a pin at coordinates of its own choosing or store
 * arbitrary text.
 *
 * Reads never throw: a Redis outage shows the map with nobody placed rather
 * than a 500.
 */
import { getRedis } from './redis-client';
import places from '../data/owner-map-places.json';

export type PlaceKind = 'city' | 'state' | 'country';

/** [name, region, lat, lng, kind], as the build script writes it. */
export type PlaceRow = [string, string, number, number, PlaceKind];

export interface StoredHometown {
  name: string;
  /** A US state code for a city, 'US' for a state, a country name for a city abroad, '' for a country. */
  region: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  setBy: 'owner' | 'commissioner';
  setAt: string;
}

export const hometownsKey = (leagueSlug: string) => `owner-map:hometowns:${leagueSlug}`;

/** The bundled place with this name and region, or null. Population order, so the biggest wins a tie. */
export function findPlace(name: string, region: string): PlaceRow | null {
  return ((places as PlaceRow[]).find((row) => row[0] === name && row[1] === region) as PlaceRow | undefined) ?? null;
}

function isStored(value: unknown): value is StoredHometown {
  const v = value as StoredHometown;
  return (
    !!v &&
    typeof v.name === 'string' &&
    typeof v.region === 'string' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng)
  );
}

export async function readHometowns(leagueSlug: string): Promise<Record<string, StoredHometown>> {
  try {
    const redis = await getRedis();
    if (!redis) return {};
    const raw = await redis.hgetall<unknown>(hometownsKey(leagueSlug));
    const out: Record<string, StoredHometown> = {};
    for (const [franchiseId, value] of Object.entries(raw ?? {})) {
      const parsed = typeof value === 'string' ? safeParse(value) : value;
      if (isStored(parsed)) out[franchiseId] = parsed;
    }
    return out;
  } catch (err) {
    console.error('[owner-map] hometown read failed:', err);
    return {};
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Save (or with `place` null, clear) one team's hometown. Returns false when Redis is unavailable. */
export async function writeHometown(
  leagueSlug: string,
  franchiseId: string,
  place: PlaceRow | null,
  setBy: StoredHometown['setBy'],
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  if (!place) {
    await redis.hdel(hometownsKey(leagueSlug), franchiseId);
    return true;
  }
  const [name, region, lat, lng, kind] = place;
  const value: StoredHometown = { name, region, lat, lng, kind, setBy, setAt: new Date().toISOString() };
  await redis.hset(hometownsKey(leagueSlug), { [franchiseId]: JSON.stringify(value) });
  return true;
}
