/**
 * canonical-json.mjs — semantic JSON comparison + skip-if-unchanged writes.
 *
 * Why this exists: MFL returns array elements in NONDETERMINISTIC order, so
 * every 5-minute roster-sync run used to rewrite (and commit) byte-different
 * but semantically identical feed files — ~18 full 1.4 MB `players.json`
 * blobs per day PER LEAGUE, which is how `.git` reached 7 GB while the
 * working tree is 249 MB. The fix is to compare payloads order-blind before
 * writing and skip the write when nothing real changed.
 *
 * Two deliberate design points:
 *
 * 1. **Comparison is order-blind; files are NEVER re-sorted on disk.** MFL's
 *    `leagueStandings` row order IS the league's official final order (see
 *    docs/claude/rules/standings-brackets-draft-order.md) and other feeds may
 *    carry meaning in feed
 *    order, so canonicalizing the stored file would corrupt data. We only
 *    canonicalize the *comparison string*. Consequence: a pure permutation
 *    (e.g. two all-tied offseason teams swapping standings rows with zero
 *    field changes) is treated as "unchanged" and keeps the older order on
 *    disk until the next real content change. In season every game changes
 *    points weekly, so a meaningful reorder always rides along with a field
 *    change and is written normally.
 *
 * 2. **Volatile keys are excluded from comparison, not stripped from data.**
 *    Fields like `lastFetched` / `fetchedAt` / `generatedAt` change every
 *    run even when the payload doesn't; ignoring them during comparison
 *    means an unchanged payload keeps its previous timestamp on disk (and
 *    produces no commit), while a real change writes the fresh timestamp.
 *    Consumers keep seeing the fields they already depend on.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Deterministic comparison string for a JSON-serializable value:
 * - object keys sorted (minus `ignoreKeys`, removed at ANY depth)
 * - array elements canonicalized then sorted lexicographically (order-blind)
 * - scalars via JSON.stringify
 */
export const canonicalCompareString = (value, { ignoreKeys = [] } = {}) => {
  const ignore = new Set(ignoreKeys);
  const canon = (v) => {
    if (Array.isArray(v)) {
      return `[${v.map(canon).sort().join(',')}]`;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v)
        .filter((k) => !ignore.has(k))
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
  };
  return canon(value);
};

/** True when two payloads are semantically equivalent (see caveats above). */
export const jsonEquivalent = (a, b, opts = {}) =>
  canonicalCompareString(a, opts) === canonicalCompareString(b, opts);

/**
 * Write `data` (object, or pre-serialized JSON string) to `filePath` as
 * pretty-printed JSON — unless the file already holds a semantically
 * equivalent payload, in which case the file is left byte-untouched.
 *
 * Returns true when the file was written, false when skipped. An existing
 * file that can't be parsed as JSON is treated as changed and overwritten.
 */
export const writeJsonIfChanged = (filePath, data, { ignoreKeys = [] } = {}) => {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (fs.existsSync(filePath)) {
    try {
      const existingRaw = fs.readFileSync(filePath, 'utf8');
      if (existingRaw === serialized) return false;
      const existing = JSON.parse(existingRaw);
      const next = typeof data === 'string' ? JSON.parse(data) : data;
      if (jsonEquivalent(existing, next, { ignoreKeys })) return false;
    } catch {
      // Existing file unreadable or not JSON — treat as changed.
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialized, 'utf8');
  return true;
};
