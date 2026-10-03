/**
 * The product lineup — the customer-facing half of each product page
 * (`/products`, `/products/<slug>`, `/products/features`).
 *
 * THIS FILE IS PUBLIC. The repository is public on GitHub, so only copy a
 * customer could read goes here. Costs, margins, build status, client names
 * and legal to-dos live in the business plan doc, one tab per product.
 * `tests/product-pages.test.ts` scans this file for the obvious leaks.
 *
 * ORDER IS CHEAPEST FIRST, and it is load-bearing: a product may only build
 * on products earlier in the list (pinned by the same test), so the League
 * Package page can link to everything before it instead of restating it.
 *
 * Shared platform features are described ONCE, in `FEATURES`, and every
 * product lists the ids it includes; the catalog page shows each feature
 * with the products that include it.
 */

export type ProductSlug =
	| 'owner-suite'
	| 'league-history'
	| 'add-ons'
	| 'large-league'
	| 'league-hub'
	| 'contest-package'
	| 'league-package';

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

export interface Feature {
	id: FeatureId;
	name: string;
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
	summary: string[];
	/** Earlier products this one includes or extends — linked, never restated. */
	buildsOn?: ProductSlug[];
	features?: FeatureId[];
	tiers?: TierTable;
	sections: ProductSection[];
}

