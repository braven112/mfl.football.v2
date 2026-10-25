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
import { hometownsKey } from './hometown-geo.mjs';

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

export { hometownsKey };

/** The bundled place with this name and region, or null. Population order, so the biggest wins a tie. */
export function findPlace(name: string, region: string): PlaceRow | null {
  return ((places as PlaceRow[]).find((row) => row[0] === name && row[1] === region) as PlaceRow | undefined) ?? null;
}

/**
 * A place as a person types it: "Seattle, WA", "Toronto, Canada", "Florida"
 * (a state), "Australia" (a country). Splits on the LAST comma, so a name
 * with a comma in it still reads. Exact names only: the import is for a list
 * someone checked, not a search.
 */
export function placeFromText(text: string): PlaceRow | null {
  const trimmed = text.trim();
  const comma = trimmed.lastIndexOf(',');
  if (comma > 0) return findPlace(trimmed.slice(0, comma).trim(), trimmed.slice(comma + 1).trim());
  return findPlace(trimmed, 'US') ?? findPlace(trimmed, '');
}

export interface HometownImport {
  rows: { franchiseId: string; place: PlaceRow }[];
  errors: { line: number; text: string; message: string }[];
}

/**
 * The commissioner's paste-in list: one team per line, `<franchise id> <place>`,
 * with anything after `#` ignored (the team name, a note). Blank lines are
 * skipped. A team named twice is an error rather than last-one-wins, so a
 * typo'd id cannot quietly overwrite another team. With `knownIds`, an id the
 * league does not have is an error too.
 */
export function parseHometownImport(text: string, knownIds?: ReadonlySet<string>): HometownImport {
  const rows: HometownImport['rows'] = [];
  const errors: HometownImport['errors'] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const match = /^(\d{4})\s+(.+)$/.exec(line);
    if (!match) {
      errors.push({ line: i + 1, text: raw.trim(), message: 'Start the line with the 4-digit team id.' });
      return;
    }
    const [, franchiseId, placeText] = match;
    if (knownIds && !knownIds.has(franchiseId)) {
      errors.push({ line: i + 1, text: raw.trim(), message: `Team ${franchiseId} isn't in this league.` });
      return;
    }
    if (seen.has(franchiseId)) {
      errors.push({ line: i + 1, text: raw.trim(), message: `Team ${franchiseId} is listed twice.` });
      return;
    }
    seen.add(franchiseId);
    const place = placeFromText(placeText);
    if (!place) {
      errors.push({ line: i + 1, text: raw.trim(), message: `"${placeText.trim()}" isn't in the place list.` });
      return;
    }
    rows.push({ franchiseId, place });
  });
  return { rows, errors };
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

/** Save many teams' hometowns in one write (the commissioner import). Returns false when Redis is unavailable. */
export async function writeHometowns(leagueSlug: string, rows: HometownImport['rows']): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  if (!rows.length) return true;
  const setAt = new Date().toISOString();
  const fields: Record<string, string> = {};
  for (const { franchiseId, place } of rows) {
    const [name, region, lat, lng, kind] = place;
    const value: StoredHometown = { name, region, lat, lng, kind, setBy: 'commissioner', setAt };
    fields[franchiseId] = JSON.stringify(value);
  }
  await redis.hset(hometownsKey(leagueSlug), fields);
  return true;
}
