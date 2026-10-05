/**
 * The shared hero's views — what each state SAYS, for any league.
 *
 * Every builder here reads its league's facts from the profile (./profiles.ts)
 * rather than naming a league: the AFL's "7 keepers by July 15" and its two
 * conferences' draft days are the AFL PROFILE's facts, and the same builders
 * render Archie's nine divisions or the next league's own. Links are built
 * with the league's own path prefix (`env.p`), never written as literals.
 *
 * Every treatment the AFL renders is written as a `composite: { wordmark: …,
 * accent: … }` LITERAL in this file or in the AFL profile, and stays that way:
 * /showcase's guard (tests/hero-showcase-content.test.ts) reads the AFL's
 * treatments straight out of those two files' source. A hoisted object makes
 * a treatment invisible to it — which reads as "no AFL hero renders this", not
 * as a scanner miss. Capabilities the AFL does not have (a league-wide draft,
 * the power-rankings slot, a weekly column) keep their views in
 * ./capability-views.ts so the scan does not claim the AFL renders them.
 */
import type { HeroContent, WhatsNewEntry } from '../../types/whats-new';
import type { ResolvedLeagueEvent } from '../../types/league-events';
import type { GameWindow } from '../../types/hero-state';
import { WHATS_NEW_CATEGORY_LABELS } from '../../types/whats-new';
import { showSundayTicketHero } from '../sunday-ticket-window';
import { randomHeroPlayer } from '../hero-players';
import { resolveFeatureHeadline } from '../whats-new-hero-headline';
import { getAuthor, getAuthorAvatar } from '../../types/schefter';
import { leagueClock } from '../../config/leagues';
import type { RecapDestination } from '../hero-recap-destination';
import { waiverDeadlineCopy, type WaiverDeadlineCopy } from '../waiver-deadline-copy';
import {
  articleDateLabel,
  articleExcerpt,
  articleHeroView,
  emptyArticleHeroView,
  type ArticleHeroByline,
  type LatestArticle,
} from '../article-hero-view';
import { unknownWaiverCopy, waiverClaimsHeroView } from '../waiver-claims-hero';
import type { EventHeroView, HeroSlot } from './types';
import type { LeagueHeroProfile, HeroPoolConfig } from './profiles';

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function daysBetween(later: Date, earlier: Date): number {
  return Math.ceil((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / (1000 * 60 * 60 * 24));
}

export function formatKickerDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const dayPhrase = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

// ── Brand palette ────────────────────────────────────────────────────────────
// Hero accent/glow values. These flow into the `--ev-accent` / `--ev-glow`
// inline custom properties on the event card, so they're raw strings (not CSS
// `var()` tokens) — named here so a single source governs the recurring values.
export const ACCENT_GOLD = '#c9a94e';
export const ACCENT_RED = '#dc2626';
export const ACCENT_GREEN = '#2e8743';
export const ACCENT_AMBER = '#d97706';
export const ACCENT_STEEL = '#cfd6db';
export const GLOW_GOLD = 'rgba(201,169,78,.45)';
export const GLOW_GOLD_SOFT = 'rgba(201,169,78,.4)';
export const GLOW_RED = 'rgba(196,30,58,.6)';
export const GLOW_RED_LIVE = 'rgba(220,38,38,.55)';
export const GLOW_GREEN = 'rgba(46,135,67,.55)';
export const GLOW_AMBER = 'rgba(217,119,6,.55)';
export const GLOW_NAVY = 'rgba(28,73,124,.55)';

/** What every view builder is handed. */
export interface ViewEnv {
  profile: LeagueHeroProfile;
  now: Date;
  /** The viewer's tier, for a tiered league's keeper badge. */
  tier?: string;
  /** The viewer's pool, for the pool-draft cards. */
  userPoolId?: string;
  /** The league's own path for a league-relative path (`/standings` → `/afl-fantasy/standings`). */
  p: (path: string) => string;
}

export type EventViewBuilder = (event: ResolvedLeagueEvent, env: ViewEnv) => EventHeroView;

/** Where "set your lineup" goes for this league — this site, or MFL. */
export function lineupHref(env: ViewEnv): string {
  const { lineup } = env.profile.facts;
  const href = lineup.href(env.now);
  return lineup.external ? href : env.p(href);
}

// ── Calendar event views, by role ────────────────────────────────────────────

export function keeperDeadlineView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, tier, profile, p } = env;
  const k = profile.facts.keepers;
  const days = Math.max(0, daysBetween(event.startDate, now));
  const badge = profile.tierBadge?.(tier);
  return {
    pill: `${event.startDate.getFullYear()} Keeper Deadline`,
    headline: 'Lock in your',
    accentWord: 'core.',
    summary:
      days === 0
        ? `Today is the day — declare your ${k.count} keepers before ${k.time} or the league picks for you.`
        : days === 1
          ? `Tomorrow at ${k.time} — declare your ${k.count} keepers. Anyone left undeclared hits the draft pool.`
          : `${days} days until the keeper deadline. Lock in your ${k.count} protected players before ${k.deadline}.`,
    link: p(k.path),
    linkLabel: 'Manage Keepers',
    // Trophy gold is the keeper window's own colour — the AFL's answer to
    // TheLeague's tag/auction window — and it flips to the urgency red on
    // the day itself, the same tier flip the cut watch makes.
    // A TEAM event — it is YOUR keeper class — so a signed-in owner's card is
    // painted in their club's colours; gold is the fallback for everyone else.
    composite: { wordmark: 'KEEPERS', accent: 'gold', tone: days === 0 ? 'red' : null, scope: 'team' },
    accent: ACCENT_GOLD,
    glow: GLOW_RED,
    player: randomHeroPlayer(now),
    ...(badge ?? {}),
    countValue: days,
    countLabel: days === 0 ? `Lock by ${k.lockLabel} — today` : `Days to lock · ${k.countLabel}`,
  };
}

