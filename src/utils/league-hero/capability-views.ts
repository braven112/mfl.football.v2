/**
 * Views for hero capabilities the AFL does not have — a league-wide draft, an
 * auction window, the power-rankings slot, a weekly column. Kept apart from
 * ./views.ts only because /showcase's guard reads the AFL's treatments out of
 * that file's source, and a view here is one the AFL never renders.
 */
import type { ResolvedLeagueEvent } from '../../types/league-events';
import { getLeagueBySlug } from '../../config/leagues';
import { buildMflLiveDraftUrl } from '../mfl-url';
import { randomHeroPlayer } from '../hero-players';
import { leagueClock } from '../../config/leagues';
import { articleDateLabel, articleHeroView, type ArticleHeroByline, type LatestArticle } from '../article-hero-view';
import type { EventHeroView, PeckingOrderHeroIssue } from './types';
import {
  ACCENT_GOLD,
  ACCENT_STEEL,
  GLOW_GOLD,
  GLOW_NAVY,
  SCHEFTER_DESK_BYLINE,
  dayPhrase,
  daysBetween,
  type ViewEnv,
} from './views';

/**
 * A draft the whole league runs at once, in MFL's live-draft room. From
 * midnight on draft day the CTA is the room itself — owners open the homepage
 * hours early to set a queue — and before that the room is still the one page
 * that knows the draft exists.
 */
export function leagueDraftView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile } = env;
  const live = event.isActive;
  const days = Math.max(0, daysBetween(event.startDate, now));
  const league = getLeagueBySlug(profile.league)!;
  const room = buildMflLiveDraftUrl({
    leagueId: league.id,
    year: event.startDate.getFullYear(),
    host: `https://${league.mflHost}`,
  });
  return {
    pill: live ? 'Draft Day · Live' : 'Draft Day',
    headline: live ? 'The draft is' : 'Build your',
    accentWord: live ? 'live.' : 'roster.',
    summary: live
      ? 'The draft is on the clock right now. Make your picks before the timer expires.'
      : days === 0
        ? 'The draft is today. Head into the draft room and set your queue before the clock starts.'
        : `The draft is ${dayPhrase(days)}. Scout the board and set your queue.`,
    link: room,
    linkLabel: live || days === 0 ? 'Enter Draft Room' : 'Open the Draft Room',
    isExternal: true,
    icon: 'draft-podium',
    // The draft belongs to the whole league, not to one club.
    composite: { wordmark: 'DRAFT', accent: 'navy', tone: live ? 'red' : null, scope: 'league' },
    accent: ACCENT_STEEL,
    glow: 'rgba(59,107,154,.55)',
    player: randomHeroPlayer(now),
    countValue: live ? 'LIVE' : days,
    countLabel: live ? 'Drafting now' : 'Days to the draft',
  };
}

/** An auction window a league's own calendar schedules (MFL `AUCTION_START`). */
export function auctionWindowView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, p } = env;
  const live = event.isActive;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: live ? 'Auction · Live' : 'Free-Agent Auction',
    headline: live ? 'Bidding is' : 'Set your',
    accentWord: live ? 'open.' : 'budget.',
    summary: live
      ? 'The free-agent auction is open. Every bid is a roster decision — watch the clock.'
      : `The free-agent auction opens ${dayPhrase(days)}. Build your target list before the first nomination.`,
    link: p('/free-agents'),
    linkLabel: 'Scout Free Agents',
    icon: 'gavel',
    composite: { wordmark: 'AUCTION', accent: 'gold', tone: live ? 'red' : null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
    countValue: live ? 'LIVE' : days,
    countLabel: live ? 'Bidding now' : 'Days to the auction',
  };
}

/**
 * Tuesday's power-rankings column. Names the #1 team when the issue has one
 * — the card is ABOUT that team, so it takes that club's colours (`team`).
 */
export function peckingOrderSlotView(env: ViewEnv, issue: PeckingOrderHeroIssue): EventHeroView {
  const { now } = env;
  return {
    pill: `THE PECKING ORDER · WEEK ${issue.week}`,
    headline: issue.leader ? `${issue.leader.name.toUpperCase()}` : 'THE ORDER',
    accentWord: issue.leader ? 'ON TOP.' : 'IS OUT.',
    summary: issue.leader
      ? `Week ${issue.week}'s power rankings are out — ${issue.leader.name} leads the whole league. Where did your team land?`
      : `Week ${issue.week}'s power rankings are out. Where did your team land?`,
    link: issue.href,
    linkLabel: 'SEE THE RANKINGS',
    icon: 'trophy',
    composite: { wordmark: 'PECKING\u00a0ORDER', accent: 'gold', tone: null, scope: 'team' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  };
}

/**
 * Wednesday night's weekly column — the league's own regular feature (The
 * Gauntlet for Archie's). Same card as the news slot, promoting THAT column.
 */
export function columnSlotView(
  env: ViewEnv,
  column: LatestArticle,
  opts: { week?: number; deskByline?: ArticleHeroByline },
): EventHeroView {
  const { now, profile, p } = env;
  const name = profile.copy.columnName.toUpperCase();
  const base = articleHeroView(column.post, {
    pill: opts.week ? `WEEK ${opts.week} · ${name}` : name,
    // The column's own name is its wordmark — it is a named feature, not "news".
    composite: { wordmark: name.replace(/^THE\s+/, '').replace(/\s+/g, '\u00a0'), accent: 'navy', tone: null, scope: 'league' },
    byline: column.byline ?? opts.deskByline ?? SCHEFTER_DESK_BYLINE,
    fallbackLink: p('/news'),
    fallbackLinkLabel: `READ ${name}`,
    dateLabel: articleDateLabel(column.post.timestamp, leagueClock(profile.league).zone),
  });
  return {
    ...base,
    icon: 'news',
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
  };
}

/**
 * The live window of a league with no live scoreboard. The games are real
 * even when the site cannot show them live, so the card says what is true:
 * games are being played (or are final) and the standings are where the
 * results land. The face is still the owner's own starter (casting's
 * `live-scoring` slot). Replaced by the scoreboard the moment the registry
 * turns `liveScoring` on and the page hands the router its props.
 */
export function gamesOnSlotView(
  env: ViewEnv,
  opts: { week?: number; gameWindowLabel: string | null; isLive: boolean },
): EventHeroView {
  const { now, profile, p } = env;
  const weekLabel = opts.week ? `Week ${opts.week}` : 'This week';
  return {
    pill: opts.isLive ? 'GAMES ON' : 'FINAL',
    headline: opts.isLive ? 'GAMES ARE' : 'THE SCORES ARE',
    accentWord: opts.isLive ? 'ON.' : 'IN.',
    summary: opts.isLive
      ? `${weekLabel} is being played across ${profile.copy.everyPool}. Results land in the standings as games go final.`
      : `${opts.gameWindowLabel ?? 'The window'} is final. See where every team stands.`,
    link: p('/standings'),
    linkLabel: 'SEE THE STANDINGS',
    icon: 'nfl',
    // Your starters, your week: a team story.
    composite: { wordmark: 'GAME\u00a0DAY', accent: 'gold', tone: null, scope: 'team' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  };
}
