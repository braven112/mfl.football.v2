/**
 * Schefter Tipster Codenames
 *
 * Deterministic-ish codename assignment for anonymous tipsters. Codenames
 * are issued lazily — the first time a tipster actually produces a rumor
 * post, the scanner calls `assignCodename(redis, hashedOwnerId)` to persist
 * a stable nom-de-plume.
 *
 * Assignment rules:
 *  - The full codename is unique per owner (no "#N" suffixes) — every tipster
 *    on the leaderboard has a distinct name.
 *  - We seed the selection from the tipster hash so the same user would be
 *    stable against retries / duplicate calls, but fall through to the next
 *    available name if their seeded slot is taken.
 *  - If every base name is used (shouldn't happen — list is larger than the
 *    league roster) we fall back to appending the first 4 chars of the hash
 *    to the seeded base name so the assignment still succeeds.
 *
 * Never exposes the raw hashedOwnerId in UI — only the codename.
 */

/** Schefter-voiced codenames. "Fully unique per owner" — no # suffixes. */
export const SCHEFTER_CODENAMES = [
  'Burner Phone',
  'Back-Channel',
  'The Leak',
  'Smoke Signal',
  'Off the Record',
  'Unnamed Source',
  'The Whisper',
  'Sources Say',
  'League Source',
  'Close to the Situation',
  'Someone Familiar',
  'The Insider',
  'Rolodex',
  'The Wire',
  'The Dossier',
  'A Longtime Observer',
  'The Tipline',
  'Anonymous Veteran',
  'Blind Item',
  'Hot Mic',
  'Green Room',
  'The Ledger',
  'Earpiece',
  'Cold Case',
  'The Courier',
  'The Ghost',
  'Static',
  'Hearsay',
  'Room Service',
] as const;

export type SchefterCodename = (typeof SCHEFTER_CODENAMES)[number];

export const CODENAME_KEY_PREFIX = 'schefter:tipster:codename:';
export const CODENAMES_USED_KEY = 'schefter:tipster:codenames_used';

/** Redis surface required for codename assignment. Kept tiny on purpose. */
export type CodenameRedis = {
  get: <T>(key: string) => Promise<T | null>;
  set: (
    key: string,
    value: unknown,
    opts?: { nx?: boolean; ex?: number },
  ) => Promise<unknown>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
};

/**
 * Pick the seed index into `SCHEFTER_CODENAMES` for a given hashed owner id.
 * Deterministic — the same hash always produces the same starting slot.
 */
export function seedSlotForHash(hashedOwnerId: string): number {
  if (!hashedOwnerId) return 0;
  const prefix = hashedOwnerId.slice(0, 8);
  const n = parseInt(prefix, 16);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) % SCHEFTER_CODENAMES.length;
}

/**
 * Claim an unused codename for `hashedOwnerId`. Idempotent — if the user
 * already has a codename, returns it without touching the used-set.
 *
 * Walks the codename list starting at the hash-seeded slot so retries don't
 * produce a different answer for the same user under normal conditions.
 */
export async function assignCodename(
  redis: CodenameRedis,
  hashedOwnerId: string,
): Promise<string> {
  if (!hashedOwnerId) throw new Error('assignCodename: hashedOwnerId required');

  const userKey = `${CODENAME_KEY_PREFIX}${hashedOwnerId}`;

  const existing = await redis.get<string>(userKey);
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const start = seedSlotForHash(hashedOwnerId);
  const total = SCHEFTER_CODENAMES.length;

  for (let i = 0; i < total; i++) {
    const candidate = SCHEFTER_CODENAMES[(start + i) % total];
    const added = await redis.sadd(CODENAMES_USED_KEY, candidate);
    if (added === 1) {
      // We own this name. Try to persist it atomically.
      const writeRes = await redis.set(userKey, candidate, { nx: true });
      if (writeRes === 'OK' || writeRes === true) {
        return candidate;
      }
      // Another worker persisted first — release our hold and read theirs.
      await redis.srem(CODENAMES_USED_KEY, candidate);
      const actual = await redis.get<string>(userKey);
      if (typeof actual === 'string' && actual.length > 0) return actual;
    }
    // Candidate was already in the used-set — try the next one.
  }

  // All base names are taken. Fall back to seeded base + 4-char hash suffix
  // so the league never gets blocked from issuing new codenames.
  const fallback = `${SCHEFTER_CODENAMES[start]} ${hashedOwnerId.slice(0, 4)}`;
  const writeRes = await redis.set(userKey, fallback, { nx: true });
  if (writeRes === 'OK' || writeRes === true) return fallback;
  const actual = await redis.get<string>(userKey);
  return typeof actual === 'string' && actual.length > 0 ? actual : fallback;
}

/** Read-only lookup — returns null when the tipster hasn't seeded a rumor yet. */
export async function getCodename(
  redis: CodenameRedis,
  hashedOwnerId: string,
): Promise<string | null> {
  const existing = await redis.get<string>(`${CODENAME_KEY_PREFIX}${hashedOwnerId}`);
  return typeof existing === 'string' && existing.length > 0 ? existing : null;
}
