/**
 * Team Color Palette
 *
 * Each franchise's primary chart color, stored in theleague.config.json as the
 * canonical source. This utility provides convenient access for charts and
 * visualizations. Colors are derived from each team's icon/branding and chosen
 * for visual distinctness on white backgrounds.
 *
 * Color assignments:
 *   0001 Pigskins     — #cc2936 (Red)
 *   0002 Dangsters    — #8b6914 (Brown)
 *   0003 Mavericks    — #c4b060 (Muted Gold)
 *   0004 Dead Cap     — #65b32e (Lime Green)
 *   0005 Ninjas       — #006847 (Mexican Flag Green)
 *   0006 Music City   — #4b92db (Titans Light Blue)
 *   0007 FRA          — #e88370 (Coral)
 *   0008 Pain         — #1a1a1a (Black)
 *   0009 Wabbits      — #5c5c5c (Dark Gray)
 *   0010 CPU Jocks    — #2e8b57 (Kelly Green)
 *   0011 Midwest      — #ffcd00 (Iowa Hawkeye Yellow)
 *   0012 Vitside      — #f06abc (Bright Pink)
 *   0013 Geeks        — #d45500 (Burnt Orange)
 *   0014 Cowboy Up    — #0d2b56 (Red Sox Blue)
 *   0015 Magicians    — #9b30ff (Magenta/Purple)
 *   0016 The Dream    — #3498db (Sky Blue)
 */

import leagueConfig from '../data/theleague.config.json';

const colorMap: Record<string, string> = {};
for (const team of leagueConfig.teams) {
	if ((team as any).color) {
		colorMap[team.franchiseId] = (team as any).color;
	}
}

/** Get a team's chart color with fallback */
export function getTeamColor(franchiseId: string): string {
	return colorMap[franchiseId] ?? '#6b7280';
}
