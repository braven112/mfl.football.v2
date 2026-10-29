/**
 * The example logos on the free logo maker (`/fantasy-football-logo-maker`).
 *
 * Each one is a real run of the tool: these choices, put through
 * `buildTeamLogoPrompt` with the Vector (for Claude) kind, gave a prompt, and
 * the SVG in `public/assets/logo-maker/` is what Claude drew from it. "Use
 * this prompt" fills the builder with the same choices, so a visitor starts
 * from a logo they can already see.
 *
 * Team names are popular fantasy styles, never a real player or club, so the
 * page borrows no one's name or mark (tests/logo-maker.test.ts checks the
 * names against the NFL warning and every color against the tool's grid).
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
		teamName: 'Waiver Wire Warriors',
		idea: 'a viking helmet over a football',
		style: 'crest',
		colors: ['#13294B', '#FFB81C'],
		kind: 'svg',
		image: '/assets/logo-maker/waiver-wire-warriors.svg',
		alt: 'Waiver Wire Warriors: a gold viking helmet over a football on a navy shield',
	},
	{
		teamName: 'Bench Mob',
		idea: 'a scowling bulldog',
		style: 'mascot',
		colors: ['#C8102E', '#111111'],
		kind: 'svg',
		image: '/assets/logo-maker/bench-mob.svg',
		alt: 'Bench Mob: a scowling red bulldog head with black ears',
	},
	{
		teamName: 'Hail Mary Hooligans',
		idea: 'a football with a halo flying through the air',
		style: 'retro',
		colors: ['#00843D', '#FFFFFF'],
		kind: 'svg',
		image: '/assets/logo-maker/hail-mary-hooligans.svg',
		alt: 'Hail Mary Hooligans: a football with a halo flying across a stitched green patch',
	},
	{
		teamName: 'Sunday Funday',
		idea: 'a grinning sun wearing sunglasses',
		style: 'badge',
		colors: ['#13294B', '#F26B1D'],
		kind: 'svg',
		image: '/assets/logo-maker/sunday-funday.svg',
		alt: 'Sunday Funday: a grinning orange sun in sunglasses on a round navy badge',
	},
	{
		teamName: 'Gridiron Goats',
		idea: 'two G letters crowned with curled goat horns',
		style: 'monogram',
		colors: ['#4C1D95', '#FFB81C'],
		kind: 'svg',
		image: '/assets/logo-maker/gridiron-goats.svg',
		alt: 'Gridiron Goats: two purple G letters under curled gold goat horns',
	},
	{
		teamName: 'Waiver Wolves',
		idea: 'a fierce wolf head',
		style: 'mascot',
		colors: ['#13294B', '#A5ACAF'],
		kind: 'svg',
		image: '/assets/logo-maker/waiver-wolves.svg',
		alt: 'Waiver Wolves: a silver and navy wolf head',
	},
];