/**
 * One POOL's draft — the AFL's AL and NL each draft on their own day, off
 * their own MFL page. The pool config says which page (`medium`: MFL's
 * live-draft applet or its email draft), when, and in whose words.
 *
 * DRAFT DAY, from midnight — not just from the start time. Owners open the
 * homepage hours early to get set up, and the room accepts them before the
 * first pick (queue, autopick, chat). Gating the room link on `live` left the
 * morning-of hero pointing only at the draft order, with no route to the
 * place the draft actually happens.
 *
 * The room is offered ONLY to an owner in THIS pool, the same viewer the
 * summary speaks to. This card also leads for other pools' owners and for
 * logged-out visitors (the lead falls back to the earliest draft when we don't
 * know the viewer) — they have no business in this room, and a guest we can't
 * identify just hits MFL's login wall. They keep the internal destinations.
 */
export function poolDraftView(event: ResolvedLeagueEvent, env: ViewEnv, pool: HeroPoolConfig): EventHeroView {
  const { now, userPoolId, profile, p } = env;
  const live = event.isActive;
  const days = Math.max(0, daysBetween(event.startDate, now));
  const isUserPool = userPoolId === pool.id;
  const enterRoom = (live || days === 0) && isUserPool;
  const roomUrl = pool.draftUrl(event.startDate.getFullYear());
  const board = `${p(profile.facts.draftBoardPath)}?conference=${pool.id}`;
  const order = p(profile.facts.draftOrderPath);
  const email = pool.medium === 'email';
  const summary = isUserPool
    ? email
      ? live
        ? `The ${pool.name} email draft is open. Submit your queue and watch the clock — picks tick through one at a time.`
        : days === 0
          ? `Your email draft starts today — ${pool.when}. Open the email draft page and set your queue before the first pick is on the clock.`
          : `Your email draft starts ${dayPhrase(days)} — ${pool.when}. Set your queue before the first pick is on the clock.`
      : live
        ? `The ${pool.name} live draft is happening right now. Make your picks before the timer expires.`
        : days === 0
          ? `Your live draft is today — ${pool.when}. Head into the draft room to set your queue before the clock starts.`
          : `Your live draft is ${dayPhrase(days)} — ${pool.when}. Scout the board and finalize your queue.`
    : event.definition.description;
  return {
    pill: `${pool.label} · ${email ? 'Email' : 'Live'} Draft`,
    headline: live ? (isUserPool ? 'Your draft is' : `${pool.label} draft is`) : 'Build your',
    accentWord: live ? (email ? 'open.' : 'live.') : 'empire.',
    summary,
    // Three destinations, and only one of them lets an owner PICK:
    //   pool owner, draft day → the pool's MFL draft page. Beats both our
    //     pages: the order is settled by now, and the board is read-only.
    //     Once picks are live the board still reaches them as a SECONDARY
    //     link, attached post-resolve in pickLeadCalendarEvent.
    //   otherwise, live     → the broadcast board (what the room is watching).
    //   otherwise           → our draft order — the board is empty slots
    //     until the draft.
    // The pool is pinned wherever a board link is built, so it lands on the
    // right one of the independent boards.
    link: enterRoom ? roomUrl : live ? board : order,
    linkLabel: enterRoom
      ? email ? 'Open Email Draft' : 'Enter Draft Room'
      : live ? (email ? 'Watch the Board' : 'Open the Draft Board') : 'View Draft Order',
    isExternal: enterRoom,
    // Pre-start on draft day the board is empty, so the order — displaced as
    // the CTA — stays reachable here instead. Once picks are live the board
    // is the better second link and post-resolve supplies it.
    secondaryLinks: enterRoom && !live ? [{ label: 'View Draft Order', href: order }] : undefined,
    icon: 'draft-podium',
    // Each pool names itself in the ghost wordmark — an owner glancing at the
    // homepage must never have to read the pill to know whose draft is on
    // screen. A draft actually running takes the urgency red. A LEAGUE event:
    // the draft belongs to the pool, not to one club.
    composite: { ...pool.composite, tone: live ? 'red' : null },
    accent: pool.accent,
    glow: pool.glow,
    player: randomHeroPlayer(now),
    countValue: live ? 'LIVE' : days,
    countLabel: live ? 'Drafting now' : `Days to ${pool.label} draft · ${pool.countLabel}`,
  };
}

