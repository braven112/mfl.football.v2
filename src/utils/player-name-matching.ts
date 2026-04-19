/**
 * Shared player-name → MFL-ID matching for third-party ranking feeds
 * (Sleeper, KTC, FBG, RSP, etc.) that don't carry MFL player IDs.
 *
 * Usage:
 *   const lookup = buildMflNameLookup(mflPlayers);
 *   const mflId = lookup.get(normalizePlayerName('Breshard Smith'));
 */

/**
 * Normalize a player name for fuzzy matching:
 *  - lowercase
 *  - strip common punctuation (. ' " `)
 *  - collapse whitespace
 *  - drop generational suffixes (Jr / Sr / II / III / IV / V)
 *
 * NOTE: NFL names with hyphens (Amon-Ra, Ka'imi) are preserved to avoid
 * collisions, but the apostrophe-stripper makes Ka'imi → kaimi. Both sides
 * of the match must run through the same normalizer.
 */
export function normalizePlayerName(n: string): string {
  if (!n) return '';
  return n
    .toLowerCase()
    .replace(/[.'"`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')
    .trim();
}

/**
 * MFL stores player names as "Last, First" — convert to "First Last"
 * for matching against external sources.
 */
export function formatMflName(mflName: string): string {
  if (!mflName) return '';
  const parts = mflName.split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : mflName;
}

interface MflPlayerLike {
  id: string;
  /** MFL-formatted "Last, First" name */
  name?: string;
  /** Optional — pre-formatted "First Last" name */
  displayName?: string;
  /** Optional — position filter */
  position?: string;
  /** Optional — NFL team */
  team?: string;
}

export interface NameLookupOptions {
  /** When set, include position in the key — disambiguates same-name players across positions. */
  includePosition?: boolean;
  /** When set, include NFL team in the key — disambiguates same-name rookies on different teams. */
  includeTeam?: boolean;
}

/**
 * Build a normalized-name → MFL-ID lookup map from MFL player records.
 *
 * When the same normalized name maps to multiple MFL IDs, the first
 * occurrence wins. Callers that need stricter matching should pass
 * `{ includePosition: true }` to namespace by position.
 */
export function buildMflNameLookup(
  players: MflPlayerLike[],
  options: NameLookupOptions = {}
): Map<string, string> {
  const result = new Map<string, string>();
  for (const p of players) {
    if (!p.id) continue;
    const display = p.displayName ?? formatMflName(p.name ?? '');
    const base = normalizePlayerName(display);
    if (!base) continue;

    const keys: string[] = [base];
    if (options.includePosition && p.position) keys.push(`${base}|${p.position.toUpperCase()}`);
    if (options.includeTeam && p.team) keys.push(`${base}|${p.team.toUpperCase()}`);

    for (const k of keys) {
      if (!result.has(k)) result.set(k, p.id);
    }
  }
  return result;
}

/**
 * Resolve an external-source name to an MFL ID using the lookup built above.
 * Tries progressively looser matches: position-qualified → team-qualified → name-only.
 */
export function resolveMflId(
  lookup: Map<string, string>,
  name: string,
  hints: { position?: string; team?: string } = {}
): string | undefined {
  const base = normalizePlayerName(name);
  if (!base) return undefined;

  if (hints.position) {
    const id = lookup.get(`${base}|${hints.position.toUpperCase()}`);
    if (id) return id;
  }
  if (hints.team) {
    const id = lookup.get(`${base}|${hints.team.toUpperCase()}`);
    if (id) return id;
  }
  return lookup.get(base);
}
