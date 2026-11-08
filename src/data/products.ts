/**
 * The product lineup — the customer-facing half of each product page
 * (`/products`, `/products/<slug>`, `/products/features`).
 *
 * THIS FILE IS PUBLIC. The repository is public on GitHub, so only copy a
 * customer could read goes here. Costs, margins, build status, client names
 * and legal to-dos live in the business plan doc, one tab per product.
 * `tests/product-pages.test.ts` scans this file for the obvious leaks.
 *
 * ORDER IS LOAD-BEARING: a product may only build on products earlier in the
 * list (pinned by the same test). The custom site comes first.
 *
 * Shared platform features are described ONCE, in `FEATURES`, and every
 * product lists the ids it includes; the catalog page shows each feature
 * with the products that include it.
 */

import { getCurrentSeasonYear } from '../utils/league-year';
import { nflWeekEndIsoDate, nflWeekStartInstant } from '../utils/nfl-week-starts.mjs';

/**
 * We sell custom league sites only (Brandon, 2026-11-08). Every feature comes
 * with one, and the contest version is quoted to order. Seasonal themes
 * (`add-ons`, the slug its interest counts were recorded under) are sold only
 * on their own page. League History is sold on its own page
 * (/history), not here.
 */
export type ProductSlug = 'league-package' | 'contest-package' | 'add-ons';

export type FeatureId =
	| 'live-scoreboard'
	| 'league-boards'
	| 'broadcast-board'
	| 'game-day-alerts'
	| 'game-day-planner'
	| 'branded-site'
	| 'draft-hub'
	| 'ai-reporter'
	| 'rules-assistant'
	| 'group-chat-bot'
	| 'push-notifications'
	| 'owner-moves'
	| 'power-rankings'
	| 'custom-rankings'
	| 'contracts-cap'
	| 'league-books';

/**
 * A screenshot of the real site, reused from the What's New library
 * (`public/assets/whats-new/`). `darkSrc` is the dark-theme capture; both
 * render and CSS shows the one matching the theme (`ThemeImage`).
 * `tests/product-pages.test.ts` fails on a path that does not exist.
 */
export interface Screenshot {
	src: string;
	darkSrc?: string;
	alt: string;
}

/** A What's New screenshot; `dark: false` for the few captured in light only. */
const shot = (file: string, alt: string, { dark = true } = {}): Screenshot => {
	const src = `/assets/whats-new/${file}`;
	return { src, darkSrc: dark ? src.replace(/\.(webp|jpg)$/, '-dark.$1') : undefined, alt };
};

export interface Feature {
	id: FeatureId;
	name: string;
	/** Shown in the catalog and as a thumbnail on every product page that includes it. */
	screenshot?: Screenshot;
	/** One line, shown on every product page that includes it. */
	summary: string;
	/** The detail, shown once, in the catalog. */
	details: string[];
}

export interface TierTable {
	heading: string;
	columns: string[];
	rows: { label: string; values: string[] }[];
	note?: string;
}

export interface SectionItem {
	title: string;
	price?: string;
	body: string;
	bullets?: string[];
}

export interface ProductSection {
	heading: string;
	body?: string;
	bullets?: string[];
	items?: SectionItem[];
}

export interface Product {
	slug: ProductSlug;
	kind: 'owner' | 'league' | 'addon' | 'contest';
	name: string;
	/** Short price line: the eyebrow on the page, the right edge of the index card. */
	price: string;
	tagline: string;
	buyer: string;
	/** The product page's hero image and the thumbnail on its index card. */
	screenshot?: Screenshot;
	summary: string[];
	/** Earlier products this one includes or extends — linked, never restated. */
	buildsOn?: ProductSlug[];
	features?: FeatureId[];
	tiers?: TierTable;
	sections: ProductSection[];
	/**
	 * A time-limited offer shown beside the price table, or null when none is
	 * running at `now`. A function, not a string, so the page asks at request
	 * time and the offer ends on its own.
	 */
	offer?: (now: Date) => string | null;
}

