/**
 * Hero Resolver - Automated Homepage Marketing Engine
 *
 * Determines what content to display in the hero banner on the homepage.
 * Walks a priority table top-to-bottom and returns the first match.
 *
 * Priority (highest to lowest):
 * 0a. Auction hero window (Monday before auction → 30 days) — always wins
 * 0b. Draft hero window (Monday after NFL Draft → 30 days) — always wins
 * 1. New feature announcement (≤7 days old, random pick if multiple)
 * 2. Urgent league event (within urgencyDays)
 * 3. Active league event (happening now)
 * 4. Upcoming league event (within 7 days)
 * 5. Default fallback: newest What's New article (any age)
 */

import type { WhatsNewEntry, HeroContent } from '../types/whats-new';
import { WHATS_NEW_CATEGORY_LABELS } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import { formatEventDate, formatEventDateRange, getStatusText } from './event-date-formatter';
import { getNthDayOfMonth, getNflDraftDate, getRookieDraftDate } from './league-event-resolver';

/** Format a YYYY-MM-DD date string for eyebrow display (e.g., "Mar 2, 2026") */
function formatKickerDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How many days a new feature stays in the hero as top priority */
const FEATURE_HERO_DAYS = 7;

/** How many days before an event to consider it "upcoming" for hero */
const UPCOMING_EVENT_DAYS = 7;

/** Category color mapping for league events */
const EVENT_CATEGORY_COLORS: Record<string, string> = {
  'preseason': 'var(--cat-preseason, #60a5fa)',
  'free-agency': 'var(--cat-free-agency, #2e8743)',
  'draft': 'var(--cat-draft, #7c3aed)',
  'regular-season': 'var(--cat-regular-season, #1c497c)',
};

/** Convert a WhatsNewEntry to HeroContent */
function featureToHero(entry: WhatsNewEntry): HeroContent {
  return {
    source: 'feature',
    title: entry.title,
    summary: entry.summary,
    link: entry.link,
    linkLabel: entry.linkLabel ?? 'Check it out',
    icon: entry.icon,
    accentColor: 'var(--color-secondary, #2e8743)',
    image: entry.image,
    imageAlt: entry.imageAlt,
    kicker: WHATS_NEW_CATEGORY_LABELS[entry.category],
    kickerDate: formatKickerDate(entry.date),
  };
}

/** Convert a ResolvedLeagueEvent to HeroContent */
function eventToHero(event: ResolvedLeagueEvent): HeroContent {
  const category = event.definition.category;
  const link = event.actionLinks[0] ?? event.resultLinks[0];
  const dateDisplay = event.definition.endDate
    ? formatEventDateRange(event.startDate, event.endDate)
    : formatEventDate(event.startDate);
  const statusText = getStatusText(event.isActive, event.isPast, event.daysUntilStart);

  return {
    source: 'event',
    title: event.definition.name,
    summary: event.definition.description,
    link: link?.url,
    linkLabel: link?.label ?? 'Learn more',
    icon: event.definition.icon,
    accentColor: EVENT_CATEGORY_COLORS[category] ?? 'var(--color-primary, #1c497c)',
    heroEventId: event.definition.id,
    image: event.definition.image,
    imageAlt: event.definition.imageAlt,
    dateDisplay,
    statusText,
    isActive: event.isActive,
    isUrgent: event.isUrgent,
    isExternal: link?.external,
    kicker: event.isActive ? 'Happening Now' : event.isUrgent ? 'Coming Up' : 'League Event',
    kickerDate: dateDisplay,
  };
}

/** Total days the full Auction Hero is displayed */
const AUCTION_HERO_TOTAL_DAYS = 30;

/**
 * Get the Monday before the 3rd Thursday of March (auction hero start).
 * The hero appears at midnight on this Monday, 3 days before auction opens.
 */
function getAuctionHeroStart(year: number): Date {
  const faOpens = getNthDayOfMonth(year, 2, 4, 3); // 3rd Thursday of March
  const monday = new Date(faOpens);
  monday.setDate(monday.getDate() - 3); // Monday before Thursday
  monday.setHours(0, 0, 0, 0); // Start of day
  return monday;
}

