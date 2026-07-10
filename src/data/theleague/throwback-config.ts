/**
 * Throwback Week: designated weeks where teams display a legacy identity
 * (name/icon/banner from theleague.config.json's per-team `history[]`)
 * instead of their current one, on live scoring / matchups / submit lineup.
 *
 * See /Users/brandon.shields@alaskaair.com/.claude/plans/unified-sleeping-hearth.md
 * for the full feature plan.
 */

/**
 * NFL week numbers that trigger throwback identity, every season (not tied
 * to a specific year — recurs automatically). Week 4 is the standing pick;
 * hand-edit this list to add/remove weeks or make a given week one-time by
 * moving the check into `isThrowbackWeek` instead.
 */
export const THROWBACK_WEEKS: number[] = [4];

/**
 * {franchiseId, yearStart} pairs whose history entry's icon/banner asset is
 * also claimed by another franchise's entry (see plan's "Data problems"
 * section). Excluded from throwback eligibility until each gets distinct
 * recovered art:
 *
 * - Da Dangsters (0002) "Sabertooths" (2007) — asset belongs to Gridiron
 *   Geeks' 2009 "Sabertooths" era instead.
 *
 * Computer Jocks (0010) "Midwestside Connection" (2011) was in this list
 * for the same reason but got distinct recovered art (icon) plus the
 * generic placeholder banner — no longer excluded.
 */
export const THROWBACK_ASSET_CONFLICTS: { franchiseId: string; yearStart: number }[] = [
  { franchiseId: '0002', yearStart: 2007 },
];

/**
 * Commissioner-picked starting default per franchise (`franchiseId` ->
 * history entry `yearStart`). Seeded to each team's earliest eligible era
 * (excluding conflict entries and entries identical to the team's current
 * identity) — hand-edit any of these to change the default. Owners can
 * still self-service override on top of this via /theleague/throwback-settings.
 */
export const DEFAULT_THROWBACK_ERA: Record<string, number> = {
  '0001': 2007, // Pacific Pigskins
  '0002': 2008, // Degenerates
  '0003': 2007, // Mistakes Were Made
  '0004': 2007, // Las Vegas Elite
  '0005': 2007, // The Executioners
  '0006': 2007, // LBer-DeCleaters
  '0007': 2007, // Acer FC Edge
  '0008': 2007, // Bring The Pain
  '0009': 2007, // Rolling Rockers
  '0010': 2007, // Witch City Warlocks
  '0011': 2007, // Amish Rakefighters
  '0012': 2007, // BOYZ II MEN
  '0013': 2007, // DangerZone
  '0014': 2007, // Devil Dogs
  '0015': 2007, // Dark Magicians of Chaos
  '0016': 2007, // Silver Bullets
};

export function isThrowbackWeek(week: number): boolean {
  return THROWBACK_WEEKS.includes(week);
}
