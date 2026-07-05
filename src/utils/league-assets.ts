/**
 * League asset helpers.
 *
 * The asset files (src/data/theleague.assets.json, data/afl-fantasy/afl.assets.json)
 * contain BOTH current franchises (`category: "active"`) and historical identities
 * (`category: "former"`) that share the same franchise ids — e.g. TheLeague id 0011
 * appears as both "Midwestside Connection" (active) and "Amish Rakefighters" /
 * "Under Siege" (former). Some former entries also have compound ids ("0002, 0013")
 * or no id at all.
 *
 * Any consumer doing per-franchise iteration or id lookups must go through
 * getActiveTeams(): iterating the raw `teams` array double-counts franchises,
 * Map-building overwrites active names with retired ones, and `.find(t => t.id ...)`
 * can resolve to whichever identity happens to sort first alphabetically.
 *
 * Only the asset-library pages (assets.astro / theleague.astro) should read the
 * raw array — they intentionally display the full historical library.
 */
export function getActiveTeams<T extends { category?: string }>(
  assets: { teams?: T[] } | null | undefined
): T[] {
  return (assets?.teams ?? []).filter((team) => team.category !== 'former');
}
