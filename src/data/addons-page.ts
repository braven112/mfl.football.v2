/**
 * The /addons landing page's content, in one place: the page renders it as
 * cards and `/addons.md` writes it out as markdown for AI tools and crawlers,
 * so the two can never say different things. This file is PUBLIC, like
 * products.ts: customer-facing copy only.
 */
import { SHARED_APP_ORIGIN } from '../config/leagues';
import type { InterestSlug } from '../utils/product-interest';

export const ADDONS_TITLE = 'MFL Add-ons is now MFL Football';
export const ADDONS_DESCRIPTION =
  'MFL Add-ons is now MFL Football, offering more than ever: a free team logo maker, live scores, TV and phone apps, league history and custom league sites for MyFantasyLeague.';

/** A free tool that links to the real thing. */
export interface FreeTool {
  name: string;
  body: string;
  href: string;
}

export const LOGO_MAKER: FreeTool = {
  name: 'Team logo maker',
  body: 'Pick a style, your team colors and the kind of art, and we write the prompt. Paste it into ChatGPT, Gemini or Claude and walk away with a logo your league will notice.',
  href: '/live/team-logo',
};

export const LIVE_SCORES: FreeTool = {
  name: 'Live scores',
  body: 'Live scores for every MFL league you play in, on one screen.',
  href: '/live',
};

export const SKINS: FreeTool = {
  name: 'MFL skin and templates',
  body: 'The original MFL Add-ons skin, plus a homepage, header and footer for MFL, with step-by-step install.',
  href: '/instructions',
};

export const CHAMPION_CARD = {
  slug: 'champion-card',
  name: 'Champion card',
  body: 'A card to crown your league champion and share in the group chat.',
} as const;

export interface Door {
  slug: InterestSlug;
  name: string;
  who: string;
  body: string;
	/** Shown in the dialog under "coming soon", when the door needs a word more. */
  note?: string;
}

export const APPS: Array<Door & { img: string; alt: string }> = [
  {
    slug: 'tv-app',
    name: 'TV app',
    who: 'For game day on the big screen',
    body: 'Every league you play in, live on your TV. Big plays take over the screen, and the standings move as the games do.',
    img: '/assets/mfl-live/lifestyle-tv-wall.webp',
    alt: 'Live fantasy scores on a wall of TVs',
  },
  {
    slug: 'phone-app',
    name: 'Phone app',
    who: 'For checking scores anywhere',
    body: 'Your matchups across every MFL league, in one app, with alerts when a game gets close.',
    img: '/assets/mfl-live/lifestyle-tablet.webp',
    alt: 'Live fantasy scores on a tablet',
  },
];

/** The cheap, yearly extras: the step after a free logo. */
export const EXTRAS: Door[] = [
  {
    slug: 'league-domain',
    name: 'Your league’s own address',
    who: 'For any MFL league',
    body: 'yourleague.mfl.football, or a domain of your own, pointed at your MFL league. When MFL starts a new season, it follows your league for you.',
    note: 'A small yearly subscription. Leave your email and we’ll tell you when it opens.',
  },
  {
    slug: 'logo-hosting',
    name: 'Logo and banner hosting',
    who: 'For leagues with their own art',
    body: 'Drop in your team logos and banners, and we host them at the right sizes for your MFL pages, so they never break.',
    note: 'A small yearly subscription, and a natural pair with your league’s own address.',
  },
];

export const PRODUCTS: Door[] = [
  {
    slug: 'league-package',
    name: 'League Package',
    who: 'For a league that wants it all handled',
    body: 'Your own site with every feature we make, custom features built for your league, and priority support.',
  },
  {
    slug: 'league-hub',
    name: 'League Hub',
    who: 'For a commissioner who wants a real site',
    body: 'A branded site on your own domain with a draft hub, an AI league reporter, push alerts and more.',
  },
  {
    slug: 'custom-build',
    name: 'Custom builds',
    who: 'For the idea nobody sells yet',
    body: 'Tell us what your league needs. If we can build it for MFL, we will quote it up front.',
    note: 'Leave your email and we will reach out to hear what you have in mind.',
  },
  {
    slug: 'add-ons',
    name: 'League add-ons',
    who: 'For leagues that play their own way',
    body: 'Side games, custom standings, prizes and payouts, contracts and the salary cap, and extra seasons of history.',
  },
  {
    slug: 'league-history',
    name: 'League History',
    who: 'For any league with a past',
    body: 'Every season back to your first: champions, standings, playoffs, owner pages, rivalries and records.',
  },
  {
    slug: 'owner-suite',
    name: 'Live scores Pro',
    who: 'For any MFL owner',
    body: 'The Broadcast for your TV, live and projected standings, full boards and game-day alerts.',
  },
  {
    slug: 'large-league',
    name: 'Large-league support',
    who: 'For leagues with 32 teams or more',
    body: 'A site that still works on a phone when your league has 100 teams and several drafts.',
  },
  {
    slug: 'contest-package',
    name: 'Contest Package',
    who: 'For organizers running many leagues',
    body: 'One competition across dozens or hundreds of MFL leagues.',
  },
];

const abs = (path: string) => new URL(path, SHARED_APP_ORIGIN).href;

const doorLines = (doors: Door[]) => doors.map((d) => `- **${d.name}**: ${d.body} (${d.who}.)`);

/** The page as markdown: what an AI agent or crawler reads at `/addons.md`. */
export function addonsMarkdown(): string {
  return [
    `# ${ADDONS_TITLE}`,
    '',
    `${ADDONS_DESCRIPTION} Everything below is free or coming soon; nothing is for sale yet. To say you want something, tap "I'm interested" on ${abs('/addons')} and leave an email.`,
    '',
    '## Free tools',
    '',
    `- **${LOGO_MAKER.name}** (${abs(LOGO_MAKER.href)}): ${LOGO_MAKER.body}`,
    `- **${LIVE_SCORES.name}** (${abs(LIVE_SCORES.href)}): ${LIVE_SCORES.body}`,
    `- **${CHAMPION_CARD.name}** (free, coming soon): ${CHAMPION_CARD.body}`,
    `- **${SKINS.name}** (${abs(SKINS.href)}): ${SKINS.body}`,
    '',
    '## Make it yours (coming soon)',
    '',
    ...doorLines(EXTRAS),
    '',
    '## Apps (coming soon)',
    '',
    ...doorLines(APPS),
    '',
    '## For your league (coming soon)',
    '',
    ...doorLines(PRODUCTS),
    '',
    '## About',
    '',
    'MFL Football (formerly MFL Add-ons) builds tools and league sites for MyFantasyLeague (MFL) leagues. It is an independent product, not affiliated with MyFantasyLeague.',
    `Home: ${abs('/')}`,
    '',
  ].join('\n');
}
