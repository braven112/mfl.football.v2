/**
 * Hero Resolver - Automated Homepage Marketing Engine
 *
 * Determines what content to display in the hero banner on the homepage.
 * Walks a priority table top-to-bottom and returns the first match.
 *
 * Priority (highest to lowest):
 * 1. New feature announcement (≤7 days old, random pick if multiple)
 * 2. Urgent league event (within urgencyDays)
 * 3. Active league event (happening now)
 * 4. Upcoming league event (within 7 days)
 * 5. Default fallback: "What's New" page promo
 */

import type { WhatsNewEntry, HeroContent } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import { formatEventDate, formatEventDateRange, getStatusText } from './event-date-formatter';

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
    dateDisplay,
    statusText,
    isActive: event.isActive,
    isUrgent: event.isUrgent,
    isExternal: link?.external,
  };
}

/** The default fallback hero content */
function getDefaultHero(): HeroContent {
  return {
    source: 'default',
    title: "What's New",
    summary: 'See all the latest features, tools, and improvements we\'ve shipped.',
    link: '/theleague/whats-new',
    linkLabel: 'View all updates',
    icon: 'star',
    accentColor: 'var(--color-primary, #1c497c)',
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

  // --- Priority 5: Default fallback ---
  return getDefaultHero();
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