/**
 * Check whether the reference date falls within the full Auction Hero window.
 *
 * The Auction Hero lifecycle:
 * - Starts: Monday midnight (3 days before auction opens)
 * - "Auction Opens Soon" until Thursday 7am PT
 * - "Auction Under Way" from Thursday 7am PT onward
 * - Ends: 30 days after Monday start
 * - Then: compact auction strip until 3rd Sunday of August (FA close)
 * - Then: normal hero
 */
export function isAuctionHeroPeriod(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const windowStart = getAuctionHeroStart(year);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + AUCTION_HERO_TOTAL_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  return referenceDate >= windowStart && referenceDate <= windowEnd;
}

/**
 * Check whether the compact auction strip should show.
 *
 * Shows after the 30-day full hero window ends, until the 3rd Sunday
 * of August (offseason FA close date).
 */
export function isAuctionStripPeriod(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const windowStart = getAuctionHeroStart(year);

  const heroEnd = new Date(windowStart);
  heroEnd.setDate(heroEnd.getDate() + AUCTION_HERO_TOTAL_DAYS);
  heroEnd.setHours(23, 59, 59, 999);

  const faCloses = getNthDayOfMonth(year, 7, 0, 3); // 3rd Sunday of August
  faCloses.setHours(23, 59, 59, 999);

  return referenceDate > heroEnd && referenceDate <= faCloses;
}

/**
 * Check whether the auction has actually started (Thursday 7am PT).
 * Used to vary the hero messaging (pre-auction vs under way).
 */
export function isAuctionLive(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const faOpens = getNthDayOfMonth(year, 2, 4, 3); // 3rd Thursday of March
  const auctionStart = new Date(faOpens);
  auctionStart.setHours(7, 0, 0, 0); // 7am PT
  return referenceDate >= auctionStart;
}

/** Build the auction hero content */
function getAuctionHero(live: boolean): HeroContent {
  return {
    source: 'auction',
    title: 'Free Agent Auction',
    summary: live
      ? 'The auction is under way. Place bids, track results, and build your roster.'
      : 'Auction season is almost here. Get your roster ready and plan your bids.',
    icon: 'banknote',
    accentColor: 'var(--cat-free-agency, #2e8743)',
    kicker: live ? 'Auction Under Way' : 'Auction Opens Soon',
    isActive: live,
  };
}

// ── Draft Hero ──

/** Total days the Draft Hero is displayed (fallback if draft not yet complete) */
const DRAFT_HERO_TOTAL_DAYS = 30;

/**
 * Get the Monday after the NFL Draft (draft hero start).
 * The hero appears at 9am PT on this Monday.
 */
function getDraftHeroStart(year: number): Date {
  const nflDraft = getNflDraftDate(year);
  const monday = new Date(nflDraft);
  // NFL Draft is Thursday; Monday after = +4 days
  const daysUntilMonday = (1 - nflDraft.getDay() + 7) % 7 || 7;
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(9, 0, 0, 0);
  return monday;
}

/**
 * Check whether the reference date falls within the Draft Hero window.
 *
 * The Draft Hero lifecycle:
 * - Starts: Monday 9am PT after the NFL Draft
 * - "Draft Day Is Coming" until the rookie draft starts
 * - "Draft Under Way" from the rookie draft start onward
 * - Ends: 30 days after Monday start (or when draft completes)
 * - Then: normal hero (no strip phase)
 */
export function isDraftHeroPeriod(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const windowStart = getDraftHeroStart(year);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + DRAFT_HERO_TOTAL_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  return referenceDate >= windowStart && referenceDate <= windowEnd;
}

/**
 * Check whether the rookie draft has actually started.
 * Used to vary the hero messaging (pre-draft vs under way).
 */
export function isDraftLive(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const draftStart = getRookieDraftDate(year);
  return referenceDate >= draftStart;
}

/**
 * Get the formatted rookie draft start date for display.
 */
