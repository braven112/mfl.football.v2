/**
 * The service pages MFL.football keeps (commissioner tools, league history and
 * skins were cut 2026-11-14; /features carries what they described), written for search engines and AI
 * answer tools as much as for people: each page opens with a sentence that
 * answers "what is this?" on its own, and every FAQ answer stands alone, so a
 * tool that quotes one paragraph quotes something true and complete.
 *
 * Rendered by src/components/shared/marketing/ServicePage.astro, listed in
 * the sitemap (src/pages/sitemap.xml.ts) and in public/llms.txt — keep those
 * three in step when a service is added.
 *
 * Customer-facing copy only: the repo is public. Prices stay off these pages
 * except MFL Live Pro's, which is already public (Brandon, Oct 2026), and the
 * seasonal-theme fee (Brandon, 2026-11-05); every
 * paid service is a "coming soon" door (ProductInterest) until it is on sale.
 */
import { SEASONAL_THEME_INCLUDES, SEASONAL_THEME_PRICE } from './products';
import type { ProductSlug } from './products';

/** The brand the site carries forward. One spelling, everywhere. */
export const FORMER_BRAND = 'MFL Addons';
export const FORMER_DOMAIN = 'mfladdons.com';

export interface Faq {
	q: string;
	a: string;
}

/**
 * A live page on a league we run, shown as an example. `path` is the league's
 * own prefixed path; the page resolves it per host with crossHostLeagueHref.
 */
export interface ServiceExample {
	label: string;
	path: string;
	body: string;
}

export interface ServiceFeature {
	title: string;
	body: string;
}

export type ServiceSlug = 'league-website' | 'seasonal-themes';

export interface Service {
	slug: ServiceSlug;
	/** The page's path on the shared host. Written to match how people search. */
	path: string;
	/** Short label for menus and footers. */
	navLabel: string;
	/** <title>. Leads with the phrase people search for. */
	title: string;
	/** Meta description: under ~155 characters, one complete sentence or two. */
	description: string;
	eyebrow: string;
	h1: string;
	/** The answer-first opening. Must stand alone if quoted by itself. */
	answer: string;
	lede: string;
	features: ServiceFeature[];
	/** Example pages, as `/<league slug>/...` paths, per advertised league. */
	examplePaths: Array<{ label: string; suffix: string; body: string }>;
	faqs: Faq[];
	/** The primary action: a fake door for a product not on sale, or a real link. */
	cta:
		| { kind: 'interest'; product: ProductSlug; label: string; name: string }
		| { kind: 'link'; href: string; label: string };
	/** A secondary link under the primary action. */
	secondary?: { href: string; label: string };
}

