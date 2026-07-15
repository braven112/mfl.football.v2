/**
 * Trade bait (trade block) parsing helpers.
 *
 * The persisted `tradeBait.json` feed exists in two shapes depending on which
 * writer last touched it:
 *
 * 1. Flat array of player-id strings — written by scripts/fetch-mfl-feeds.mjs,
 *    scripts/fetch-trade-bait.mjs, and the /api/trade-bait local cache update.
 * 2. Raw MFL export shape — { tradeBaits: { tradeBait: [{ willGiveUp: "id,id" }] } }
 *    (MFL returns a single object instead of an array when only one franchise
 *    has trade bait).
 *
 * Consumers should use this helper rather than parsing one shape inline —
 * parsing only one shape silently yields an empty set when the other writer
 * ran last (this bit the AFL rosters page, whose badges vanished on reload).
 */

/**
 * Valid MFL player IDs are 4+ digits — this rejects short numeric junk
 * (split/trim artifacts, empty strings), matching the filter the fetch
 * scripts apply. Note it does NOT reject 4-digit ids with leading zeros:
 * those are real MFL ids (team defenses like "0532").
 */
const PLAYER_ID_RE = /^\d{4,}$/;

export function parseTradeBaitPlayerIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  if (!data || typeof data !== 'object') return ids;

  if (Array.isArray(data)) {
    for (const entry of data) {
      const id = String(entry).trim();
      if (PLAYER_ID_RE.test(id)) ids.add(id);
    }
    return ids;
  }

  const baitEntries = (data as any)?.tradeBaits?.tradeBait;
  if (!baitEntries) return ids;
  const arr = Array.isArray(baitEntries) ? baitEntries : [baitEntries];
  for (const entry of arr) {
    const willGiveUp = entry?.willGiveUp;
    if (typeof willGiveUp !== 'string') continue;
    for (const raw of willGiveUp.split(',')) {
      const id = raw.trim();
      if (PLAYER_ID_RE.test(id)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Parse `tradeBait-by-franchise.json` ({ fetchedAt, franchises }) into a
 * franchiseId → player-id-set map. Returns null when the payload isn't in
 * that shape, so callers can fall back to the flat set.
 *
 * Prefer this over the flat list whenever attribution matters: the flat
 * list can't say WHICH franchise flagged a player, and in AFL both
 * conferences roster the same NFL player pool — a bare player id matches
 * two different teams' rosters.
 */
export function parseTradeBaitByFranchise(data: unknown): Map<string, Set<string>> | null {
  const franchises = (data as any)?.franchises;
  if (!franchises || typeof franchises !== 'object' || Array.isArray(franchises)) return null;

  const map = new Map<string, Set<string>>();
  for (const [franchiseId, entry] of Object.entries(franchises)) {
    const ids = new Set<string>();
    const playerIds = (entry as any)?.playerIds;
    if (Array.isArray(playerIds)) {
      for (const raw of playerIds) {
        const id = String(raw).trim();
        if (PLAYER_ID_RE.test(id)) ids.add(id);
      }
    }
    map.set(franchiseId, ids);
  }
  return map;
}