export function seasonStartView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: 'NFL Kickoff',
    headline: 'Football is',
    accentWord: 'back.',
    summary: event.definition.description,
    link: lineupHref(env),
    linkLabel: profile.facts.lineup.label,
    isExternal: profile.facts.lineup.external || undefined,
    icon: 'nfl',
    // Kickoff belongs to the whole league — everyone's season starts at the
    // same whistle — so it keeps the league's own ground rather than any one
    // club's, and takes the urgency tone on the night itself. The face is
    // still YOURS (see league-hero casting: your likely starter in the first
    // game you play in); a league event can cast a personal player without
    // becoming a team event, which is the whole point of `scope`.
    composite: { wordmark: 'KICKOFF', accent: 'navy', tone: days === 0 ? 'red' : null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: 'rgba(196,30,58,.5)',
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: days === 0 ? 'Kickoff tonight · 5:20 PM PT' : 'Days to NFL kickoff',
  };
}

export function tradeDeadlineView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  const t = profile.facts.tradeDeadline;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: 'Trade Deadline',
    headline: 'Last call to',
    accentWord: 'deal.',
    summary:
      days === 1
        ? `Trade deadline is tomorrow. After ${t.day} night, rosters are locked through the playoffs.`
        : `${days} days until the trade deadline. ${t.leadIn}`,
    link: p(t.path),
    linkLabel: t.linkLabel,
    // A player actually on YOUR block is the face, so this is a team story.
    // Red on the day itself — the same urgency flip the keeper deadline makes.
    composite: { wordmark: 'DEADLINE', accent: 'gold', tone: days === 0 ? 'red' : null, scope: 'team' },
    icon: 'exchange',
    accent: '#ff7a59',
    glow: 'rgba(220,38,38,.55)',
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: `Days to deadline · ${t.countLabel}`,
  };
}

export function regularSeasonEndsView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: 'Season Finale',
    headline: 'Seeds are',
    accentWord: 'locking.',
    summary: event.definition.description,
    link: p('/standings'),
    linkLabel: 'View Standings',
    icon: 'gavel',
    // Seeds locking is the whole league's week, not one club's.
    composite: { wordmark: 'FINALE', accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: `Days to Week ${event.definition.heroWeek ?? profile.facts.weeks.finalRegular} finale`,
  };
}

export function playoffsLeadView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: 'Playoffs Incoming',
    headline: 'Bracket time is',
    accentWord: 'here.',
    summary: event.definition.description,
    link: p(profile.facts.playoffsPath),
    linkLabel: 'View Bracket',
    icon: 'playoff',
    composite: { wordmark: 'PLAYOFFS', accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: 'rgba(196,30,58,.55)',
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: `Days to Week ${event.definition.heroWeek ?? profile.facts.weeks.playoffStart} tipoff`,
  };
}

