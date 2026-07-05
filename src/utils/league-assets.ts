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

interface AssetEntry {
  relativePath?: string;
}

interface TeamAssets {
  icons?: AssetEntry[];
  banners?: AssetEntry[];
}

/**
 * Pick a franchise's CURRENT asset (icon/banner) from its asset array.
 *
 * Active-team asset arrays are ordered oldest-first and fold the franchise's
 * former-identity art in at index 0 — e.g. Pigskins' `icons` is
 * [`/assets/theleague/history/pigskins_2007_icon_circle.png`,
 * `/assets/theleague/icons/pigskins.png`]. Taking
 * `[0]` therefore renders the retired logo for every team that has a former
 * identity (Pigskins, BTP, Midwestside, Dark Magicians…). Consumers that want
 * the live logo must skip anything under `/history/` and prefer the newest
 * remaining entry, falling back so single-entry teams still resolve.
 */
export function getCurrentAssetPath(entries: AssetEntry[] | undefined): string | undefined {
  if (!entries || entries.length === 0) return undefined;
  const live = entries.filter(
    (e) => e.relativePath && !e.relativePath.includes('/history/')
  );
  const pick = live.length ? live[live.length - 1] : entries[entries.length - 1];
  return pick?.relativePath;
}

/** Current icon path for a team, skipping folded-in historical icons. */
export function getCurrentIconPath(
  team: { assets?: TeamAssets } | null | undefined
): string | undefined {
  return getCurrentAssetPath(team?.assets?.icons);
}

/** Current banner path for a team, skipping folded-in historical banners. */
export function getCurrentBannerPath(
  team: { assets?: TeamAssets } | null | undefined
): string | undefined {
  return getCurrentAssetPath(team?.assets?.banners);
}
