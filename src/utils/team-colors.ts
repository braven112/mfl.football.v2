/**
 * Team Color Palette
 *
 * 16 visually distinct colors for chart lines, one per franchise.
 * Uses a categorical palette optimized for distinguishability on white backgrounds.
 */

export const TEAM_COLORS: Record<string, string> = {
	'0001': '#e6194b', // red
	'0002': '#3cb44b', // green
	'0003': '#4363d8', // blue
	'0004': '#f58231', // orange
	'0005': '#911eb4', // purple
	'0006': '#42d4f4', // cyan
	'0007': '#f032e6', // magenta
	'0008': '#bfef45', // lime
	'0009': '#fabed4', // pink
	'0010': '#469990', // teal
	'0011': '#dcbeff', // lavender
	'0012': '#9a6324', // brown
	'0013': '#fffac8', // beige
	'0014': '#800000', // maroon
	'0015': '#aaffc3', // mint
	'0016': '#808000', // olive
};

/** Get a team's chart color with fallback */
export function getTeamColor(franchiseId: string): string {
	return TEAM_COLORS[franchiseId] ?? '#6b7280';
}
