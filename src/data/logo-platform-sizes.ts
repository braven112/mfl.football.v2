/**
 * Every file the free logo resizer makes, grouped by where it goes
 * (`LogoResizer.astro`, on `/fantasy-football-logo-resizer` and under both
 * logo maker prompts). Adding a platform is one entry here.
 *
 * Every size was checked against the platform's own help pages on 2026-10-30.
 * Most fantasy sites publish NO size for a team logo: those entries say so
 * (`published: false`), link the help page we checked, and use a 512 square,
 * which every one of them accepts and shrinks cleanly. Never replace one with
 * a number from a third-party "size guide" — those disagree with each other.
 *
 * The MFL sizes are read from `brand-asset-specs.ts`, which the site's own
 * stored art is measured against.
 *
 * tests/logo-platform-sizes.test.ts pins the shape: a width, a height, a
 * format and a source on every entry, and unique file names.
 */
import { CREST_OUTPUTS } from '../utils/brand-asset-specs';

export type LogoFormat = 'png' | 'jpg';

export interface LogoOutput {
	id: string;
	label: string;
	width: number;
	height: number;
	/** The format the platform wants. "Save as JPG" turns every PNG into a JPG. */
	format: LogoFormat;
	/** `banner` centers the logo on a wide color band, with the team name if given. */
	layout: 'square' | 'banner';
	/** Fill the background even when transparency is on: app icons need a solid square, and a banner is the logo on a color band. */
	solid?: boolean;
	/** Download name without the extension. */
	file: string;
	/** Where the size comes from: a help page, or our own spec file. */
	source: string;
	/** False when the platform publishes no size, so we chose a safe square. */
	published: boolean;
}

export interface LogoPlatform {
	id: string;
	name: string;
	blurb: string;
	outputs: LogoOutput[];
}

/** Our pick when a platform publishes no size: big enough for any screen, small to upload. */
export const SAFE_SQUARE = 512;

const SPECS = 'src/utils/brand-asset-specs.ts';
const sq = (n: number) => ({ width: n, height: n });

