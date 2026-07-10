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
 * recovered art.
 *
 * Both former conflicts are resolved:
 * - Da Dangsters (0002) "Sabertooths" (2007) shares its icon/banner with
 *   Gridiron Geeks' 2009 "Sabertooths" era on purpose — same intentional
 *   shared art, not a data bug. No longer excluded.
 * - Computer Jocks (0010) "Midwestside Connection" (2011) got distinct
 *   recovered art (icon) plus the generic placeholder banner — no longer
 *   excluded.
 */
export const THROWBACK_ASSET_CONFLICTS: { franchiseId: string; yearStart: number }[] = [];

/**
 * Commissioner-picked starting default per franchise (`franchiseId` ->
 * history entry `yearStart`). Seeded to each team's MOST RECENT era with a
 * distinct icon from today's — so teams throw back to their last old
 * identity (Heavy Chevy, Poker in the Rear, Sabertooths, …) rather than
 * everyone snapping to the 2007 original. Teams that never rebranded (their
 * only prior era IS 2007) naturally fall back to that origin. Hand-edit any
 * of these; owners can still self-service override via
 * /theleague/throwback-settings.
 */
export const DEFAULT_THROWBACK_ERA: Record<string, number> = {
  '0001': 2013, // Pacific Pigskins (2013 razorback-head — most recent old look; 2007 black is the alt)
  '0002': 2015, // Da Dangsters (vintage 2015-2024 icon)
  '0003': 2015, // Poker in the Rear
  '0004': 2020, // Heavy Chevy
  '0005': 2007, // The Executioners (only prior era)
  '0006': 2007, // LBer-DeCleaters (only prior era)
  '0007': 2007, // Acer FC Edge (only prior era)
  '0008': 2023, // Bring The Pain (2023 red-graffiti — most recent old look; 2007 skull is the alt)
  '0009': 2007, // Rolling Rockers (only prior era)
  '0010': 2007, // Witch City Warlocks (Computer Jocks' oldest — avoids a name
                //   clash with the current Midwestside Connection franchise,
                //   which 0010 used to be named before that identity moved to 0011)
  '0011': 2019, // Midwestside Connection (older icon variant)
  '0012': 2007, // BOYZ II MEN (only prior era)
  '0013': 2009, // Sabertooths
  '0014': 2007, // Devil Dogs (only prior era)
  '0015': 2015, // Dark Magicians of Chaos (2015-2024 icon)
  '0016': 2011, // Treasure Coast Swamp Bandits
};

export function isThrowbackWeek(week: number): boolean {
  return THROWBACK_WEEKS.includes(week);
}