export const SERVICES: Service[] = [
	{
		slug: 'league-website',
		path: '/custom-mfl-league-website',
		navLabel: 'League websites',
		title: 'Custom MFL League Website on Your Own Domain | MFL.football',
		description:
			'A custom website for your MyFantasyLeague (MFL) league on your own domain, with your logos and colors. Owners set lineups and make trades, synced to MFL.',
		eyebrow: 'Custom MFL league website',
		h1: 'A custom website for your MFL league',
		answer:
			'MFL.football (formerly MFL Addons) builds custom websites for MyFantasyLeague leagues, on your own domain, wearing your league’s name, crest and colors. Owners set lineups, make trades and claim players on the site, and every change goes straight to MFL.',
		lede: 'Built for phones first, in light and dark themes, and updated every week so new features reach your league without you asking.',
		features: [
			{ title: 'Your domain and your brand', body: 'Your league’s name, crest and colors, plus every franchise’s logo, in light and dark versions.' },
			{ title: 'Lineups, trades and roster moves', body: 'Set lineups, build and answer trades, claim and cut players. Every change is sent straight to MyFantasyLeague.' },
			{ title: 'Live scoring', body: 'Every matchup live, with projections, win probability and a broadcast board for the TV.' },
			{ title: 'A homepage for every day', body: 'The homepage hero changes with the calendar and leads with what the league needs to do today.' },
			{ title: 'Your own beat reporter', body: 'An AI beat reporter your league names, with weekly power rankings and recaps, posted to the site and your group chat.' },
			{ title: 'League history built in', body: 'Champions, records, rivalries and a trophy case for every franchise, plus Ask the History for any question about the league’s past.' },
			{ title: 'Installs like an app', body: 'Owners add the site to their home screen and get push notifications for the things they choose.' },
			{ title: 'Custom features', body: 'Side games, custom standings, prizes and dynasty tools built for how your league plays.' },
		],
		examplePaths: [
			{ label: 'League homepage', suffix: '', body: 'The weekly hero, deadlines, standings and news.' },
			{ label: 'Rosters', suffix: '/rosters', body: 'Every roster, with contracts and the cap.' },
			{ label: 'Standings', suffix: '/standings', body: 'Division, playoff and all-play standings.' },
		],
		faqs: [
			{ q: 'Can I have a custom website for my MFL league?', a: 'Yes. MFL.football builds a website for your MyFantasyLeague league on your own domain. The league still runs on MFL; the site reads from it and writes changes back to it.' },
			{ q: 'Do owners still use MyFantasyLeague?', a: 'They can, but they do not have to. Lineups, trades, waiver claims and cuts made on your site are sent straight to MFL, and anything done on MFL shows up on the site.' },
			{ q: 'Will it work on phones?', a: 'Yes. Every page is built for phones first, and the site installs to the home screen like an app.' },
			{ q: 'What kinds of leagues does it support?', a: 'Dynasty, keeper, redraft and salary cap leagues, from small leagues to leagues with a hundred teams.' },
			{ q: 'Can I try it first?', a: 'Yes. The live demo builds a private copy of the site for your league format, so you can click through it before you decide.' },
			{ q: 'What does it cost?', a: 'A setup fee that includes your first year, then a yearly renewal. Every feature is included, along with most league-specific standings, salary cap rules and side games. Tap “I’m interested” and we will be in touch.' },
		],
		cta: { kind: 'interest', product: 'league-package', label: 'I’m interested', name: 'A custom MFL league website' },
		secondary: { href: 'https://demo.mfl.football', label: 'Try the live demo' },
	},
	{
		slug: 'seasonal-themes',
		path: '/mfl-league-themes',
		navLabel: 'Seasonal themes',
		title: 'Seasonal Themes for Your MFL League Website | MFL.football',
		description:
			'Halloween, Christmas or your own league event: your MFL league site changes its colors and redraws every team and league logo, then changes back on its own.',
		eyebrow: 'Seasonal themes',
		h1: 'Seasonal themes for your MFL league site',
		answer:
			`MFL.football (formerly MFL Addons) gives a MyFantasyLeague league’s site seasonal themes: new colors and every logo redrawn for Halloween, Christmas or your own event, then back to normal on its own. Each theme is a one-time ${SEASONAL_THEME_PRICE}, including ${SEASONAL_THEME_INCLUDES}.`,
		lede: `A one-time ${SEASONAL_THEME_PRICE} per theme, including ${SEASONAL_THEME_INCLUDES}. Each theme opens and closes on its own dates.`,
		features: [
			{ title: 'A new look for the whole site', body: 'Colors, headline type and decorations change across every page, in light and dark.' },
			{ title: 'Every logo redrawn', body: 'Each team’s logo, every division and tier logo and the league logo are remade for the theme, so a franchise keeps its identity in costume.' },
			{ title: 'On and off by itself', body: 'Each theme runs on its own dates and switches back afterward. Nothing to schedule and nothing to undo.' },
			{ title: 'Your own season', body: 'Have an event only your league celebrates? We build a color theme just for it, such as Breast Cancer Awareness Month, Military Appreciation Month or Thanksgiving, for the week or two you choose, with the same logo remakes.' },
		],
		examplePaths: [],
		faqs: [
			{ q: 'What is a seasonal theme for an MFL league site?', a: 'It is a temporary new look for your league’s website: new colors, decorations and redrawn team and league logos for a week or two around a holiday or event, after which the site returns to its regular look on its own.' },
			{ q: 'Which themes are available?', a: 'Halloween and Christmas Week run today on The League and the AFL. A league can also have its own season built for an event of its own, on the dates it picks.' },
			{ q: 'Are the logos really redrawn?', a: 'Yes. Every team logo, every division and tier logo and the league logo is remade for each theme. The examples on this page are the real logos from two MFL leagues.' },
			{ q: 'Does a theme change anything on MyFantasyLeague?', a: 'No. The theme changes your league’s own website only. Rosters, lineups and scoring on MyFantasyLeague are untouched.' },
			{ q: 'What does it cost?', a: `Each theme is a one-time ${SEASONAL_THEME_PRICE}, an add-on to a custom league website. That includes remaking ${SEASONAL_THEME_INCLUDES}; bigger leagues, ask us. Tap “I’m interested” and we will email you.` },
		],
		cta: { kind: 'interest', product: 'add-ons', label: 'I’m interested', name: 'Seasonal themes' },
		secondary: { href: '/custom-mfl-league-website', label: 'See custom league websites' },
	},
];

export function findService(slug: ServiceSlug): Service {
	const service = SERVICES.find((s) => s.slug === slug);
	if (!service) throw new Error(`Unknown service: ${slug}`);
	return service;
}

/**
 * The shared-host footer, one list for the homepage and every MarketingShell
 * page (Brandon, 2026-11-14: Add-ons and Privacy belong there). Grouped
 * loosely: what we sell, onboarding, free products, then the fine print.
 */
export const SITE_FOOTER_LINKS: Array<{ href: string; label: string }> = [
	{ href: '/features', label: 'Features' },
	{ href: '/pricing', label: 'Pricing' },
	...SERVICES.map((s) => ({ href: s.path, label: s.eyebrow })),
	{ href: '/get-started', label: 'Get started' },
	{ href: '/live', label: 'Live scores' },
	{ href: '/tv', label: 'Watch on TV' },
	{ href: '/team-logo', label: 'Free logo maker' },
	{ href: '/video', label: 'Free season video' },
	{ href: '/instructions', label: 'Template instructions' },
	{ href: '/addons', label: 'Add-ons' },
	{ href: '/brand', label: 'Brand Book' },
	{ href: '/privacy', label: 'Privacy' },
];