export const LOGO_PLATFORMS: LogoPlatform[] = [
	{
		id: 'fantasy',
		name: 'Fantasy football sites',
		blurb: 'None of these publish an exact size, so each gets a 512 × 512 square: every one accepts it and shrinks it cleanly.',
		outputs: [
			// https://support.sleeper.com/en/articles/4427480-how-do-i-change-my-team-name-and-photo — no size given.
			{ id: 'sleeper', label: 'Sleeper team avatar', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `sleeper-avatar-${SAFE_SQUARE}`, source: 'https://support.sleeper.com/en/articles/4427480-how-do-i-change-my-team-name-and-photo', published: false },
			// https://support.espn.com/hc/en-us/articles/360000959152-Adding-a-Team-Logo — no size; uploads only in private (League Manager) leagues.
			{ id: 'espn', label: 'ESPN team logo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `espn-logo-${SAFE_SQUARE}`, source: 'https://support.espn.com/hc/en-us/articles/360000959152-Adding-a-Team-Logo', published: false },
			// https://help.yahoo.com/kb/SLN14315.html — no size given.
			{ id: 'yahoo', label: 'Yahoo team logo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `yahoo-logo-${SAFE_SQUARE}`, source: 'https://help.yahoo.com/kb/SLN14315.html', published: false },
			// NFL Fantasy publishes no logo size in its help center.
			{ id: 'nfl-com', label: 'NFL.com team logo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `nfl-com-logo-${SAFE_SQUARE}`, source: 'https://fantasy.nfl.com/', published: false },
			// CBS Sports publishes no logo size in its help center.
			{ id: 'cbs', label: 'CBS Sports team logo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `cbs-logo-${SAFE_SQUARE}`, source: 'https://www.cbssports.com/fantasy/', published: false },
			// Fleaflicker publishes no logo size.
			{ id: 'fleaflicker', label: 'Fleaflicker team logo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `fleaflicker-logo-${SAFE_SQUARE}`, source: 'https://www.fleaflicker.com/', published: false },
		],
	},
	{
		id: 'mfl',
		name: 'MyFantasyLeague and MFL.football',
		blurb: 'The sizes MFL.football league sites store and show. On MFL itself, paste the image address into your franchise Icon or Logo field.',
		outputs: [
			// Every MFL size below: src/utils/brand-asset-specs.ts (CREST_OUTPUTS).
			{ id: 'mfl-crest', label: 'Crest (master)', ...sq(CREST_OUTPUTS.crest), format: 'png', layout: 'square', file: `mfl-crest-${CREST_OUTPUTS.crest}`, source: SPECS, published: true },
			{ id: 'mfl-icon', label: 'Card icon', ...sq(CREST_OUTPUTS.cardIcon), format: 'png', layout: 'square', file: `mfl-icon-${CREST_OUTPUTS.cardIcon}`, source: SPECS, published: true },
			{ id: 'mfl-groupme', label: 'GroupMe post icon', ...sq(CREST_OUTPUTS.groupMe), format: 'png', layout: 'square', file: `mfl-groupme-${CREST_OUTPUTS.groupMe}`, source: SPECS, published: true },
			{ id: 'mfl-banner', label: 'Team banner', ...CREST_OUTPUTS.banner, format: 'png', layout: 'banner', solid: true, file: `mfl-banner-${CREST_OUTPUTS.banner.width}x${CREST_OUTPUTS.banner.height}`, source: SPECS, published: true },
			{ id: 'mfl-banner-2x', label: 'Team banner (sharp screens)', ...CREST_OUTPUTS.bannerRetina, format: 'png', layout: 'banner', solid: true, file: `mfl-banner-${CREST_OUTPUTS.bannerRetina.width}x${CREST_OUTPUTS.bannerRetina.height}`, source: SPECS, published: true },
			{ id: 'mfl-app-icon', label: 'App icon', ...sq(CREST_OUTPUTS.appIcon), format: 'png', layout: 'square', solid: true, file: `mfl-app-icon-${CREST_OUTPUTS.appIcon}`, source: SPECS, published: true },
		],
	},
	{
		id: 'chat',
		name: 'Group chats',
		blurb: 'For your league chat’s picture.',
		outputs: [
			// https://support.discord.com/hc/en-us/articles/4409388345495-Per-Server-Profiles — formats and 8 MB cap, no server icon size.
			{ id: 'discord-server', label: 'Discord server icon', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `discord-server-icon-${SAFE_SQUARE}`, source: 'https://support.discord.com/hc/en-us/articles/4409388345495-Per-Server-Profiles', published: false },
			// https://discord.com/blog/discord-profile-tips-from-design-professionals — "around 200x200 pixels at minimum", cropped to a circle.
			{ id: 'discord-avatar', label: 'Discord avatar', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `discord-avatar-${SAFE_SQUARE}`, source: 'https://discord.com/blog/discord-profile-tips-from-design-professionals', published: true },
			// https://dev.groupme.com/docs/image_service — GroupMe crops uploads to 60 × 60 avatars and 200 × 200 previews; no upload size.
			{ id: 'groupme', label: 'GroupMe group avatar', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `groupme-avatar-${SAFE_SQUARE}`, source: 'https://dev.groupme.com/docs/image_service', published: false },
			// https://docs.slack.dev/reference/methods/users.setPhoto — at least 512 × 512, at most 1024 × 1024.
			{ id: 'slack', label: 'Slack photo', ...sq(1024), format: 'png', layout: 'square', file: 'slack-photo-1024', source: 'https://docs.slack.dev/reference/methods/users.setPhoto', published: true },
		],
	},
	{
		id: 'social',
		name: 'Social profiles',
		blurb: 'Both crop to a circle, so keep the logo centered.',
		outputs: [
			// https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo — 400 × 400 recommended, 2 MB max.
			{ id: 'x', label: 'X profile photo', ...sq(400), format: 'png', layout: 'square', file: 'x-profile-400', source: 'https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo', published: true },
			// https://help.instagram.com/557544397610546 — no profile photo size given.
			{ id: 'instagram', label: 'Instagram profile photo', ...sq(SAFE_SQUARE), format: 'png', layout: 'square', file: `instagram-profile-${SAFE_SQUARE}`, source: 'https://help.instagram.com/557544397610546', published: false },
		],
	},
	{
		id: 'web',
		name: 'Website icons',
		blurb: 'Browser tab, phone home screen and Android icons for a league website.',
		outputs: [
			// The favicon set, from src/utils/brand-asset-specs.ts (CREST_OUTPUTS.favicons).
			...CREST_OUTPUTS.favicons.map((n): LogoOutput => ({
				id: `favicon-${n}`,
				label: n === 180 ? 'iPhone home screen' : `Favicon ${n}`,
				...sq(n),
				format: 'png',
				layout: 'square',
				// Apple fills a transparent home-screen icon with black.
				solid: n === 180 ? true : undefined,
				file: n === 180 ? 'apple-touch-icon-180' : `favicon-${n}`,
				source: SPECS,
				published: true,
			})),
		],
	},
	{
		id: 'print',
		name: 'Print',
		blurb: 'Shirts, trophies, stickers and banners. Ask the shop for its size; this covers about 10 inches at 300 dpi.',
		outputs: [
			// No platform: 3000 px is 10 in at 300 dpi, the resolution print shops ask for.
			{ id: 'print', label: 'Print (shirts, trophies)', ...sq(3000), format: 'png', layout: 'square', file: 'print-3000', source: 'none: 10 in at 300 dpi, a common print shop ask', published: false },
		],
	},
];

export const ALL_LOGO_OUTPUTS: LogoOutput[] = LOGO_PLATFORMS.flatMap((p) => p.outputs);
