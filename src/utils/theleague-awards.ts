/**
 * TheLeague's official championship pennants: the league-wide marks for its
 * two titles, the league champion and the four division champions
 * (public/assets/theleague/awards/, drawn by
 * scripts/build-theleague-award-badges.mjs on the AFL's set).
 *
 * League-wide, so they stand for what COULD be won (a division leader on the
 * homepage standings) or sit beside a team already shown (the footer's
 * champion band). A title a club has WON hangs as its own pennant in the
 * Rafters (docs/claude/rules/theming-and-assets.md § Championship marks).
 * Served as <img>, so a seasonal theme's drawing swaps in by path.
 */
const AWARDS_DIR = '/assets/theleague/awards/';

export const THELEAGUE_CHAMPION_BADGE = `${AWARDS_DIR}league-champion.svg`;

const DIVISION_CHAMPION_BADGES: Record<string, string> = {
  Northwest: `${AWARDS_DIR}northwest-champion.svg`,
  Southwest: `${AWARDS_DIR}southwest-champion.svg`,
  Central: `${AWARDS_DIR}central-champion.svg`,
  East: `${AWARDS_DIR}east-champion.svg`,
};

/** A division's champion shield, or null for a division with no art (the retired 2007-2010 names). */
export function theleagueDivisionChampionBadge(division: string | null | undefined): string | null {
  return (division && DIVISION_CHAMPION_BADGES[division]) || null;
}