export const FEATURES: Feature[] = [
	{
		id: 'live-scoreboard',
		name: 'Live scoreboard across every league',
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
		summary: 'Set lineups, build and answer trades, claim, cut and watch players without leaving the site.',
		details: [
			'Set your lineup; the change goes straight to MyFantasyLeague.',
			'A trade builder, plus pending offers you can accept or reject.',
			'Waiver claims, cuts, injured reserve and a watch list.',
		],
	},
	{
		id: 'power-rankings',
		name: 'Power rankings and owners’ poll',
		summary: 'A weekly power-rankings column, with a ballot every owner votes on.',
		details: [
			'A weekly power-rankings column.',
			'An owners’ poll: every owner ranks the league, and the tally is revealed with the column.',
		],
	},
	{
		id: 'custom-rankings',
		name: 'Custom player rankings',
		summary: 'Import rankings from the sources you trust and blend them into your own board.',
		details: [
			'Six ranking sources built in; import your own on top.',
			'Weight them into one composite ranking, used across free agents and the draft.',
		],
	},
	{
		id: 'contracts-cap',
		name: 'Contracts and salary cap',
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

const OWNER_SUITE: Product = {
	slug: 'owner-suite',
	kind: 'owner',
	name: 'Owner Suite',
	price: 'Free · Pro $24/season',
	tagline: 'All your MFL leagues on one live screen.',
	buyer: 'Any owner in any MyFantasyLeague league',
	summary: [
		'Owner Suite is for the owner, not the league. Sign in with your MyFantasyLeague account and every league you play in shows up on one board, including leagues that do not use any of our products.',
		'The free tier covers live scores for all your leagues. Pro adds the game-day extras: live and projected standings, the TV broadcast board, close-game alerts, the Game Day Planner and full boards for every league.',
	],
	features: ['live-scoreboard', 'league-boards', 'broadcast-board', 'game-day-alerts', 'game-day-planner'],
	tiers: {
		heading: 'Free and Pro',
		columns: ['Free', 'Pro'],
		rows: [
			{ label: 'Live scores across all your MFL leagues on one screen', values: ['Yes', 'Yes'] },
			{ label: 'Final standings for all your leagues on one page', values: ['Yes', 'Yes'] },
			{ label: 'Live and projected standings, updating as the games play', values: ['No', 'Yes'] },
			{ label: 'Full-league boards (every matchup, standings)', values: ['1 league', 'All leagues'] },
			{ label: 'Broadcast board for the TV', values: ['No', 'Yes'] },
			{ label: 'Close-game and final-score push alerts', values: ['No', 'Yes'] },
			{ label: 'Game Day Planner', values: ['No', 'Yes'] },
			{ label: 'Installs to your home screen', values: ['Yes', 'Yes'] },
		],
		note: 'Pro is $24/season or $5/month in season. Every owner in a League Hub or League Package league gets Pro at no charge while their league’s plan is active.',
	},
	sections: [
		{
			heading: 'How it works',
			bullets: [
				'Sign in with your MyFantasyLeague username and password. We read your leagues; we never change anything on MFL you did not ask for.',
				'Every league on your account is on by default. Switch off any you do not want on the board.',
				'Nothing to install from an app store: add it to your home screen from the browser.',
			],
		},
		{
			heading: 'Pricing and renewal',
			bullets: [
				'Pro is $24 for the season, or $5 a month during the NFL season.',
				'The season plan renews on August 1, with an email reminder 30 days before.',
				'Cancel any time before renewal; the free tier stays.',
			],
		},
	],
};

const LEAGUE_HISTORY: Product = {
	slug: 'league-history',
	kind: 'league',
	name: 'League History',
	price: 'Free · Full History $149/year',
	tagline: 'Every season your league has played, in one place that never forgets.',
	buyer: 'Any MFL, Sleeper or Yahoo league that wants its history kept',
	summary: [
		'League History is a complete record of your league back to its first season: champions, standings, playoffs, rivalries, records and a trophy case for every franchise.',
		'It is the low-cost way in for a league that is not ready for a full site. It is included in League Hub and League Package at no extra cost, so nothing is lost when a league moves up.',
	],
	tiers: {
		heading: 'Free and Full History',
		columns: ['Free', 'Full History'],
		rows: [
			{ label: 'Champions list, every season', values: ['Yes', 'Yes'] },
			{ label: 'Trophy case for each franchise', values: ['Champion trophies', 'Every trophy, including custom awards'] },
			{ label: 'Rebuilt seasons', values: ['Champion and runner-up only', 'Any level of detail'] },
			{ label: 'Standings, playoffs, owner pages, franchise eras', values: ['No', 'Yes'] },
			{ label: 'Records, rivalries, division strength', values: ['No', 'Yes'] },
			{ label: 'Automatic new-season updates', values: ['No', 'Yes'] },
			{ label: 'Shareable graphics', values: ['Champion card only', 'All'] },
			{ label: 'Download my league', values: ['Yes', 'Yes'] },
			{ label: 'Public page, searchable and shareable (can be made private)', values: ['Yes', 'Yes'] },
			{ label: 'Group chat', values: ['One champion post a year', 'Full history bot with the $49/year add-on'] },
			{ label: 'Who can start it', values: ['Any league member', 'The commissioner (or whoever claims the league)'] },
		],
		note: 'Full History is $149/year. The free page never expires. A lapsed subscription drops back to the free page; nothing is deleted.',
	},
	sections: [
		{
			heading: 'What Full History includes',
			bullets: [
				'Champions, season-by-season standings and playoff results.',
				'Franchise pages that follow a team through every name and logo change.',
				'Owner pages that follow a person across every franchise they have held.',
				'All-time records, head-to-head rivalries with every game listed, and draft history.',
				'Division strength and playoff performance across the years.',
				'A trophy case for every franchise.',
			],
		},
		{
			heading: 'Rebuilt seasons',
			body: 'Some seasons are on no platform any more. Rebuild them at whatever detail you have, from just a champion up to full weekly scores, by form, spreadsheet paste or screenshot.',
		},
		{
			heading: 'Switching platforms',
			body: 'A league that moves between platforms keeps one unbroken timeline, with owners and trophies carried across the move.',
		},
		{
			heading: 'Platforms',
			items: [
				{ title: 'MyFantasyLeague', price: 'Spring 2027', body: 'Read directly from MFL; every season back to the league’s first.' },
				{ title: 'Sleeper', price: 'May 2027', body: 'Every season linked back to the league’s first year.' },
				{ title: 'Yahoo', price: 'July 2027', body: 'The commissioner connects their Yahoo account once.' },
			],
		},
		{
			heading: 'History chat bot',
			body: 'A $49/year add-on to Full History: owners ask the group chat who won in 2014 or what the all-time record is between two teams, and the bot answers from your league’s history. GroupMe and Discord first, then Slack.',
		},
		{
			heading: 'Pricing and renewal',
			bullets: [
				'$149 a year, the same on every platform. Setup is included.',
				'Renews July 1, ahead of draft season, with a reminder 30 days before.',
				'Each finished season is added automatically.',
				'Moving up to League Hub credits what is left of your current year.',
			],
		},
	],
};

const ADD_ONS: Product = {
	slug: 'add-ons',
	kind: 'addon',
	name: 'Add-on menu',
	price: '$500–$2,000 each',
	tagline: 'The extras a league adds to its site: side games, custom standings, prizes and dynasty tools.',
	buyer: 'A League Hub or League Package league',
	summary: [
		'Add-ons are features a league adds to League Hub. League Package includes about $4,000 of them; anything not on this menu is quoted to order.',
		'Every add-on is built once and offered to every league, so a feature one league asked for is on this menu for the next.',
	],
	features: ['contracts-cap', 'league-books', 'power-rankings'],
	sections: [
		{
			heading: 'The menu',
			items: [
				{
					title: 'Skins or carry-over game',
					price: '$1,500',
					body: 'A weekly side game that runs itself. Each week has a score to beat: if exactly one team clears it they win the pot, and if several do it carries over.',
					bullets: [
						'A live pot tracker during the games.',
						'Week-by-week history of every pot.',
						'Win alerts by push and group chat, and coverage from the league reporter.',
						'Rules set at kickoff: fixed or changing threshold, pot size, and what happens to a pot still unclaimed at season’s end.',
					],
				},
				{
					title: 'Custom standings',
					price: '$1,500',
					body: 'Standings your league’s way, alongside MFL’s official table.',
					bullets: [
						'A league-wide table across every division.',
						'A week-by-week breakdown of victory points or any points system your league uses.',
						'Power rankings with an owners’ poll.',
					],
				},
				{
					title: 'Prizes, awards and trophy history',
					price: '$1,000',
					body: 'A winners page for the season and a trophy history for every franchise, fed by side games, division titles and championships.',
				},
				{
					title: 'Prize payouts in the league books',
					price: '$1,500',
					body: 'The commissioner’s season payouts written straight into MFL’s league books from the prize table, with spreadsheet import and export and the year-end carry-over.',
				},
				{
					title: 'Contracts and salary cap',
					price: '$2,000',
					body: 'The full set of dynasty tools: contracts, extensions, franchise tags, dead money, salary history, projected free agents and cap projections in the trade builder.',
				},
				{
					title: 'Extra seasons of history',
					price: '$500',
					body: 'League Hub backfills five seasons of history. This adds every season before that, back to the league’s first.',
				},
				{
					title: 'History chat bot',
					price: '$49/year',
					body: 'The group-chat bot that answers questions from your league’s history. Needs Full History, which League Hub includes.',
				},
				{
					title: 'Anything else',
					price: '$125/hour',
					body: 'A feature not on this menu, quoted up front before any work starts.',
				},
			],
		},
		{
			heading: 'For leagues over 32 teams',
			body: 'Large-league support is an add-on too, priced by size. It has its own page.',
		},
	],
};

const LARGE_LEAGUE: Product = {
	slug: 'large-league',
	kind: 'addon',
	name: 'Large-league support',
	price: '$1,500–$3,000 add-on',
	tagline: 'A site that still works on a phone when your league has 100 teams.',
	buyer: 'A league over 32 teams, or one that drafts in several separate groups',
	summary: [
		'Most league sites assume 10 to 14 teams. A 99-team league in nine divisions breaks every one of those screens. Large-league support rebuilds them around your divisions first, so every owner sees their own corner of the league before the whole of it.',
		'It is an add-on to League Hub and is priced by the league’s size and how many separate drafts it runs. It is also the engine behind the Contest Package, which applies the same idea across many leagues.',
	],
	sections: [
		{
			heading: 'What it includes',
			items: [
				{
					title: 'Division-first views',
					body: 'Every page opens on your own division: standings, matchups and scores. The whole league is one tap away.',
				},
				{
					title: 'A league-wide table',
					body: 'One table ranking every team in the league, next to MFL’s official division standings.',
				},
				{
					title: 'Several drafts at once',
					body: 'Each division or conference drafts on its own, from its own player pool if your league works that way. The draft hub, draft room and mock draft cover every one of them.',
				},
				{
					title: 'Live scoring built for 100 teams',
					body: 'Live scoring that leads with your division and your rivals, then the rest of the league.',
				},
				{
					title: 'Tiers and conferences',
					body: 'Conferences that share a player pool, and tiers with promotion and relegation, if your league uses them.',
				},
			],
		},
		{
			heading: 'Pricing',
			bullets: [
				'$1,500 to $3,000, quoted from your league’s size and number of separate drafts.',
				'A one-time add-on; it keeps working at every renewal.',
			],
		},
	],
};

const LEAGUE_HUB: Product = {
	slug: 'league-hub',
	kind: 'league',
	name: 'League Hub',
	price: '$2,000/year',
	tagline: 'A branded site for your league, built from everything the platform already does.',
	buyer: 'A commissioner who wants a branded site, with no custom work',
	summary: [
		'League Hub is a complete league site on your own domain, set up in about two weeks. It uses only features that already exist, which keeps the price fixed and the launch fast.',
		'It includes League History (Full) and Owner Suite Pro for every owner, plus every platform feature below. Leagues that want something built for them step up to League Package.',
	],
	buildsOn: ['owner-suite', 'league-history'],
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
	],
	sections: [
		{
			heading: 'Setup',
			bullets: [
				'Your domain, crest, colors and every franchise’s logo, in light and dark.',
				'Five seasons of history backfilled (more is an add-on).',
				'Your rulebook loaded into the rules assistant, and the reporter introduced to your league.',
				'The group chat bot connected to your GroupMe.',
				'About two weeks from signing to launch.',
			],
		},
		{
			heading: 'Every year',
			bullets: [
				'Hosting, data and AI costs.',
				'Weekly releases: new features reach your league as they ship.',
				'Season-long support: replies within one business day in the offseason, same day on game days.',
				'Owner Suite Pro for every owner, and Full History updated each season.',
				'The rollover to the next league year.',
			],
		},
		{
			heading: 'Adding to it',
			body: 'Any item on the add-on menu can be added to League Hub. Leagues over 32 teams add large-league support.',
		},
		{
			heading: 'Pricing and renewal',
			bullets: [
				'$2,000 a year, paid in full at signing.',
				'Renews July 1, ahead of draft season, with a reminder 30 days before.',
				'Moving up to League Package credits what is left of your current year.',
			],
		},
	],
};

const CONTEST_PACKAGE: Product = {
	slug: 'contest-package',
	kind: 'contest',
	name: 'Contest Package',
	price: '$2,500 setup + $4/team/season',
	tagline: 'One competition across dozens or hundreds of MFL leagues.',
	buyer: 'An organizer running one competition across many MFL leagues',
	summary: [
		'MFL shows each league on its own. Contest Package adds the view across all of them: one live leaderboard, advancement into a contest-wide playoff, and a branded site for the whole contest.',
		'It runs on the same engine as large-league support, and every owner in the contest sees their contest standing inside Owner Suite.',
	],
	buildsOn: ['owner-suite', 'large-league'],
	features: ['live-scoreboard', 'broadcast-board', 'ai-reporter', 'branded-site'],
	tiers: {
		heading: 'Pricing by contest size',
		columns: ['Setup', 'Per team per season', 'Example yearly total'],
		rows: [
			{ label: 'Up to 250 teams', values: ['$2,500', '$4', '$3,500 at 250 teams'] },
			{ label: '251–1,000 teams', values: ['$2,500', '$4', '$6,500 at 1,000 teams'] },
			{ label: 'Over 1,000 teams', values: ['$2,500', '$3', 'Quoted'] },
		],
		note: 'The examples are the first year: setup plus the per-team fee. Setup is charged once; renewal is the per-team fee only.',
	},
	sections: [
		{
			heading: 'What it includes',
			bullets: [
				'A combined, live overall leaderboard across every league in the contest.',
				'Advancement rules from each league into a contest-wide playoff or finals.',
				'A contest broadcast board and a contest news feed from the league reporter.',
				'Each owner’s contest standing inside their Owner Suite.',
				'A branded contest site on your domain.',
			],
		},
		{
			heading: 'Software only',
			body: 'The contest organizer handles all entry fees and prizes. We provide the software and never hold or move money.',
		},
		{
			heading: 'Renewal',
			bullets: [
				'Paid in full at signing.',
				'Renews July 1 at the per-team fee, with a reminder 30 days before.',
			],
		},
	],
};

const LEAGUE_PACKAGE: Product = {
	slug: 'league-package',
	kind: 'league',
	name: 'League Package',
	price: '$10,000 first year',
	tagline: 'The full suite: your league’s site, with features built for how your league plays.',
	buyer: 'A league that wants custom features built',
	summary: [
		'League Package is everything on the platform, set up for your league, plus about $4,000 of features chosen for it. It is League Hub with custom work and priority support on top.',
		'Each product before this one is part of it. Every owner gets Owner Suite Pro, the league gets Full History, and the custom budget comes from the add-on menu or is quoted to order. Large leagues get large-league support.',
	],
	buildsOn: ['owner-suite', 'league-history', 'add-ons', 'large-league', 'league-hub'],
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
	],
	sections: [
		{
			heading: 'What’s included',
			items: [
				{ title: 'Launch and branding', price: 'Included', body: 'Your domain, logos and colors, light and dark themes, and your league’s history backfilled.' },
				{ title: 'Everything in League Hub', price: 'Included', body: 'Every platform feature, Full History, and hosting and support for the first year.' },
				{ title: 'Owner Suite Pro for every owner', price: 'Included', body: 'Worth $24 per owner per season.' },
				{ title: 'Custom features', price: 'About $4,000', body: 'Chosen from the add-on menu or quoted to order, and agreed at the kickoff call.' },
				{ title: 'Large-league support', price: 'When needed', body: 'For leagues over 32 teams or with several separate drafts, quoted with the package.' },
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
				'50% at signing, 50% at launch. The first year runs 12 months from launch.',
				'Renews at $3,000 a year on July 1, covering hosting, support and Owner Suite Pro for every owner. Renewal prices are fixed for the second year.',
			],
		},
	],
};

/** The lineup, cheapest first. A product may only build on ones before it. */
export const PRODUCTS: Product[] = [
	OWNER_SUITE,
	LEAGUE_HISTORY,
	ADD_ONS,
	LARGE_LEAGUE,
	LEAGUE_HUB,
	CONTEST_PACKAGE,
	LEAGUE_PACKAGE,
];

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
