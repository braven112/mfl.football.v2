/**
 * /pricing — the two products on sale and every number behind them
 * (Brandon, 2026-11-09). Customer-facing copy only: the repo is public.
 *
 * The custom-site prices come from LEAGUE_PACKAGE_PRICING so the product page
 * and this page can never disagree; the monthly figures are DERIVED from the
 * yearly ones (÷ 12), never typed, because a hand-typed "$125/mo" next to a
 * changed yearly price is exactly the drift this file exists to prevent.
 *
 * Billing rules, all Brandon's:
 * - Prices are shown as a monthly fee, billed annually.
 * - Paying in installments costs 20% more: four payments, September through
 *   December, on the same 12-month commitment, so nobody can sign up for the
 *   season and cancel for the off-season.
 * - Setup is discounted in the off-season so launches don't all land in
 *   August: 25% off January–April, 10% off May–June, full price July–December.
 */
import { LEAGUE_PACKAGE_PRICING, SEASONAL_THEME_INCLUDES, SEASONAL_THEME_PRICE } from './products';

/** League History, per league, per year. */
export const HISTORY_PRICE_YEAR = 49;

/** Installments cost this much more than paying the year up front. */
export const INSTALLMENT_PREMIUM = 0.2;
export const INSTALLMENT_COUNT = 4;
export const INSTALLMENT_MONTHS = 'September, October, November and December';

/** Off-season setup discounts, earliest first. Months outside these pay full price. */
export const SETUP_DISCOUNTS = [
	{ months: 'January–April', off: 0.25 },
	{ months: 'May–June', off: 0.1 },
] as const;
export const FULL_PRICE_MONTHS = 'July–December';

export const dollars = (n: number) =>
	`$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: n % 1 ? 2 : 0 })}`;

/** "$3,000" → 3000. Returns null for "Custom quote" and friends. */
export const parseDollars = (s: string): number | null => {
	const m = /^\$([\d,]+)/.exec(s);
	return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** A yearly price shown as monthly, billed annually: whole dollars, rounded. */
export const perMonth = (year: number) => Math.round(year / 12);

/** One installment of a yearly price paid in four. */
export const installment = (year: number) => (year * (1 + INSTALLMENT_PREMIUM)) / INSTALLMENT_COUNT;

export interface CustomSiteRow {
	teams: string;
	/** First year (setup), or null when quoted. */
	setup: number | null;
	/** Every year after, or null when quoted. */
	renewal: number | null;
}

/**
 * Setup and renewal use different size bands (Brandon, 2026-11-05), so the
 * table is the union of both: setup is quoted over 24 teams, renewal over 100.
 */
const setupFor = (teams: number): number | null => {
	if (teams <= 16) return parseDollars(LEAGUE_PACKAGE_PRICING.tiers[0].setup);
	if (teams <= 24) return parseDollars(LEAGUE_PACKAGE_PRICING.tiers[1].setup);
	return null;
};
const renewalFor = (teams: number): number | null => {
	const bands = [16, 32, 49, 100];
	const i = bands.findIndex((max) => teams <= max);
	return i === -1 ? null : parseDollars(LEAGUE_PACKAGE_PRICING.renewals[i].price);
};

export const CUSTOM_SITE_ROWS: CustomSiteRow[] = [
	{ teams: '16 teams or fewer', at: 16 },
	{ teams: '17–24 teams', at: 24 },
	{ teams: '25–32 teams', at: 32 },
	{ teams: '33–49 teams', at: 49 },
	{ teams: '50–100 teams', at: 100 },
	{ teams: 'Over 100 teams', at: 101 },
].map(({ teams, at }) => ({ teams, setup: setupFor(at), renewal: renewalFor(at) }));

/** The headline "starting at" numbers. */
export const CUSTOM_FROM_SETUP = CUSTOM_SITE_ROWS[0].setup as number;
export const CUSTOM_FROM_RENEWAL = CUSTOM_SITE_ROWS[0].renewal as number;
export const LOGO_DISCOUNT = LEAGUE_PACKAGE_PRICING.logoDiscount;

export { SEASONAL_THEME_INCLUDES, SEASONAL_THEME_PRICE };

export interface PlanFeature {
	text: string;
	/** Shown with a small accent tag: what sets this plan apart. */
	highlight?: string;
}

export const HISTORY_FEATURES: PlanFeature[] = [
	{ text: 'Champions, standings and playoffs for every season, back to your first' },
	{ text: 'All-time records and the record book' },
	{ text: 'Head-to-head rivalries, with every game listed' },
	{ text: 'Franchise pages through every name, logo and owner' },
	{ text: 'Owner pages and a trophy case for every franchise' },
	{ text: 'Ask the History: ask anything about your league’s past', highlight: 'AI' },
	{ text: 'Each finished season added automatically' },
];

export const CUSTOM_FEATURES: PlanFeature[] = [
	{ text: 'Your own domain, crest and colors, in light and dark' },
	{ text: 'Lineups, trades, claims and cuts, synced to MFL' },
	{ text: 'Live scoring, win probability and a TV broadcast board' },
	{ text: 'An AI league reporter, power rankings and recaps' },
	{ text: 'A rules assistant that answers from your constitution' },
	{ text: 'Smarter AI: Claude Sonnet runs your league’s AI, from Ask the History to the rules assistant', highlight: 'Smarter AI' },
	{ text: 'Everything in League History, included' },
	{ text: 'Side games, custom standings and features built for your league' },
	{ text: 'MFL Football Pro for every owner, plus priority support' },
];

export const PRICING_FAQS = [
	{
		q: 'What does “billed annually” mean?',
		a: 'The monthly figure is the yearly price divided by 12. You pay the whole year at once, and the year runs 12 months from launch.',
	},
	{
		q: 'Can I pay in installments?',
		a: `Yes. Pay the year in ${INSTALLMENT_COUNT} payments, in ${INSTALLMENT_MONTHS}, for ${Math.round(INSTALLMENT_PREMIUM * 100)}% more than paying up front. It is the same 12-month commitment, so the year cannot be cancelled for the off-season.`,
	},
	{
		q: 'Why does setup cost less in the spring?',
		a: `Most leagues want a site ready for their August draft. Setting up earlier spreads the work out, so we pass the savings on: ${SETUP_DISCOUNTS.map((d) => `${Math.round(d.off * 100)}% off setup signed ${d.months}`).join(', ')}. Setup signed ${FULL_PRICE_MONTHS} is full price.`,
	},
	{
		q: 'Can I lower the price of a custom site?',
		a: `Yes. Make your own franchise logos from our sizes and save ${LOGO_DISCOUNT} on setup (16 teams or fewer), or leave out features you do not need and we will quote the lower price.`,
	},
	{
		q: 'What is a seasonal theme?',
		a: `A temporary new look for your custom site, such as Halloween or Christmas Week, with every logo redrawn. Each theme is a one-time ${SEASONAL_THEME_PRICE}, including ${SEASONAL_THEME_INCLUDES}.`,
	},
	{
		q: 'Does my league leave MyFantasyLeague?',
		a: 'No. Both products read your league from MyFantasyLeague. A custom site also writes your owners’ lineups, trades and claims back to MFL.',
	},
];