export function championshipLeadView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: profile.facts.championshipName,
    headline: 'One game for the',
    accentWord: 'crown.',
    summary: event.definition.description,
    link: p(profile.facts.playoffsPath),
    linkLabel: 'View Bracket',
    icon: 'champ',
    // Trophy gold for the one game the whole league is watching.
    composite: { wordmark: 'TITLE\u00a0GAME', accent: 'gold', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: `Days to Week ${event.definition.heroWeek ?? profile.facts.weeks.championship} title game`,
  };
}

export function newLeagueYearView(event: ResolvedLeagueEvent, env: ViewEnv): EventHeroView {
  const { now, p } = env;
  const days = Math.max(0, daysBetween(event.startDate, now));
  return {
    pill: 'New League Year',
    headline: 'The season',
    accentWord: 'resets.',
    summary: event.definition.description,
    link: p('/rosters'),
    linkLabel: 'Review Rosters',
    icon: 'star',
    // The reset belongs to everyone; the face is a rookie, owned by nobody yet.
    composite: { wordmark: 'NEW\u00a0YEAR', accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: days === 0 ? 'Rolling over today' : 'Days to league rollover',
  };
}

export function championCrownedView(env: ViewEnv): EventHeroView {
  const { now, profile, p } = env;
  return {
    pill: 'Champion Crowned',
    headline: 'A new',
    accentWord: 'champion.',
    summary: profile.copy.championCrownedSummary,
    link: p(profile.facts.playoffsPath),
    linkLabel: 'View Recap',
    icon: 'trophy',
    // Deliberately LEAGUE, not team. The cast model here is a league-wide
    // headliner rather than the champion's own player, so painting the card in
    // a club's colours would dress it in whoever happened to be cast — the
    // exact stranger's-colours trap the pool scoping exists to avoid.
    composite: { wordmark: 'CHAMPION', accent: 'gold', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD_SOFT,
    player: randomHeroPlayer(now),
  };
}

// ── Slot / feature / default view builders ───────────────────────────────────
// Synthetic keys dispatched by the resolver — NOT calendar events. These
// never take the calendar border. Voice: the league's news desk — beat
// reporter, present tense, ALL CAPS headlines.

/**
 * The byline the desk card wears when there is no article to take one from.
 * A real article's byline comes from ITS OWN `authorId` (see
 * article-hero-view.ts) — the feeds carry external reporters, and putting the
 * house face on someone else's story misattributes it.
 */
export const SCHEFTER_DESK_BYLINE: ArticleHeroByline = {
  name: getAuthor('claude').name,
  avatar: getAuthorAvatar(getAuthor('claude')),
};

export interface SlotContext {
  env: ViewEnv;
  slot?: HeroSlot;
  gameWindow?: GameWindow;
  week?: number;
  whatsNewEntry?: WhatsNewEntry;
  /** Owner's lineup for the week is in (true), not (false), or unknown / signed out (null). */
  lineupSubmitted?: boolean | null;
  /** Tuesday recap destination + the week actually in the books. */
  recap?: RecapDestination;
  /** Calendar-derived waiver deadline copy. */
  waiver?: WaiverDeadlineCopy;
  /** The story the news slot promotes. */
  article?: LatestArticle;
  /** The desk's own byline, when the league's desk wears a persona. */
  deskByline?: ArticleHeroByline;
}

export const GAME_WINDOW_LABEL: Record<NonNullable<GameWindow>, string> = {
  tnf: 'Thursday Night Football',
  sunday: 'Sunday slate',
  snf: 'Sunday Night Football',
  mnf: 'Monday Night Football',
};

const GAME_WINDOW_PILL: Record<NonNullable<GameWindow>, string> = {
  tnf: 'THURSDAY NIGHT',
  sunday: 'SUNDAY — LIVE',
  snf: 'SUNDAY NIGHT',
  mnf: 'MONDAY NIGHT',
};

/**
 * The Saturday / Sunday-morning slot, two different jobs: Saturday is the
 * last call to set a lineup; Sunday morning the lineup is (or isn't) in and
 * the question is which four games go on the multiview — the Sunday Ticket
 * board's — and from 5pm Saturday an owner whose lineup is already in gets
 * the board too (`showSundayTicketHero`). Exported so the split is testable
 * without the whole resolver.
 */
export function gameDayPreviewSlotView({ env, week, lineupSubmitted }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  const weekLabel = week ? `Week ${week}` : 'this week';
  if (profile.facts.sundayTicket && showSundayTicketHero(now, lineupSubmitted)) {
    return {
      pill: 'SUNDAY TICKET',
      headline: 'BUILD YOUR',
      accentWord: 'MULTIVIEW.',
      summary: `Four boxes a window, ranked by how many of your starters are on the field — across every league you play. ${weekLabel} kicks off at 10 AM PT.`,
      link: p('/sunday-ticket'),
      linkLabel: 'BUILD YOUR SUNDAY',
      icon: 'nfl',
      // YOUR starters on YOUR multiview — a team story, so a signed-in owner's
      // card takes their club's colours and crest.
      composite: { wordmark: 'SUNDAY\u00a0TICKET', accent: 'navy', tone: null, scope: 'team' },
      accent: ACCENT_GREEN,
      glow: GLOW_GREEN,
      player: randomHeroPlayer(now),
      countValue: '10 AM PT',
      countLabel: 'Early window kicks off',
    };
  }
  const lineup = profile.facts.lineup;
  return {
    pill: 'GAME DAY',
    headline: 'LINEUPS LOCK AT',
    accentWord: 'KICKOFF.',
    summary: `Last call to set starters for ${weekLabel} — ${profile.copy.gameDayChores}, lock it in.`,
    link: lineupHref(env),
    linkLabel: lineup.label.toUpperCase(),
    isExternal: lineup.external || undefined,
    icon: 'clipboard',
    // Your lineup, your deadline: a team event.
    composite: { wordmark: 'GAME\u00a0DAY', accent: 'gold', tone: null, scope: 'team' },
    accent: ACCENT_AMBER,
    glow: GLOW_AMBER,
    player: randomHeroPlayer(now),
    countValue: 'LIVE SOON',
    countLabel: 'Lineups lock at kickoff',
  };
}

export function liveScoringSlotView({ env, gameWindow, week }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  const gw = gameWindow && gameWindow in GAME_WINDOW_LABEL ? (gameWindow as NonNullable<GameWindow>) : null;
  const weekLabel = week ? `Week ${week}` : 'this week';
  const { everyPool, poolNames } = profile.copy;
  const summary =
    gw === 'tnf'
      ? `Thursday night kicks off ${weekLabel}. Scores updating across ${everyPool}.`
      : gw === 'snf'
        ? `Sunday Night Football is on — late swings still in play across ${poolNames}.`
        : gw === 'mnf'
          ? `Monday Night Football closes ${weekLabel}. Final swings on the board.`
          : `${weekLabel} is in motion — scoreboards updating across ${poolNames}.`;
  return {
    pill: gw ? GAME_WINDOW_PILL[gw] : 'LIVE NOW',
    headline: 'GAMES ARE',
    accentWord: 'LIVE.',
    summary,
    link: p('/standings'),
    linkLabel: 'VIEW LIVE SCORES',
    icon: 'nfl',
    accent: ACCENT_RED,
    glow: GLOW_RED_LIVE,
    player: randomHeroPlayer(now),
    countValue: 'LIVE',
    countLabel: gw ? GAME_WINDOW_LABEL[gw] : 'live games',
  };
}

export function standingsSlotView({ env, week }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  return {
    pill: 'MONDAY STANDINGS',
    headline: 'THE RACE',
    accentWord: 'TIGHTENS.',
    summary: `Where ${profile.copy.playoffPicture} stands after ${week ? `Week ${week}` : 'this week'} — seeds, tiebreakers, and the bubble.`,
    link: p('/standings'),
    linkLabel: 'SEE THE RACE',
    icon: 'trophy',
    // LEAGUE, not team — and the reasoning that said otherwise was wrong.
    //
    // The face is the leader's headliner, so "the card wears the club the race
    // is about" looks right. But the leader is drawn from the whole league
    // while the franchise accent resolves within the VIEWER's pool. A league
    // that rosters the same player in several pools would then paint the card
    // for whichever of THEIR clubs also rosters him: a card painted for a team
    // that is not the one the copy is about. (Copilot, PR #1025.)
    composite: { wordmark: 'STANDINGS', accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
  };
}

export function recapSlotView({ env, recap }: SlotContext): EventHeroView {
  const { now, p } = env;
  return {
    // The pill, the composite wordmark and the content kicker stay 'RECAP' even
    // with no week: they name the SLOT, and it genuinely is Tuesday's recap
    // slot — the falsehood was never the branding, it was the headline/summary
    // asserting a finished week and promising its content.
    pill: 'TUESDAY RECAP',
    // No completed week means there is no week in review to headline — the
    // kickoff-to-first-results window (issue #1086 F2).
    headline: recap?.week ? 'THE WEEK IN' : 'THE SEASON IS',
    accentWord: recap?.week ? 'REVIEW.' : 'UNDER WAY.',
    // The week in the BOOKS, which is not `week`: `getCurrentNFLWeek` rolls to
    // the upcoming week on Tuesday — the morning this slot runs — so falling
    // back to it would name games not yet played.
    summary: recap?.week
      ? `Week ${recap.week} is in the books — top scorers, biggest swings, and the games that moved the standings.`
      : 'No week is in the books yet. Here is the latest from around the league while the first results come in.',
    // The recap column when one was written, else the completed week's own
    // scoreboard. NOT the news listing: a card headlined "THE WEEK IN REVIEW."
    // that lands on the undifferentiated feed makes the reader go find it.
    link: recap?.href ?? p('/news'),
    linkLabel: (recap?.label ?? 'Read the recap').toUpperCase(),
    icon: 'commenting',
    // The recap's headline IS a franchise's week — the top scorer is cast
    // deterministically and the card wears the club that rosters him.
    composite: { wordmark: 'RECAP', accent: 'recap', tone: null, scope: 'team' },
    accent: ACCENT_GOLD,
    glow: GLOW_NAVY,
    player: randomHeroPlayer(now),
  };
}

/**
 * WAIVER DAY IS NOT ONE DAY, AND ITS DAY IS NOT OURS TO HARDCODE. The slot
 * runs Tuesday 2pm PT → Wednesday 8pm PT (`getDailySlot`); `waiver` carries
 * the day, the hour and the viewer's clock, all read from MFL's calendar by
 * the page. Absent, the fallback names no day at all rather than guessing one.
 */
export function waiverSlotView({ env, waiver }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  return {
    // Copy and treatment are shared with TheLeague's waiver card, which renders
    // this same view through the same component — see waiver-claims-hero.ts.
    ...waiverClaimsHeroView(waiver ?? unknownWaiverCopy(now), {
      link: p(profile.facts.freeAgentsPath),
      composite: { wordmark: 'WAIVERS', accent: 'navy', tone: null, scope: 'league' },
    }),
    icon: 'binoculars',
    accent: ACCENT_GREEN,
    glow: GLOW_GREEN,
    player: randomHeroPlayer(now),
  };
}

/**
 * THE NEWS CARD NAMES THE STORY, AND ITS CTA IS THAT STORY'S PERMALINK. The
 * article is passed in by the page and `articleHeroView` is the same builder
 * TheLeague's card uses, so no league can drift into its own idea of what a
 * news card says. The desk copy survives as the EMPTY state, the one place it
 * is true: a feed with no article has no story to name and nowhere but the
 * listing to send anyone.
 */
export function articleSlotView({ env, week, article, deskByline }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  const byline: ArticleHeroByline = article?.byline ?? deskByline ?? SCHEFTER_DESK_BYLINE;
  const short = profile.copy.aroundThe.toUpperCase();
  const base = article
    ? articleHeroView(article.post, {
        pill: week ? `WEEK ${week}` : `AROUND THE ${short}`,
        // Coverage of the whole league, not a dispatch from one clubhouse.
        composite: { wordmark: 'NEWS', accent: 'navy', tone: null, scope: 'league' },
        byline,
        fallbackLink: p('/news'),
        fallbackLinkLabel: 'READ THE LATEST',
        dateLabel: articleDateLabel(article.post.timestamp, leagueClock(profile.league).zone),
      })
    : emptyArticleHeroView({
        pill: week ? `WEEK ${week}` : `AROUND THE ${short}`,
        headline: 'AROUND THE',
        accentWord: `${short}.`,
        summary: profile.copy.deskSummary,
        composite: { wordmark: 'NEWS', accent: 'navy', tone: null, scope: 'league' },
        byline,
        link: p('/news'),
        linkLabel: 'READ THE LATEST',
      });
  return {
    ...base,
    icon: 'news',
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(now),
  };
}

export function featureSlotView({ env, whatsNewEntry: entry }: SlotContext): EventHeroView {
  const { now, profile, p } = env;
  const pillBase = entry ? WHATS_NEW_CATEGORY_LABELS[entry.category] : "WHAT'S NEW";
  // The headline names the FEATURE — authored `heroHeadline` copy wins;
  // otherwise the entry's title is split.
  const { headline, accentWord } = resolveFeatureHeadline(entry);
  return {
    pill: (pillBase ?? "WHAT'S NEW").toUpperCase(),
    headline,
    accentWord,
    summary: entry?.summary ?? `New on the ${profile.copy.shortName} site — take a look.`,
    // No explicit link → CTA into the entry's own article, never the listing
    // (same rule as featureToHero).
    link: entry ? (entry.link ?? p(`/whats-new/${entry.id}`)) : undefined,
    linkLabel: (entry?.linkLabel ?? (entry?.link ? 'CHECK IT OUT' : 'READ THE FULL STORY')).toUpperCase(),
    icon: entry?.icon ?? 'news',
    // A site announcement belongs to nobody, so it stays in the league's own
    // navy however it is cast. The screenshot is the art when there is one
    // (see LeagueCompositeHero), which is why this state is the only one
    // allowed through the router without a cast model.
    composite: { wordmark: "WHAT'S\u00a0NEW", accent: 'navy', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    // The feature's own screenshot is the art; the random player webp is
    // only the fallback for entries that never got a capture.
    screenshot: entry?.image,
    player: randomHeroPlayer(now),
  };
}

/**
 * A plain event card for a state that only has CONTENT — a contract league's
 * What's New fallback, rendered through its own branded card, still carries a
 * shared view so the shared card could render it too.
 */
export function eventSlotView(env: ViewEnv, content: HeroContent): EventHeroView {
  return {
    pill: (content.kicker ?? 'LEAGUE EVENT').toUpperCase(),
    headline: content.title.toUpperCase(),
    accentWord: '',
    summary: content.summary,
    link: content.link,
    linkLabel: (content.linkLabel ?? 'LEARN MORE').toUpperCase(),
    isExternal: content.isExternal,
    icon: content.icon,
    composite: { wordmark: 'EVENT', accent: 'gold', tone: null, scope: 'league' },
    accent: ACCENT_GOLD,
    glow: GLOW_GOLD,
    player: randomHeroPlayer(env.now),
  };
}

// ── HeroContent builders ─────────────────────────────────────────────────────
// `content` is the state's plain-text twin of its view. The homepage reads
// `heroEventId` / `heroEntryId` off it; the rest is kept in step with the view
// so that anything reading it later does not quietly restore a fixed bug.

/**
 * Entries without an explicit link CTA into their own What's New article —
 * never the generic listing.
 */
export function featureToHero(entry: WhatsNewEntry, p: (path: string) => string): HeroContent {
  return {
    source: 'feature',
    title: entry.title,
    summary: entry.summary,
    link: entry.link ?? p(`/whats-new/${entry.id}`),
    linkLabel: entry.linkLabel ?? (entry.link ? 'Check it out' : 'Read the full story'),
    icon: entry.icon,
    // --league-accent, not --color-secondary (TheLeague's brand green, which
    // other league themes never override). Not rendered by the event card,
    // which reads `--ev-accent` off the VIEW; fixed so it can't become a trap.
    accentColor: 'var(--league-accent, #c41e3a)',
    image: entry.image,
    imageAlt: entry.imageAlt,
    kicker: WHATS_NEW_CATEGORY_LABELS[entry.category],
    kickerDate: formatKickerDate(new Date(entry.date + 'T00:00:00')),
    heroArt: entry.heroArt,
    heroPlayerId: entry.heroPlayerId,
    heroPlayerDescriptor: entry.heroPlayerDescriptor,
    heroEntryId: entry.id,
  };
}

export function eventToHero(event: ResolvedLeagueEvent): HeroContent {
  const link = event.actionLinks[0] ?? event.resultLinks[0];
  return {
    source: 'event',
    title: event.definition.name,
    summary: event.definition.description,
    link: link?.url,
    linkLabel: link?.label ?? 'Learn more',
    icon: event.definition.icon,
    accentColor: 'var(--color-primary, #1c497c)',
    heroEventId: event.definition.id,
    image: event.definition.image,
    imageAlt: event.definition.imageAlt,
    isActive: event.isActive,
    isUrgent: event.isUrgent,
    isExternal: link?.external,
    kicker: event.isActive ? 'Happening Now' : event.isUrgent ? 'Coming Up' : 'League Event',
    kickerDate: formatKickerDate(event.startDate),
  };
}

export function regularSeasonContent(
  slot: HeroSlot,
  week: number | undefined,
  gameWindow: GameWindow,
  ctx: SlotContext,
): HeroContent {
  const { env, lineupSubmitted = null, recap, waiver, article } = ctx;
  const { now, profile, p } = env;
  const weekLabel = week ? `Week ${week}` : 'Regular Season';
  switch (slot) {
    case 'live-scoring': {
      const label = gameWindow && gameWindow in GAME_WINDOW_LABEL ? GAME_WINDOW_LABEL[gameWindow as NonNullable<GameWindow>] : 'live games';
      return {
        source: 'event',
        title: `Games in Progress — ${weekLabel}`,
        summary: `${label} is under way. Scoreboards update live across ${profile.copy.everyPool}.`,
        link: p('/standings'),
        linkLabel: 'View Standings',
        icon: 'nfl',
        accentColor: 'var(--color-error, #dc2626)',
        kicker: 'Live Now',
        isActive: true,
      };
    }
    case 'standings':
      return {
        source: 'event',
        title: `Monday Standings Check — ${weekLabel}`,
        summary: `Where ${profile.copy.playoffPicture} stands heading into Monday Night Football.`,
        link: p('/standings'),
        linkLabel: 'See the race',
        icon: 'trophy',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Standings',
      };
    case 'recap':
      return {
        source: 'event',
        // Never `weekLabel`, which is built from the upcoming week.
        title: recap?.week ? `Week ${recap.week} Recap` : 'Around The League',
        summary: recap?.week
          ? profile.copy.recapSummary
          : 'No week is in the books yet — here is the latest from around the league.',
        link: recap?.href ?? p('/news'),
        linkLabel: recap?.label ?? 'Read the recap',
        icon: 'commenting',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Weekly Recap',
      };
    case 'waiver-wire': {
      const copy = waiver ?? waiverDeadlineCopy(
        { mode: 'unknown', changesAt: null, nextMode: 'unknown', nextProcesses: false, reason: 'No waiver copy supplied to the hero.' },
        { now },
      );
      const when = copy.word.charAt(0) + copy.word.slice(1).toLowerCase();
      const cleared = copy.mode === 'fcfs';
      return {
        source: 'event',
        title: cleared ? 'Waivers Have Cleared' : `Waivers Process ${when}`,
        summary: copy.summary,
        link: p(profile.facts.freeAgentsPath),
        linkLabel: cleared ? 'Browse Free Agents' : 'Set Your Claims',
        icon: 'binoculars',
        accentColor: 'var(--cat-free-agency, #2e8743)',
        kicker: cleared ? 'Free Agency' : 'Waiver Day',
      };
    }
    case 'game-day-preview':
      if (profile.facts.sundayTicket && showSundayTicketHero(now, lineupSubmitted)) {
        return {
          source: 'event',
          title: `Sunday Ticket — ${weekLabel}`,
          summary: 'The four games to put on your multiview each window, ranked by your starters across every league you play.',
          link: p('/sunday-ticket'),
          linkLabel: 'Build your multiview',
          icon: 'nfl',
          accentColor: 'var(--cat-regular-season, #1c497c)',
          kicker: 'Sunday Ticket',
        };
      }
      return {
        source: 'event',
        title: `Game Day — ${weekLabel}`,
        summary: `Lineups lock at kickoff. ${profile.copy.gameDayContent}`,
        link: lineupHref(env),
        linkLabel: profile.facts.lineup.label,
        icon: 'clipboard',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'Game Day',
      };
    case 'article':
    case 'column':
    case 'pecking-order':
    default:
      return {
        source: 'event',
        title: article ? article.post.headline : `${weekLabel} — Around the ${profile.copy.aroundThe}`,
        summary: article ? articleExcerpt(article.post.body) : profile.copy.deskSummary,
        link: article?.post.link ?? p('/news'),
        linkLabel: article?.post.linkLabel ?? 'Read the latest',
        icon: 'news',
        accentColor: 'var(--cat-regular-season, #1c497c)',
        kicker: 'The Beat',
      };
  }
}
