/**
 * The example logos on the free logo maker (`/fantasy-football-logo-maker`).
 *
 * Each one is a real logo an AI image tool made from this tool's prompt
 * (Brandon's, 2026-10-29: hand-drawn SVG stand-ins were rejected as not good
 * enough to sell the tool, so only real output goes here). "Use this prompt"
 * fills the builder with the same choices, so a visitor starts from a logo
 * they can already see.
 *
 * No words on an example (Brandon, 2026-10-29): the prompt forbids them on an
 * icon, so an example with the team name on it would teach the opposite. One
 * stylized letter is fine; it is a graphic, not text. The page hides the
 * section while the list is empty.
 *
 * Never a real player's or club's name or mark (tests/logo-maker.test.ts
 * checks the names against the real-player and club finder and every color against the
 * tool's grid).
 */
import type { MflLiveAppLogoKind } from '../../packages/shared-types/src/mfl-live-app-logo';

export interface LogoMakerExample {
	teamName: string;
	idea: string;
	style: string;
	colors: string[];
	kind: MflLiveAppLogoKind;
	/** Under `public/`. */
	image: string;
	alt: string;
}

export const LOGO_MAKER_EXAMPLES: LogoMakerExample[] = [
	{
		// Brandon's own run, 2026-10-29, with these exact choices.
		teamName: 'Maryville',
		idea: 'a stylized M with a crowned princess and ocean waves, for a coastal town named after Princess Mary',
		style: 'crest',
		colors: ['#9E1B32', '#F3E9D2'],
		kind: 'icon',
		image: '/assets/logo-maker/maryville.webp',
		alt: 'Maryville logo: a crimson stylized M with a crowned princess, her hair flowing into cream ocean waves',
	},
	{
		// Brandon's own run, 2026-10-30, as the Modern mascot example.
		teamName: 'Walruses',
		idea: 'a tough walrus in a football helmet, tusks out',
		style: 'mascot',
		colors: ['#13294B', '#A5ACAF'],
		kind: 'icon',
		image: '/assets/logo-maker/walruses.webp',
		alt: 'Walruses logo: a scowling gray walrus with long white tusks in a navy and silver football helmet',
	},
];
