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
 * Customer-facing copy only: the repo is public. Since 2026-11-16 the three
 * products the homepage sells (Ask the History, the AI Beat Reporter, custom
 * sites) each show their price here, read from src/data/pricing.ts, so the
 * homepage, these pages and /pricing can never disagree. Every paid service is
 * still a "coming soon" door (ProductInterest) until it is on sale.
 */
import { HISTORIAN } from './historian';
import { SEASONAL_THEME_INCLUDES, SEASONAL_THEME_PRICE } from './products';
import {
	BEAT_REPORTER_PRICE_YEAR,
	CUSTOM_FROM_SETUP,
	HISTORY_AND_REPORTER_PRICE_YEAR,
	HISTORY_PRICE_YEAR,
	dollars,
} from './pricing';
import type { InterestSlug } from '../utils/product-interest';

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

export type ServiceSlug = 'ask-the-history' | 'beat-reporter' | 'league-website' | 'seasonal-themes';

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
	/** The price under the hero: "$49" + "a year". Read from pricing.ts, never typed. */
	price?: { amount: string; unit: string; note?: string };
	/** A picture beside the hero copy (the reporter's avatar). */
	portrait?: { src: string; alt: string };
	features: ServiceFeature[];
	/** Example pages, as `/<league slug>/...` paths, per advertised league. */
	examplePaths: Array<{ label: string; suffix: string; body: string }>;
	faqs: Faq[];
	/** The primary action: a fake door for a product not on sale, or a real link. */
	cta:
		| { kind: 'interest'; product: InterestSlug; label: string; name: string }
		| { kind: 'link'; href: string; label: string };
	/** A secondary link under the primary action. */
	secondary?: { href: string; label: string };
}

/** The two $49 products cost less together; each page says so under its price. */
const BUNDLE_NOTE_HISTORY = `Add the AI Beat Reporter: both for ${dollars(HISTORY_AND_REPORTER_PRICE_YEAR)} a year`;
const BUNDLE_NOTE_REPORTER = `Add Ask the History: both for ${dollars(HISTORY_AND_REPORTER_PRICE_YEAR)} a year`;

