/**
 * The four services MFL.football sells, written for search engines and AI
 * answer tools as much as for people: each page opens with a sentence that
 * answers "what is this?" on its own, and every FAQ answer stands alone, so a
 * tool that quotes one paragraph quotes something true and complete.
 *
 * Rendered by src/components/shared/marketing/ServicePage.astro, listed in
 * the sitemap (src/pages/sitemap.xml.ts) and in public/llms.txt — keep those
 * three in step when a service is added.
 *
 * Customer-facing copy only: the repo is public. Prices stay off these pages
 * except MFL Live Pro's, which is already public (Brandon, Oct 2026); every
 * paid service is a "coming soon" door (ProductInterest) until it is on sale.
 */
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

export type ServiceSlug = 'commissioner-tools' | 'league-history' | 'league-website' | 'skins';

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
		slug: 'commissioner-tools',
		path: '/mfl-commissioner-tools',
		navLabel: 'Commissioner tools',
		title: 'MFL Commissioner Tools: Automate Your MyFantasyLeague League | MFL.football',
		description:
			'Commissioner automation for MyFantasyLeague (MFL) leagues: reminders, draft order, dues and payouts, contracts, rules answers and chat posts, done for you.',
		eyebrow: 'MFL commissioner tools',
		h1: 'MFL commissioner tools that run your league for you',
		answer:
			'MFL.football (formerly MFL Addons) automates the jobs a MyFantasyLeague commissioner does by hand: deadline and lineup reminders, draft order, dues and prize payouts in MFL’s league books, contract and salary cap tracking, rules answers from your own constitution, and league news posted to your group chat.',
		lede: 'Your league stays on MyFantasyLeague. MFL.football reads it, does the busywork on a schedule, and writes the results back to MFL.',
		features: [
			{ title: 'Deadline and lineup reminders', body: 'Every owner gets a push before each deadline and a warning when their lineup has a problem before kickoff. The group chat only hears about the owners a push could not reach.' },
			{ title: 'Draft order and the draft room', body: 'Draft order with every traded pick, a live draft room, mock drafts and a draft-day broadcast board for the TV.' },
			{ title: 'Dues and prize payouts', body: 'The season’s payouts are written straight into MFL’s league books from your prize table in one step, and balances carry into the next league year.' },
			{ title: 'Contracts and the salary cap', body: 'Contracts, extensions, franchise tags, dead money and cap projections for dynasty and salary cap leagues.' },
			{ title: 'A rules assistant', body: 'Owners ask a rules question and get the answer from your league’s own constitution, on the site or in the group chat.' },
			{ title: 'League news written for you', body: 'An AI league reporter breaks every trade and signing and writes weekly recaps and power rankings about your real teams.' },
			{ title: 'Group chat bot', body: 'News, reminders and answers posted straight into your league’s GroupMe.' },
			{ title: 'Push notifications', body: 'Trade offers, lineup problems, deadlines and player news pushed to each owner’s phone. Every category is opt-in.' },
		],
		examplePaths: [
			{ label: 'Rules assistant', suffix: '/rules-chat', body: 'Ask a rules question and get the league’s own answer.' },
			{ label: 'Draft hub', suffix: '/draft', body: 'Draft order, traded picks and results.' },
			{ label: 'Power rankings', suffix: '/pecking-order', body: 'The weekly column, written for the league.' },
		],
		faqs: [
			{ q: 'What is commissioner automation for an MFL league?', a: 'It is software that does a MyFantasyLeague commissioner’s recurring chores on a schedule: reminding owners about deadlines and lineups, keeping the draft order, writing dues and prize payouts into MFL’s league books, tracking contracts and the salary cap, and posting league news to the group chat.' },
			{ q: 'Do we have to leave MyFantasyLeague?', a: 'No. Your league keeps running on MyFantasyLeague. MFL.football reads your league from MFL, and anything it changes, like a lineup or a payout, is written back to MFL.' },
			{ q: 'Do owners need a new account?', a: 'No. Owners sign in with the MyFantasyLeague username and password they already use.' },
			{ q: 'How is this different from free MFL scripts like Habman’s?', a: 'Free MFL scripts are code you paste into your league’s MFL pages to change what those pages show. MFL.football runs on its own servers and does work on a schedule even when nobody has a page open: sending reminders, writing payouts and posting news.' },
			{ q: 'Which group chats does it support?', a: 'GroupMe today. News, reminders and rules answers are posted straight into your league’s GroupMe.' },
			{ q: 'What does it cost?', a: 'Commissioner automation is part of a custom league package: a one-time setup fee, then a yearly fee to run your league. It is not on sale yet; tap “I’m interested” and we will email you when it is.' },
		],
		cta: { kind: 'interest', product: 'league-package', label: 'I’m interested', name: 'Commissioner automation' },
		secondary: { href: '/custom-mfl-league-website', label: 'See custom league websites' },
	},
	{
		slug: 'league-history',
		path: '/mfl-league-history',
		navLabel: 'League history',
		title: 'MFL League History: Records, All-Time Stats and Rivalries | MFL.football',
		description:
			'A complete history site for your MyFantasyLeague (MFL) league: champions, standings, all-time records, head-to-head rivalries, owner pages and trophy cases.',
		eyebrow: 'MFL league history',
		h1: 'MFL league history: every season, record and rivalry',
		answer:
			'MFL.football (formerly MFL Addons) builds a complete history site for a MyFantasyLeague league: champions, season-by-season standings and playoffs, all-time records, head-to-head rivalries, owner pages and a trophy case for every franchise, back to the league’s first season.',
		lede: 'MyFantasyLeague keeps each season as its own league. MFL.football stitches every season into one timeline, so a franchise keeps its history through every name and logo change.',
		features: [
			{ title: 'Champions and the rafters', body: 'Every title your league has awarded, hung as a banner in the winning team’s colors from that season.' },
			{ title: 'Record book', body: 'All-time records for teams and players, with charts that show how far ahead the record is and how it has moved over the years.' },
			{ title: 'Head-to-head rivalries', body: 'Every pair of teams, with each game listed, the all-time series, and the league’s hottest rivalries picked automatically.' },
			{ title: 'Franchise pages', body: 'One page per franchise that follows it through every name, logo and owner.' },
			{ title: 'Owner pages', body: 'One page per person, following them across every franchise they have held.' },
			{ title: 'Rebuilt seasons', body: 'Seasons that are on no platform any more can be added back at whatever detail you have, from just a champion up to weekly scores.' },
		],
		examplePaths: [
			{ label: 'League history', suffix: '/history', body: 'The rafters, dynasties and every season at a glance.' },
			{ label: 'Record book', suffix: '/history/record-book', body: 'All-time records with charts.' },
			{ label: 'Rivalries', suffix: '/rivalries', body: 'Every head-to-head series in the league.' },
		],
		faqs: [
			{ q: 'Does MyFantasyLeague keep league history?', a: 'MyFantasyLeague keeps each season, but as a separate league year. MFL.football reads every year and joins them into one history with all-time records, rivalries and franchise timelines.' },
			{ q: 'How far back can the history go?', a: 'Back to your league’s first MyFantasyLeague season. Seasons from before MFL, or from another platform, can be rebuilt by hand at whatever detail you have.' },
			{ q: 'What happens when a team changes its name or owner?', a: 'The franchise keeps one page through every name and logo, and each owner gets their own page that follows them across every team they have run.' },
			{ q: 'How is this different from MFLHistory.com?', a: 'Both turn your MFL league into a history site. MFL.football is built for phones first, uses your teams’ own logos and colors, and adds rivalry pages, record charts and owner pages.' },
			{ q: 'Can I see a real example?', a: 'Yes. The League and the AFL, two MFL leagues that have played since 2007 and 2003, run on it. The links on this page go to their live history pages.' },
			{ q: 'When can my league get it?', a: 'League history runs today for the leagues we host and is coming to any MFL league. Tap “I’m interested” and we will email you when it opens.' },
		],
		cta: { kind: 'interest', product: 'league-history', label: 'I’m interested', name: 'League history for your MFL league' },
		secondary: { href: '/custom-mfl-league-website', label: 'Or get it with a custom league website' },
	},
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
			{ title: 'Draft hub', body: 'Draft order with traded picks, a live draft room, mock drafts and full results history.' },
			{ title: 'League news', body: 'An AI league reporter, weekly power rankings and recaps, posted to the site and your group chat.' },
			{ title: 'League history built in', body: 'Champions, records, rivalries and a trophy case for every franchise.' },
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
			{ q: 'What does it cost?', a: 'A yearly fee for a branded site built from existing features, or a setup fee plus a yearly fee for a site with features built for your league. Tap “I’m interested” and we will be in touch.' },
		],
		cta: { kind: 'interest', product: 'league-hub', label: 'I’m interested', name: 'A custom MFL league website' },
		secondary: { href: 'https://demo.mfl.football', label: 'Try the live demo' },
	},
	{
		slug: 'skins',
		path: '/mfl-skins',
		navLabel: 'MFL skins',
		title: 'Free MFL Skins and Templates for MyFantasyLeague | MFL.football',
		description:
			'Free skins for MyFantasyLeague (MFL): light and dark themes plus a homepage, header and footer template, with step-by-step install instructions.',
		eyebrow: 'Free MFL skins',
		h1: 'Free MFL skins and templates',
		answer:
			'MFL.football (formerly MFL Addons) offers free skins for MyFantasyLeague: light and dark themes for your league’s MFL pages, plus a homepage, header and footer template, installed from your league’s setup pages with no code to write.',
		lede: 'Pick a theme, paste one address into MFL, and your league’s pages take on the new look.',
		features: [
			{ title: 'Light and dark themes', body: 'A dark theme, a dark theme with DIN headings, and a light blue-and-green theme.' },
			{ title: 'Homepage, header and footer', body: 'Ready-made homepage, header and footer messages for MFL, with copy buttons.' },
			{ title: 'Step-by-step install', body: 'Choose the skin, paste the CSS address under Images and Other URLs, then add the messages. Every step is written out.' },
			{ title: 'Icons', body: 'A shared icon set your league’s pages can use.' },
		],
		examplePaths: [],
		faqs: [
			{ q: 'What is an MFL skin?', a: 'A skin is the look of your league’s pages on MyFantasyLeague: colors, fonts and layout. MFL has built-in skins, and a league can load its own with a CSS address.' },
			{ q: 'Are these skins free?', a: 'Yes. The skins, templates and instructions are free, with no account needed.' },
			{ q: 'How do I install a custom skin on MFL?', a: 'On your league’s Select a skin page choose None, then go to Images and Other URLs and paste the skin’s CSS address into the CSS URL field. The instructions page has the addresses and every step.' },
			{ q: 'How is this different from MFL’s default skins?', a: 'MFL’s built-in skins change colors. These themes restyle the pages for phones and dark mode, and come with a homepage, header and footer to match.' },
			{ q: 'Can I get a site that goes further than a skin?', a: 'Yes. A custom MFL league website replaces the skin with a full site on your own domain, with live scoring, league news, history and more.' },
		],
		cta: { kind: 'link', href: '/instructions', label: 'Get the free skin' },
		secondary: { href: '/custom-mfl-league-website', label: 'Want more? See custom league websites' },
	},
];