export const FEATURES: Feature[] = [
	{
		id: 'live-scoreboard',
		name: 'Live scoreboard across every league',
		screenshot: shot('live-scoring.webp', 'Live scoreboard: your matchup on top, your other leagues’ games below, each with score, projection and players yet to play.'),
		summary: 'Every matchup you have, in every MFL league you play in, on one phone screen.',
		details: [
			'Sign in once with your MyFantasyLeague account; every league on it appears, including leagues we do not host.',
			'Each matchup is one row: score, players yet to play, projected final and win probability. Tap it for the starters.',
			'A scoring ticker and a red-zone banner across all your leagues, plus the day’s NFL games.',
			'Standings for all your leagues stacked on one page. Final for everyone; Live and Projected, which re-rank the table as the games play, with Pro.',
			'Switch any league off; installs to your home screen; light and dark themes.',
		],
	},
	{
		id: 'league-boards',
		name: 'Full-league boards',
		screenshot: shot('throwback-week.webp', 'A full-league live scoring board showing every matchup of the week.'),
		summary: 'Every matchup and the standings for a whole league, not just your own game.',
		details: [
			'All of a league’s matchups on one page, with the top teams and top performances of the week.',
			'A Scores / Standings switch, so the table moves with the games.',
		],
	},
	{
		id: 'broadcast-board',
		name: 'Broadcast board',
		summary: 'A hands-off board for the second TV: your games, scoring reveals and red-zone alerts.',
		details: [
			'A fixed score header for your matchups: score, projected final, win probability and players yet to play.',
			'Touchdowns and big plays take over the screen for your players; opponents’ scoring gets a smaller card.',
			'Reveals queue one at a time and never pile up; the player strip pages on its own.',
			'A red-zone banner for the whole drive, and a burn-in-safe screensaver when nothing is live.',
			'Silent by default. Pick which leagues it follows; the choice is remembered on that device.',
		],
	},
	{
		id: 'game-day-alerts',
		name: 'Game-day push alerts',
		screenshot: shot('notification-command-center.webp', 'Alert settings, with each push category switched on or off per owner.'),
		summary: 'A push when a matchup changes hands late, and your final score when it’s over.',
		details: [
			'Close-game swings: a push when the lead in your matchup changes hands late in the week.',
			'Final score: a push when your matchup is decided.',
			'Off by default; each owner turns on the alerts they want.',
		],
	},
	{
		id: 'game-day-planner',
		name: 'Game Day Planner',
		summary: 'Which NFL games matter to your lineups this week, and where to watch them.',
		details: [
			'Every game sorted into early and late windows, marked with the players you start in each one.',
			'Covers all of your leagues at once.',
			'Channel listings for the US, Canada, Australia, the UK and Mexico.',
			'Links straight to your lineup and to live scoring.',
		],
	},
	{
		id: 'branded-site',
		name: 'Your own league site',
		screenshot: shot('afl-hero-unified.webp', 'A league homepage wearing the league’s own crest, colors and hero banner.'),
		summary: 'Your domain, your logos and colors, light and dark themes, built for phones first.',
		details: [
			'A site on your own domain, wearing your league’s name, crest and colors.',
			'Every franchise’s logo and colors used across the site, with light and dark versions.',
			'Installs to the home screen like an app.',
			'Weekly releases: new features reach your league without you asking.',
		],
	},
	{
		id: 'draft-hub',
		name: 'Draft hub',
		screenshot: shot('draft-broadcast-clock-timer.webp', 'The draft-day broadcast board: the team on the clock, recent picks and who is up next.'),
		summary: 'Draft order, a live draft room, mock drafts, a draft-day broadcast and full results history.',
		details: [
			'Draft order with every traded pick shown.',
			'A live draft room and a draft-day broadcast board for the TV.',
			'Mock drafts against the real player pool.',
			'Draft results for every season on record.',
		],
	},
	{
		id: 'ai-reporter',
		name: 'AI league reporter',
		summary: 'A league insider who breaks every trade and move and writes weekly columns about your league.',
		details: [
			'Breaking-news posts for trades, signings and cuts, written in a reporter’s voice about your league’s real teams.',
			'Weekly recaps and feature columns.',
			'A rumor mill, posted to the site and to your group chat.',
		],
	},
	{
		id: 'rules-assistant',
		name: 'Rules assistant',
		screenshot: shot('rules-chat-report-answer.webp', 'A rules question answered from the league’s own constitution, with a link to the full rule.'),
		summary: 'Ask a question about your league’s rules and get the answer from your own constitution.',
		details: [
			'Answers come from your league’s rulebook, not general fantasy advice.',
			'Available on the site and in the group chat.',
		],
	},
	{
		id: 'group-chat-bot',
		name: 'Group chat bot',
		summary: 'League news, reminders and answers posted straight into your league’s group chat.',
		details: [
			'Posts the reporter’s breaking news and columns to the chat.',
			'Deadline reminders, sent to the chat only for owners a push could not reach.',
			'GroupMe today.',
		],
	},
	{
		id: 'push-notifications',
		name: 'Push notifications',
		screenshot: shot('deadline-reminders-push-first.webp', 'Push notification settings: trade offers, lineup problems, deadlines and player news.'),
		summary: 'Trade offers, lineup problems, deadlines and news on your players, pushed to your phone.',
		details: [
			'Trade offers, and lineup problems before kickoff.',
			'League deadlines, news on your players and on your watch list.',
			'Big moves around the league, weekly columns and what’s new on the site.',
			'Every category is opt-in, per owner.',
		],
	},
	{
		id: 'owner-moves',
		name: 'Lineups, trades and roster moves',
		screenshot: shot('trade-builder.webp', 'The trade builder, with both rosters side by side and the cap impact of the deal.'),
		summary: 'Set lineups, build and answer trades, claim, cut and watch players without leaving the site.',
		details: [
			'Set your lineup; the change goes straight to MyFantasyLeague.',
			'A trade builder, plus pending offers you can accept or reject.',
			'Waiver claims, cuts, injured reserve and a watch list.',
		],
	},
	{
		id: 'power-rankings',
		name: 'Power rankings',
		screenshot: shot('afl-pecking-order.webp', 'The weekly power-rankings column, every team ranked with a write-up.'),
		summary: 'A weekly power-rankings column, written up in the league’s own voice.',
		details: [
			'A weekly power-rankings column.',
			'Every team ranked on all-play record and recent scoring, with a blurb each.',
		],
	},
	{
		id: 'custom-rankings',
		name: 'Custom player rankings',
		screenshot: shot('built-in-rankings.webp', 'Ranking sources ticked and weighted into one composite board.'),
		summary: 'Import rankings from the sources you trust and blend them into your own board.',
		details: [
			'Six ranking sources built in; import your own on top.',
			'Weight them into one composite ranking, used across free agents and the draft.',
		],
	},
	{
		id: 'contracts-cap',
		name: 'Contracts and salary cap',
		screenshot: shot('salary-analytics.webp', 'Salary analytics: contract spending by position across the league.'),
		summary: 'Contracts, extensions, franchise tags, dead money and cap projections for dynasty leagues.',
		details: [
			'Every contract in the league, with extensions and franchise tags.',
			'Dead money, salary history and projected free agents.',
			'Cap projections in the trade builder and on rosters.',
		],
	},
	{
		id: 'league-books',
		name: 'League books and prize payouts',
		summary: 'Dues and prize payouts written straight into MyFantasyLeague’s league books.',
		details: [
			'The commissioner runs the season’s payouts from the prize table in one step.',
			'Import and export the books as a spreadsheet.',
			'Carries balances into the new league year.',
			'Software only: the league collects and pays its own money.',
		],
	},
];

