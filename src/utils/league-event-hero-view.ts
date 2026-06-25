/**
 * TheLeague event-hero view builder.
 *
 * Turns the resolver's chosen offseason-fallback `HeroContent` into a branded
 * `LeagueEventView` for LeagueEventHero.astro — TheLeague's twin of the AFL
 * AflEventHero. Building from the already-resolved fallback (rather than
 * re-running the waterfall) guarantees the branded card shows exactly the
 * content `resolveHeroContent` picked.
 *
 * Theme: card base is TheLeague blue; pill + CTA stay brand green (in the
 * component). The accent word / countdown / border color varies PER EVENT by
 * its calendar category, using the shared `--cat-*` palette values.
 *
 * Only calendar events (`source === 'event'`) get the accent border; fresh
 * features and the default fallback render the same card without it.
 */
import type { HeroContent } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import { randomHeroPlayer } from './hero-players';

/** Visual props passed straight to LeagueEventHero. */
export interface LeagueEventView {
  pill: string;
  headline: string;
  accentWord?: string;
  summary: string;
  link?: string;
  linkLabel?: string;
  isExternal?: boolean;
  icon?: string;
  accent?: string;
  glow?: string;
  player?: string;
  countValue?: string | number;
  countLabel?: string;
}

// ── Category palette (matches the `--cat-*` tokens) ──────────────────────────
type EventCategory = ResolvedLeagueEvent['definition']['category'];

export const CATEGORY_ACCENT: Record<EventCategory, string> = {
  // Darkened from #60a5fa: the pill is white text at 13px bold (not WCAG "large"
  // text), so it needs ≥4.5:1 for AA. #2563eb ≈ 5.2:1 clears it; #60a5fa was ~2.5:1.
  preseason: '#2563eb',
  'free-agency': '#2e8743',
  draft: '#7c3aed',
  'regular-season': '#1c497c',
};

export const CATEGORY_GLOW: Record<EventCategory, string> = {
  preseason: 'rgba(37,99,235,.5)',
  'free-agency': 'rgba(46,135,67,.5)',
  draft: 'rgba(124,58,237,.5)',
  'regular-season': 'rgba(28,73,124,.5)',
};

// ── Date helpers ─────────────────────────────────────────────────────────────
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Calendar-day diff (midnight-to-midnight), floored at 0. */
function daysUntil(target: Date, now: Date): number {
  return Math.max(
    0,
    Math.ceil((startOfDay(target).getTime() - startOfDay(now).getTime()) / 86_400_000),
  );
}

// ── Per-event rich configs ───────────────────────────────────────────────────
interface EventCtx {
  now: Date;
  days: number;
  event: ResolvedLeagueEvent;
}

type EventViewBuilder = (ctx: EventCtx) => LeagueEventView;

const accentFor = (e: ResolvedLeagueEvent) => CATEGORY_ACCENT[e.definition.category];
const glowFor = (e: ResolvedLeagueEvent) => CATEGORY_GLOW[e.definition.category];

const EVENT_VIEW: Record<string, EventViewBuilder> = {
  'nfl-draft': ({ now, days, event }) => ({
    pill: `${event.startDate.getFullYear()} NFL Draft`,
    headline: 'The board is',
    accentWord: 'set.',
    summary:
      days <= 0
        ? 'The NFL Draft is here — watch the rookies come off the board and start shaping your class.'
        : `${days} days until the NFL Draft. Scout the incoming rookie class before your draft order locks.`,
    link: '/theleague/draft-predictor',
    linkLabel: 'Open Draft Predictor',
    icon: 'nfl',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to NFL Draft',
  }),

  'rookie-draft': ({ now, days, event }) => ({
    pill: 'Rookie Draft',
    headline: 'Your rookie class',
    accentWord: 'awaits.',
    summary:
      days <= 0
        ? 'The 3-round rookie draft is live — 12-hour pick timer. Make your selections.'
        : `${days} days until the rookie draft. Three rounds, 12-hour timer — line up your queue now.`,
    link: '/theleague/draft-predictor',
    linkLabel: 'Open Draft Predictor',
    icon: 'draft-podium',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to rookie draft',
  }),

  'new-season-starts': ({ now, days, event }) => ({
    pill: 'New League Year',
    headline: 'Contracts',
    accentWord: 'roll over.',
    summary:
      'A new season begins — contracts roll forward with the 10% salary escalation applied. Review your books before the auction.',
    link: '/theleague/rosters',
    linkLabel: 'View Rosters',
    icon: 'star',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: days <= 0 ? 'Rolling over today' : 'Days to new season',
  }),

  'last-day-release': ({ now, days, event }) => ({
    pill: 'Last Day to Release',
    headline: 'Final cuts before the',
    accentWord: 'rollover.',
    summary:
      'Last chance to release players in the current season before contracts roll and salaries escalate. Make your decisions count.',
    link: '/theleague/rosters',
    linkLabel: 'Manage Roster',
    icon: 'user-times',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: days <= 0 ? 'Releases close 8:45 PM PT' : 'Days to release deadline',
  }),

  'team-purchase-deadline': ({ now, days, event }) => ({
    pill: 'Team Purchase Deadline',
    headline: 'Claim your franchise for',
    accentWord: 'next year.',
    summary: 'Deadline to purchase your team for the upcoming season. Secure your spot before the books open.',
    link: '/theleague/standings',
    linkLabel: 'View League',
    icon: 'dollar',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to purchase deadline',
  }),

  'declare-rookie-contracts': ({ now, days, event }) => ({
    pill: 'Declare Contracts · Cut to 22',
    headline: 'Set the years,',
    accentWord: 'trim the roster.',
    summary:
      'Declare contract years for your rookies and cut down to 22 active players. Who makes the final roster?',
    link: '/theleague/rosters',
    linkLabel: 'Manage Roster',
    icon: 'clipboard',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to declare · cut to 22',
  }),

  'offseason-fa-closes': ({ now, days, event }) => ({
    pill: 'Free Agency Closing',
    headline: 'Last call on the',
    accentWord: 'auction.',
    summary:
      'No new auctions can start after this date — open bids and live auctions will finish out. Get your final claims in.',
    link: '/theleague/rosters',
    linkLabel: 'Review Rosters',
    icon: 'podium-persona',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to FA close',
  }),

  'nfl-season-starts': ({ now, days, event }) => ({
    pill: 'NFL Kickoff',
    headline: 'Football is',
    accentWord: 'back.',
    summary: 'NFL kickoff and the start of weekly fantasy matchups. Set your Week 1 lineup before the games begin.',
    link: '/theleague/lineup',
    linkLabel: 'Submit Lineup',
    icon: 'nfl',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: days <= 0 ? 'Kickoff is today' : 'Days to NFL kickoff',
  }),

  'trading-deadline': ({ now, days, event }) => ({
    pill: 'Trade Deadline',
    headline: 'Last call to',
    accentWord: 'deal.',
    summary:
      days <= 1
        ? 'The trade deadline is here. After today, rosters are locked for trades through the playoffs.'
        : `${days} days until the trade deadline. Line up your final moves in the trade builder.`,
    link: '/theleague/trade-builder',
    linkLabel: 'Open Trade Builder',
    icon: 'exchange',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to trade deadline',
  }),

  'in-season-fa-ends': ({ now, days, event }) => ({
    pill: 'Free Agency Ends',
    headline: 'Rosters are about to',
    accentWord: 'freeze.',
    summary: 'No more free agent pickups after Week 16. Lock in the players you want for the playoff push.',
    link: '/theleague/rosters',
    linkLabel: 'View Rosters',
    icon: 'gavel',
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: days,
    countLabel: 'Days to FA freeze',
  }),
};