export const SERVICES: Service[] = [
	{
		slug: 'ask-the-history',
		path: '/ask-the-history',
		navLabel: 'Ask the History',
		title: 'Ask the History: AI League History for Your MFL League | MFL.football',
		description: `Every season of your MyFantasyLeague league in one place, and an AI you can ask anything about its past. ${dollars(HISTORY_PRICE_YEAR)} a year per league.`,
		eyebrow: 'Ask the History',
		h1: 'Ask the History for your MFL league',
		answer: `MFL.football (formerly MFL Addons) turns every season of a MyFantasyLeague league into one history site: champions, records, rivalries and every franchise and owner, plus Rex Ordbook, an AI league historian who answers any question about your league’s past. It is ${dollars(HISTORY_PRICE_YEAR)} a year per league.`,
		lede: 'Ask who has won the most titles, which rivalry is the most lopsided, or what happened the last time two teams met in the playoffs. Answers come from your league’s own records, every season back to the first.',
		price: { amount: dollars(HISTORY_PRICE_YEAR), unit: 'a year per league', note: BUNDLE_NOTE_HISTORY },
		portrait: { src: HISTORIAN.avatar, alt: HISTORIAN.alt },
		features: [
			{ title: 'Ask anything', body: 'Type a question in plain English and Rex Ordbook answers from your league’s own records, with the seasons and games behind it.' },
			{ title: 'Every champion and season', body: 'Champions, standings and playoffs for every season, back to the league’s first year on MFL.' },
			{ title: 'Records and rivalries', body: 'The all-time record book, and every head-to-head rivalry with each game listed.' },
			{ title: 'Franchises and owners', body: 'A page for every franchise through every name, logo and owner, with a trophy case.' },
			{ title: 'Kept up to date', body: 'Each finished season is added on its own. Nothing to export and nothing to upload.' },
			{ title: 'Built for phones', body: 'Fast on a phone, in light and dark, and easy to share in the group chat.' },
		],
		examplePaths: [
			{ label: 'Ask the History', suffix: '/history/ask', body: 'Ask a question about the league’s past.' },
			{ label: 'League history', suffix: '/history', body: 'Every champion, season and record.' },
			{ label: 'Record book', suffix: '/history/record-book', body: 'The all-time records, by team and by season.' },
		],
		faqs: [
			{ q: 'What is Ask the History?', a: 'It is an AI that answers questions about your MyFantasyLeague league’s past, such as who has the most titles or how two teams have done against each other, using your league’s own records.' },
			{ q: 'Who is Rex Ordbook?', a: 'Rex Ordbook is your league’s historian, the name and face on every Ask the History answer. He has read every season on record, and he answers only from those records, so every number comes with the games behind it.' },
			{ q: 'How far back does it go?', a: 'To your league’s first season on MyFantasyLeague. Every season MFL has is read in, and each new season is added when it finishes.' },
			{ q: 'Do I have to upload anything?', a: 'No. We read your league’s history straight from MyFantasyLeague. You only tell us your league id.' },
			{ q: 'Does it change anything on MFL?', a: 'No. Ask the History only reads your league. Rosters, lineups and scoring on MyFantasyLeague are untouched.' },
			{ q: 'What does it cost?', a: `${dollars(HISTORY_PRICE_YEAR)} a year per league. Add the AI Beat Reporter and both are ${dollars(HISTORY_AND_REPORTER_PRICE_YEAR)} a year. Tap “I’m interested” and we will email you when it opens.` },
		],
		cta: { kind: 'interest', product: 'league-history', label: 'Get started', name: `Ask the History, ${dollars(HISTORY_PRICE_YEAR)} a year` },
		secondary: { href: '/ai-beat-reporter', label: 'Add the AI Beat Reporter' },
	},
	{
		slug: 'beat-reporter',
		path: '/ai-beat-reporter',
		navLabel: 'AI Beat Reporter',
		title: 'AI Beat Reporter for Your MFL League | MFL.football',
		description: `Max Insider, an AI beat reporter, breaks every trade and move in your MyFantasyLeague league and writes its weekly columns. ${dollars(BEAT_REPORTER_PRICE_YEAR)} a year.`,
		eyebrow: 'AI Beat Reporter',
		h1: 'An AI beat reporter for your MFL league',
		answer: `MFL.football (formerly MFL Addons) gives a MyFantasyLeague league its own AI beat reporter, Max Insider. He breaks every trade, signing and cut as it happens and writes the league’s weekly columns, right on your league’s MFL home page. It is ${dollars(BEAT_REPORTER_PRICE_YEAR)} a year per league.`,
		lede: 'Max reads your league the way a real insider covers a team: who is buying, who is selling, who just got fleeced. Vegas Vic brings the lines, and Doc Rivers covers the injuries.',
		price: { amount: dollars(BEAT_REPORTER_PRICE_YEAR), unit: 'a year per league', note: BUNDLE_NOTE_REPORTER },
		portrait: { src: '/assets/beat-reporter-avatar.webp', alt: 'Max Insider, the AI beat reporter' },
		features: [
			{ title: 'Breaking news', body: 'Every trade, waiver claim, signing and cut, reported minutes after it happens, in a voice your owners will quote.' },
			{ title: 'Weekly columns', body: 'Recaps, previews and the stories behind the standings, written about your league and nobody else’s.' },
			{ title: 'Vegas Vic and Doc Rivers', body: 'Vic sets the lines on every matchup. Doc tracks the injuries that matter to your rosters.' },
			{ title: 'On your MFL home page', body: 'One line pasted into your MFL Home Page Message and the news appears on your league’s own MFL pages.' },
			{ title: 'Your league, in your colors', body: 'The news card wears your league’s colors and shows each owner what is new since their last visit.' },
			{ title: 'Nothing to run', body: 'No prompts and no posting. Max watches the league around the clock and files on his own.' },
		],
		examplePaths: [
			{ label: 'League news', suffix: '/news', body: 'Every post the league’s reporter has filed.' },
		],
		faqs: [
			{ q: 'What is an AI beat reporter?', a: 'It is an AI writer that covers your MyFantasyLeague league like a sports insider: it reports every trade and roster move as it happens and writes weekly columns about your league.' },
			{ q: 'Who is Max Insider?', a: 'Max Insider is our house reporter, the voice every league gets. He writes in the style of a TV insider, with breaking news, hot takes and the occasional told-you-so.' },
			{ q: 'Where do the posts show up?', a: 'On your league’s MyFantasyLeague home page. The commissioner pastes one line into the MFL Home Page Message, and the news card appears for every owner.' },
			{ q: 'Does it change anything on MFL?', a: 'No. The reporter only reads your league. It never touches rosters, lineups or scoring.' },
			{ q: 'What does it cost?', a: `${dollars(BEAT_REPORTER_PRICE_YEAR)} a year per league. Add Ask the History and both are ${dollars(HISTORY_AND_REPORTER_PRICE_YEAR)} a year. Tap “I’m interested” and we will email you when it opens.` },
		],
		cta: { kind: 'interest', product: 'beat-reporter', label: 'Get started', name: `the AI Beat Reporter, ${dollars(BEAT_REPORTER_PRICE_YEAR)} a year` },
		secondary: { href: '/ask-the-history', label: 'Add Ask the History' },
	},
	{
		slug: 'league-website',
		path: '/custom-mfl-league-website',
		navLabel: 'Custom sites',
		title: 'Custom MFL League Website on Your Own Domain | MFL.football',
		description:
			'A custom website for your MyFantasyLeague (MFL) league on your own domain, with your logos and colors. Owners set lineups and make trades, synced to MFL.',
		eyebrow: 'Custom MFL league website',
		h1: 'A custom website for your MFL league',
		answer:
			'MFL.football (formerly MFL Addons) builds custom websites for MyFantasyLeague leagues, on your own domain, wearing your league’s name, crest and colors. Owners set lineups, make trades and claim players on the site, and every change goes straight to MFL.',
		lede: 'Built for phones first, in light and dark themes, and updated every week so new features reach your league without you asking. Ask the History and the AI Beat Reporter are included.',
		price: { amount: `From ${dollars(CUSTOM_FROM_SETUP)}`, unit: 'setup and your first year', note: 'Priced by league size' },
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
 * The shared-host header: Home and the three products, nothing else
 * (Brandon, 2026-11-16). The homepage and every MarketingShell page read it.
 */
export const SITE_HEADER_LINKS: Array<{ href: string; label: string }> = [
	{ href: '/', label: 'Home' },
	...(['ask-the-history', 'beat-reporter', 'league-website'] as const).map((slug) => {
		const s = findService(slug);
		return { href: s.path, label: s.navLabel };
	}),
];

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