/**
 * MFL Football Pro's price, in whole dollars. Read by the homepage and
 * by MFL Live's landing (`/live`), so the number a visitor sees is one value.
 */
export const MFL_LIVE_PRO_PRICE = { season: 24, month: 5 } as const;

const CONTEST_PACKAGE: Product = {
	slug: 'contest-package',
	kind: 'contest',
	name: 'Contest Package',
	price: 'Contact us for a quote',
	tagline: 'A custom site for one competition across dozens or hundreds of MFL leagues.',
	buyer: 'An organizer running one competition across many MFL leagues',
	summary: [
		'MFL shows each league on its own. Contest Package is a custom site for the whole contest: one live leaderboard, advancement into a contest-wide playoff, and a branded site that ties every league together.',
		'Every contest is different, so it is quoted to order. Tell us about yours and we will send a price.',
	],
	buildsOn: ['league-package'],
	features: ['live-scoreboard', 'broadcast-board', 'ai-reporter', 'branded-site'],
	sections: [
		{
			heading: 'What it includes',
			bullets: [
				'A combined, live overall leaderboard across every league in the contest.',
				'Advancement rules from each league into a contest-wide playoff or finals.',
				'A contest broadcast board and a contest news feed from the league reporter.',
				'Each owner’s contest standing in the live scoring app.',
				'A branded contest site on your domain.',
			],
		},
		{
			heading: 'Software only',
			body: 'The contest organizer handles all entry fees and prizes. We provide the software and never hold or move money.',
		},
		{
			heading: 'Pricing',
			body: 'Quoted for each contest, from its number of leagues and the rules it runs. Contact us to start.',
		},
	],
};

/**
 * League Package pricing (Brandon, 2026-11-04). This is the site's top price,
 * so every other price reads as small beside it. Each tier is priced at 10x or
 * more of its yearly AI cost. A league over 24 teams needs custom work on most
 * pages, so it is quoted rather than listed. The homepage and the product page
 * both read these values.
 */