/** Minimal branded view synthesized for any calendar event without a rich config. */
function synthesizeEventView({ now, days, event }: EventCtx): LeagueEventView {
  return {
    pill: event.isActive ? 'Happening Now' : event.isUrgent ? 'Coming Up' : 'League Event',
    headline: event.definition.name,
    accentWord: '',
    summary: event.definition.description,
    link: event.actionLinks[0]?.url ?? event.resultLinks[0]?.url,
    linkLabel: event.actionLinks[0]?.label ?? event.resultLinks[0]?.label ?? 'Learn more',
    isExternal: event.actionLinks[0]?.external ?? event.resultLinks[0]?.external,
    icon: event.definition.icon,
    accent: accentFor(event),
    glow: glowFor(event),
    player: randomHeroPlayer(now),
    countValue: event.isActive ? 'NOW' : days,
    countLabel: event.isActive ? 'Live now' : 'Days to go',
  };
}

// ── Feature & default views ──────────────────────────────────────────────────
function buildFeatureView(fallback: HeroContent, now: Date): LeagueEventView {
  return {
    pill: (fallback.kicker ?? "What's New").toUpperCase(),
    headline: 'Fresh on the',
    accentWord: 'site.',
    summary: fallback.summary,
    link: fallback.link,
    linkLabel: fallback.linkLabel ?? 'Check it out',
    isExternal: fallback.isExternal,
    icon: fallback.icon ?? 'star',
    accent: CATEGORY_ACCENT['free-agency'],
    glow: CATEGORY_GLOW['free-agency'],
    player: randomHeroPlayer(now),
  };
}

function buildDefaultView(fallback: HeroContent, now: Date): LeagueEventView {
  return {
    pill: (fallback.kicker ?? 'The League').toUpperCase(),
    headline: fallback.title,
    accentWord: '',
    summary: fallback.summary,
    link: fallback.link,
    linkLabel: fallback.linkLabel ?? 'Learn more',
    isExternal: fallback.isExternal,
    icon: fallback.icon ?? 'star',
    accent: CATEGORY_ACCENT['regular-season'],
    glow: CATEGORY_GLOW['regular-season'],
    player: randomHeroPlayer(now),
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

/** Find the resolved event the fallback chose, so we can read its real date. */
function findTimelineEvent(timeline: WhatsNextTimeline | undefined, id: string): ResolvedLeagueEvent | undefined {
  if (!timeline) return undefined;
  return [timeline.current, timeline.next, timeline.upcoming].find(
    (e): e is ResolvedLeagueEvent => !!e && e.definition.id === id,
  );
}

/**
 * Build a branded LeagueEventView from the resolver's chosen fallback content.
 * `bordered` is true only for calendar events (source === 'event').
 */
export function buildLeagueEventView(
  fallback: HeroContent,
  timeline: WhatsNextTimeline | undefined,
  referenceDate: Date,
): { view: LeagueEventView; bordered: boolean } {
  if (fallback.source === 'event' && fallback.heroEventId) {
    const event = findTimelineEvent(timeline, fallback.heroEventId);
    if (event) {
      const days = daysUntil(event.startDate, referenceDate);
      const ctx: EventCtx = { now: referenceDate, days, event };
      const builder = EVENT_VIEW[event.definition.id];
      const view = builder ? builder(ctx) : synthesizeEventView(ctx);
      return { view, bordered: true };
    }
    // Event chosen but not found in the timeline — fall through to a synthesized
    // default so the hero still renders branded.
    return { view: buildDefaultView(fallback, referenceDate), bordered: false };
  }

  if (fallback.source === 'feature') {
    return { view: buildFeatureView(fallback, referenceDate), bordered: false };
  }

  return { view: buildDefaultView(fallback, referenceDate), bordered: false };
}
