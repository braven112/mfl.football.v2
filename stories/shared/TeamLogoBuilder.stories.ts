import TeamLogoBuilder from '../../src/components/shared/mfl-live/TeamLogoBuilder.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The team logo builder: style, colors and kind in, an AI prompt out. It
 * renders on /team-logo and inside the season video's Make my logo dialog
 * (/video), so a change here shows in both.
 */
export default {
	title: 'Shared/TeamLogoBuilder',
	component: TeamLogoBuilder,
	parameters: { chromatic: { modes: themeModes } },
};

export const SignedOut = { args: {} };

/** An owner with teams in two leagues: the first pre-fills the name. */
export const WithTeams = {
	args: {
		teams: [
			{ name: 'Computer Jocks', league: 'The League' },
			{ name: 'Smokane FC', league: 'AFL' },
		],
	},
};