/** One-time fee for one seasonal theme (Halloween, Christmas or a league's own event), logo remakes included. Brandon, 2026-11-05. */
export const SEASONAL_THEME_PRICE = '$1,000';
/** What that fee covers (Brandon, 2026-11-05). */
export const SEASONAL_THEME_INCLUDES = 'up to 16 team logos plus 3 league or conference logos';

export const LEAGUE_PACKAGE_PRICING = {
	/** One-time setup by league size. */
	tiers: [
		{ teams: '16 teams or fewer', setup: '$3,000' },
		{ teams: '17–24 teams', setup: '$6,000' },
		{ teams: 'Over 24 teams', setup: 'Custom quote' },
	],
	/** Yearly renewal by league size; its bands differ from setup's (Brandon, 2026-11-05). */
	renewals: [
		{ teams: '16 or fewer', price: '$1,500' },
		{ teams: '17–32', price: '$2,000' },
		{ teams: '33–49', price: '$3,000' },
		{ teams: '50–100', price: '$4,000' },
	],
	/** The smallest renewal, for "from" copy. */
	renewal: '$1,500/year',
	logoDiscount: '$500',
} as const;

/**
 * Sign up during a season and the rest of it is free (Brandon, 2026-11-07).
 * The setup fee is still paid now and still covers the first FULL season; the
 * free part is the season already under way. Open from the NFL week 1 kickoff
 * to the end of week 17, the last fantasy championship week either league
 * plays, so it disappears by itself and comes back next September.
 */
export function leaguePackageSeasonOffer(now: Date = new Date()): string | null {
	const year = getCurrentSeasonYear(now);
	const opens = nflWeekStartInstant(year, 1);
	const closesIso = nflWeekEndIsoDate(year, 17);
	const nowIso = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
	if (now < opens || nowIso > closesIso) return null;
	return `Sign up before the ${year} season ends and your site is free for the rest of it. Your setup fee still covers your first full season.`;
}