export function findService(slug: ServiceSlug): Service {
	const service = SERVICES.find((s) => s.slug === slug);
	if (!service) throw new Error(`Unknown service: ${slug}`);
	return service;
}

/**
 * The comparison page: how MFL.football sits next to the other ways an MFL
 * league customizes itself. Every cell is a general, checkable statement; a
 * competitor's price or feature list is never quoted, because it changes and
 * we would be publishing it as fact.
 */
export const COMPARISON = {
	columns: ['MFL.football', 'Free MFL scripts (Habman)', 'MFLHistory.com', 'Default MFL skins'],
	rows: [
		{ label: 'What it is', values: ['Your league’s own website, automation and history, run for you', 'Free scripts pasted into your MFL pages', 'A history site for MFL leagues', 'The looks built into MyFantasyLeague'] },
		{ label: 'Where it runs', values: ['Its own site, on your domain', 'Inside MFL’s pages', 'Its own site', 'Inside MFL’s pages'] },
		{ label: 'League history and records', values: ['Yes, with rivalries, owner pages and record charts', 'Depends on the script', 'Yes', 'MFL’s own reports'] },
		{ label: 'Works on a schedule when nobody is on the site', values: ['Yes: reminders, payouts, news posts', 'No', 'No', 'No'] },
		{ label: 'Lineups and trades synced to MFL', values: ['Yes', 'Uses MFL’s own pages', 'No', 'Uses MFL’s own pages'] },
		{ label: 'Your teams’ logos and colors throughout', values: ['Yes, in light and dark', 'Depends on the script', 'Varies', 'No'] },
		{ label: 'Built for phones', values: ['Yes, installs like an app', 'Depends on the script', 'Varies', 'MFL’s mobile pages'] },
		{ label: 'Cost', values: ['Free skins and live scores; paid sites and history', 'Free', 'Paid', 'Included with MFL'] },
	],
	faqs: [
		{ q: 'What is the best way to customize an MFL league?', a: 'It depends how far you want to go. A free skin changes how your MFL pages look. Free scripts add features inside MFL’s pages. A history site keeps your records. A custom league website, like the ones MFL.football builds, gives your league its own site with automation and history included.' },
		{ q: 'Can I use free MFL scripts and MFL.football together?', a: 'Yes. Scripts live inside your MFL pages and MFL.football runs on its own site, so a league can keep using both.' },
		{ q: 'Is MFL.football the same as MFL Addons?', a: 'Yes. MFL Addons is now MFL.football, and mfladdons.com points here.' },
	] as Faq[],
};

export const ABOUT_FAQS: Faq[] = [
	{ q: 'What happened to MFL Addons?', a: 'MFL Addons is now MFL.football. The same builder makes skins, tools and league websites for MyFantasyLeague, and mfladdons.com now points to mfl.football.' },
	{ q: 'Is MFL.football part of MyFantasyLeague?', a: 'No. MFL.football is an independent service built on MyFantasyLeague’s public API. Your league keeps running on MFL.' },
	{ q: 'What does MFL.football offer?', a: 'Free MFL skins and live scores, commissioner automation, league history, and custom league websites for MyFantasyLeague leagues.' },
];