export function getDraftStartFormatted(year: number): string {
  const draftStart = getRookieDraftDate(year);
  return draftStart.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Build the draft hero content */
function getDraftHero(live: boolean): HeroContent {
  return {
    source: 'draft',
    title: 'Rookie Draft',
    summary: live
      ? 'The rookie draft is under way. Make your picks, trade up, and build your dynasty.'
      : 'Draft day is almost here. Scout the class, check your picks, and plan your strategy.',
    icon: 'draft-podium',
    accentColor: 'var(--cat-draft, #7c3aed)',
    kicker: live ? 'Draft Under Way' : 'Draft Day Is Coming',
    isActive: live,
  };
}

/** Default fallback: show the newest What's New article (any age) */
function getDefaultHero(heroEligible: WhatsNewEntry[]): HeroContent {
  // Pick the newest hero-eligible article regardless of age
  const sorted = [...heroEligible].sort(
    (a, b) => new Date(b.date + 'T00:00:00').getTime() - new Date(a.date + 'T00:00:00').getTime(),
  );
  if (sorted.length > 0) {
    return featureToHero(sorted[0]);
  }
  // Ultimate fallback if there are zero What's New entries
  return {
    source: 'default',
    title: "What's New",
    summary: 'See all the latest features, tools, and improvements we\'ve shipped.',
    link: '/theleague/whats-new',
    linkLabel: 'View all updates',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
    kicker: "What's New",
  };
}

/** Calculate how many days ago a date string (YYYY-MM-DD) was */
function daysAgo(dateStr: string, referenceDate: Date): number {
  const entryDate = new Date(dateStr + 'T00:00:00');
  const diffMs = referenceDate.getTime() - entryDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Resolve what the hero banner should display.
 *
 * @param entries - What's New entries from whats-new.json
 * @param timeline - The WhatsNext timeline from league-event-resolver
 * @param referenceDate - Current date (defaults to now, overridable for testing)
 */
export function resolveHeroContent(
  entries: WhatsNewEntry[],
  timeline: WhatsNextTimeline,
  referenceDate?: Date,
): HeroContent {
  const now = referenceDate ?? new Date();

  // --- Priority 0a: Auction hero window ---
  if (isAuctionHeroPeriod(now)) {
    return getAuctionHero(isAuctionLive(now));
  }

  // --- Priority 0b: Draft hero window ---
  if (isDraftHeroPeriod(now)) {
    return getDraftHero(isDraftLive(now));
  }

  // Filter entries that are eligible for hero promotion
  const heroEligible = entries.filter((e) => !e.excludeFromHero);

  // --- Priority 1: New features (≤7 days old) — random pick if multiple ---
  const freshFeatures = heroEligible.filter((e) => {
    const age = daysAgo(e.date, now);
    return age >= 0 && age <= FEATURE_HERO_DAYS;
  });
  if (freshFeatures.length > 0) {
    const pick = freshFeatures[Math.floor(Math.random() * freshFeatures.length)];
    return featureToHero(pick);
  }

  // --- Priority 2: Urgent league event ---
  const urgentEvent = findUrgentEvent(timeline);
  if (urgentEvent) {
    return eventToHero(urgentEvent);
  }

  // --- Priority 3: Active league event ---
  const activeEvent = findActiveEvent(timeline);
  if (activeEvent) {
    return eventToHero(activeEvent);
  }

  // --- Priority 4: Upcoming league event (within 7 days) ---
  const upcomingEvent = findUpcomingEvent(timeline);
  if (upcomingEvent) {
    return eventToHero(upcomingEvent);
  }

  // --- Priority 5: Default fallback (newest article, any age) ---
  return getDefaultHero(heroEligible);
}

/** Find an urgent event from the timeline (isUrgent = within urgencyDays) */
function findUrgentEvent(timeline: WhatsNextTimeline): ResolvedLeagueEvent | null {
  // Check "next" first since it's the most imminent future event
  if (timeline.next?.isUrgent) return timeline.next;
  if (timeline.upcoming?.isUrgent) return timeline.upcoming;
  return null;
}

/** Find an active (currently happening) event */
function findActiveEvent(timeline: WhatsNextTimeline): ResolvedLeagueEvent | null {
  if (timeline.current?.isActive) return timeline.current;
  return null;
}

/** Find an upcoming event within UPCOMING_EVENT_DAYS */
function findUpcomingEvent(timeline: WhatsNextTimeline): ResolvedLeagueEvent | null {
  if (
    timeline.next &&
    !timeline.next.isPast &&
    !timeline.next.isActive &&
    timeline.next.daysUntilStart <= UPCOMING_EVENT_DAYS
  ) {
    return timeline.next;
  }
  return null;
}