const LEAGUE_PACKAGE: Product = {
	slug: 'league-package',
	kind: 'league',
	name: 'League Package',
	price: `Starts at ${LEAGUE_PACKAGE_PRICING.tiers[0].setup} for setup and your first year, then ${LEAGUE_PACKAGE_PRICING.renewal}`,
	tagline: 'The full suite: your league’s site, with features built for how your league plays.',
	buyer: 'A league that wants custom features built',
	screenshot: shot('front-office-hub.jpg', 'The front office hub: contracts, cap tools and roster planning in one place.'),
	summary: [
		'League Package is a custom site for your league with everything included: every feature on the platform, set up and run for you, with priority support.',
		'That covers most league-specific standings, salary cap rules and side games, Full History and Ask the History, and MFL Football Pro for every owner. Anything beyond that is quoted before work starts.',
	],
	tiers: {
		heading: 'Pricing by league size',
		columns: ['Setup and first year, starting at', 'Yearly renewal after'],
		rows: [
			{ label: '16 teams or fewer', values: ['$3,000', '$1,500/year'] },
			{ label: '17–24 teams', values: ['$6,000', '$2,000/year'] },
			{ label: '25–32 teams', values: ['Custom quote', '$2,000/year'] },
			{ label: '33–49 teams', values: ['Custom quote', '$3,000/year'] },
			{ label: '50–100 teams', values: ['Custom quote', '$4,000/year'] },
			{ label: 'Over 100 teams', values: ['Custom quote', 'Quoted'] },
		],
		note: `Setup prices are starting prices, and they include most league-specific standings, salary cap rules and side games. The setup fee also includes your first full season: hosting, automation and support. You pay nothing more until your first renewal, which pays for the automation that runs your league: news, reminders, rules answers, hosting and support. Make your own franchise logos and save ${LEAGUE_PACKAGE_PRICING.logoDiscount} on setup (16 teams or fewer); we send the sizes. Leaving out features lowers the price too; ask for a quote.`,
	},
	offer: leaguePackageSeasonOffer,
	features: [
		'branded-site',
		'live-scoreboard',
		'league-boards',
		'broadcast-board',
		'game-day-alerts',
		'game-day-planner',
		'draft-hub',
		'ai-reporter',
		'rules-assistant',
		'group-chat-bot',
		'push-notifications',
		'owner-moves',
		'power-rankings',
		'custom-rankings',
		'contracts-cap',
		'league-books',
	],
	sections: [
		{
			heading: 'What’s included',
			items: [
				{ title: 'Launch and branding', price: 'Included', body: 'Your domain, logos and colors, light and dark themes, and your league’s history backfilled.' },
				{ title: 'Every platform feature', price: 'Included', body: 'Every feature listed below, Full History and Ask the History, and hosting and support for the first year.' },
				{ title: 'MFL Football Pro for every owner', price: 'Included', body: 'The live scoring app on every owner’s phone and the live Broadcast on their TV. Worth $24 per owner per season.' },
				{ title: 'Franchise logos', price: 'Optional', body: `We design every franchise’s logo, or you make your own from our sizes and save ${LEAGUE_PACKAGE_PRICING.logoDiscount}.` },
				{ title: 'Your league’s own rules', price: 'Included', body: 'Most league-specific standings, salary cap rules and side games, agreed at the kickoff call.' },
				{ title: 'Other custom features', price: 'Quoted', body: 'Anything beyond your standings, cap rules and side games, quoted before work starts.' },
				{ title: 'Leagues over 24 teams', price: 'Custom quote', body: 'Large-league support and the custom work it takes on most pages, quoted with the package.' },
				{ title: 'Priority support', price: 'Included', body: 'Your league comes first on game days and in the weekly release.' },
			],
		},
		{
			heading: 'How a launch runs',
			items: [
				{ title: 'Signing', body: 'Contract signed, then a 30-minute kickoff call to settle the custom features and their rules.' },
				{ title: 'Build', body: 'Branding, history, large-league support if needed, and the custom features.' },
				{ title: 'Owner preview', body: 'Your owners try the site and a feedback round follows.' },
				{ title: 'Draft season', body: 'The draft hub goes live for your draft.' },
				{ title: 'Week 1', body: 'Live scoring, side games and custom standings go live with the season.' },
			],
		},
		{
			heading: 'Terms in short',
			bullets: [
				'Software only: we never collect entry fees, hold funds or pay out prizes.',
				'You own your league’s name, logos and content. We own the platform and every feature built on it; a feature built for you may be offered to other leagues without your branding.',
				'The work is what the proposal lists; anything else is quoted before work starts.',
				'50% at signing, 50% at launch. The setup fee covers your first full season.',
				`Your first renewal is July 1, before your second full season, at ${LEAGUE_PACKAGE_PRICING.renewals.map((r) => `${r.price} for ${r.teams} teams`).join(', ')}, covering the automation, hosting, support and MFL Football Pro for every owner. Renewal prices are fixed for the second year.`,
			],
		},
	],
};

const SEASONAL_THEMES: Product = {
	slug: 'add-ons',
	kind: 'addon',
	name: 'Seasonal Themes',
	price: `${SEASONAL_THEME_PRICE} per theme`,
	tagline: 'Your site dresses up for Halloween, Christmas or your league’s own big week, then changes back.',
	buyer: 'A league with a custom site',
	summary: [
		`A seasonal theme changes your site’s look on its own for a set window, then changes back when the week is over. Each theme remakes ${SEASONAL_THEME_INCLUDES}.`,
		'It is the one add-on to a custom site; everything else is included.',
	],
	sections: [
		{
			heading: 'Pricing',
			bullets: [`${SEASONAL_THEME_PRICE} per theme, one time.`],
		},
	],
};

/** The lineup: the custom site first. A product may only build on ones before it. */
export const PRODUCTS: Product[] = [LEAGUE_PACKAGE, CONTEST_PACKAGE];

/**
 * Sold only on its own service page (/mfl-league-themes), never in the lineup
 * or on the homepage (Brandon, 2026-11-08). Listed so that page's interest
 * button still counts on Site Insights.
 */
export const OFF_LINEUP_PRODUCTS: Product[] = [SEASONAL_THEMES];

export function findProduct(slug: string): Product | undefined {
	return PRODUCTS.find((p) => p.slug === slug);
}

export function getProduct(slug: ProductSlug): Product {
	const product = findProduct(slug);
	if (!product) throw new Error(`Unknown product: ${slug}`);
	return product;
}

export function getFeature(id: FeatureId): Feature {
	const feature = FEATURES.find((f) => f.id === id);
	if (!feature) throw new Error(`Unknown feature: ${id}`);
	return feature;
}

/** Products that list this feature, in lineup order. */
export function productsIncluding(id: FeatureId): Product[] {
	return PRODUCTS.filter((p) => p.features?.includes(id));
}

export const productHref = (slug: ProductSlug) => `/products/${slug}`;
export const featureHref = (id: FeatureId) => `/products/features#${id}`;
