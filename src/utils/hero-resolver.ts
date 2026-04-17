/**
 * Hero Resolver - Automated Homepage Marketing Engine
 *
 * Two resolver systems:
 *
 * 1. resolveHeroContent() — Original waterfall resolver for index.astro (backward compat)
 * 2. resolveHeroState() — New state machine for new-hp.astro with time/day awareness
 *
 * State machine priority (highest to lowest):
 * P0++  Trade Deadline Day (24h override)
 * P0    Championship / Champion Crowned / Auction / Draft / Daily Rotation / Playoffs
 * P1    Tag Window / Tagged Showcase / UDFA / Cut Watch
 * P2    Fresh feature announcement (≤7 days)
 * P3    Urgent league event
 * P4    Active league event
 * P5    Fallback (latest article / What's New)
 */

import type { WhatsNewEntry, HeroContent } from '../types/whats-new';
import { WHATS_NEW_CATEGORY_LABELS } from '../types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent } from '../types/league-events';
import type { HeroState, SeasonPhase, DailySlot, GameWindow, HeroPriority } from '../types/hero-state';
import { formatEventDate, formatEventDateRange, getStatusText } from './event-date-formatter';
import { getNthDayOfMonth, getNflDraftDate, getRookieDraftDate } from './league-event-resolver';
import { getCurrentNFLWeek } from './current-week';

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
function eventToHero(event: ResolvedLeagueEvent, referenceDate?: Date): HeroContent {
  const category = event.definition.category;
  const link = event.actionLinks[0] ?? event.resultLinks[0];
  const dateDisplay = event.definition.endDate
    ? formatEventDateRange(event.startDate, event.endDate)
    : formatEventDate(event.startDate);
  const statusText = getStatusText(event.isActive, event.isPast, event.daysUntilStart);
  const summary = buildEventSummary(event, referenceDate);

  return {
    source: 'event',
    title: event.definition.name,
    summary,
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

/**
 * Build the hero summary for an event, with special handling for the NFL Draft
 * so the copy reflects the actual calendar (three-day weekend) and surfaces how
 * many days remain until our own rookie draft.
 */
function buildEventSummary(event: ResolvedLeagueEvent, referenceDate?: Date): string {
  if (event.definition.id === 'nfl-draft' && referenceDate) {
    const nflStart = event.startDate;
    const nflEnd = new Date(nflStart);
    nflEnd.setDate(nflEnd.getDate() + 2); // NFL Draft runs Thu–Sat
    const nflRange = formatEventDateRange(nflStart, nflEnd);

    const rookieDraftDate = getRookieDraftDate(nflStart.getFullYear());
    const msPerDay = 1000 * 60 * 60 * 24;
    const refMidnight = new Date(referenceDate);
    refMidnight.setHours(0, 0, 0, 0);
    const rookieMidnight = new Date(rookieDraftDate);
    rookieMidnight.setHours(0, 0, 0, 0);
    const daysUntilRookie = Math.max(0, Math.round((rookieMidnight.getTime() - refMidnight.getTime()) / msPerDay));
    const rookieFormatted = rookieDraftDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const dayWord = daysUntilRookie === 1 ? 'day' : 'days';

    return `The NFL Draft runs ${nflRange} — prospects meet their teams before they meet dynasty. Our own 3-round rookie draft follows on ${rookieFormatted}, ${daysUntilRookie} ${dayWord} from today.`;
  }

  return event.definition.description;
}

/** Total days the full Auction Hero is displayed */
const AUCTION_HERO_TOTAL_DAYS = 13;

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
    return eventToHero(urgentEvent, now);
  }

  // --- Priority 3: Active league event ---
  const activeEvent = findActiveEvent(timeline);
  if (activeEvent) {
    return eventToHero(activeEvent, now);
  }

  // --- Priority 4: Upcoming league event (within 7 days) ---
  const upcomingEvent = findUpcomingEvent(timeline);
  if (upcomingEvent) {
    return eventToHero(upcomingEvent, now);
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

// ══════════════════════════════════════════════════════════════════════════════
// NEW STATE MACHINE — resolveHeroState()
// ══════════════════════════════════════════════════════════════════════════════

/** PT timezone for all time-of-day calculations */
const PT_TIMEZONE = 'America/Los_Angeles';

/**
 * Extract hour, minute, and day-of-week from a Date in Pacific Time.
 * Uses Intl.DateTimeFormat for reliable timezone conversion.
 */
function getPTComponents(date: Date): { hour: number; minute: number; dayOfWeek: number; month: number; day: number; year: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIMEZONE,
    hour: 'numeric', minute: 'numeric',
    weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';

  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const year = parseInt(get('year'), 10);

  // Map weekday abbreviation to number (0=Sun, 1=Mon, ..., 6=Sat)
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[get('weekday')] ?? 0;

  return { hour, minute, dayOfWeek, month, day, year };
}

/** Convert hour:minute to minutes since midnight for easy comparison */
function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

// ── Season Phase Detection Helpers ──

/** Get the NFL kickoff date (Thursday after Labor Day) for a given season year */
function getKickoffDate(year: number): Date {
  const laborDay = getNthDayOfMonth(year, 8, 1, 1); // 1st Monday of September
  const kickoff = new Date(laborDay);
  kickoff.setDate(kickoff.getDate() + 3); // Thursday = Monday + 3
  kickoff.setHours(0, 0, 0, 0);
  return kickoff;
}

/**
 * Check if the reference date is during the NFL regular season.
 * Regular season: NFL kickoff Thursday → end of Week 14 (~Dec 13).
 * NFL kickoff is the Thursday after Labor Day (1st Mon of Sep).
 */
export function isRegularSeason(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);
  const kickoff = getKickoffDate(year);

  // End of regular season (Week 14) ≈ 13 weeks after kickoff + 3 days (through Monday)
  // That's approximately the 2nd Sunday of December + 1 day (through Monday night)
  const regularSeasonEnd = new Date(kickoff);
  regularSeasonEnd.setDate(regularSeasonEnd.getDate() + (13 * 7) + 4); // 13 weeks + through Monday
  regularSeasonEnd.setHours(23, 59, 59, 999);

  // Also check: must not be trade deadline day (that overrides)
  return referenceDate >= kickoff && referenceDate <= regularSeasonEnd;
}

/**
 * Check if the reference date is during the playoff period.
 * Playoffs: Week 15 Thursday → Week 16 Monday night.
 */
export function isPlayoffPeriod(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);
  const kickoff = getKickoffDate(year);

  // Playoffs start = Week 15 Thursday = kickoff + 14 weeks
  const playoffStart = new Date(kickoff);
  playoffStart.setDate(playoffStart.getDate() + (14 * 7));
  playoffStart.setHours(0, 0, 0, 0);

  // Playoffs end = Week 16 Monday night (2 weeks of playoffs)
  const playoffEnd = new Date(playoffStart);
  playoffEnd.setDate(playoffEnd.getDate() + (2 * 7)); // Through end of Week 16 Thursday + games
  playoffEnd.setHours(23, 59, 59, 999);

  return referenceDate >= playoffStart && referenceDate <= playoffEnd;
}

/**
 * Check if the reference date is during championship week.
 * Championship: Week 17 Thursday → Monday night final.
 */
export function isChampionshipWeek(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);

  // Check current year's season championship
  if (checkChampionshipForYear(year, referenceDate)) return true;
  // Check previous year's season championship (covers early January dates
  // when the championship spans Dec→Jan across calendar years)
  if (checkChampionshipForYear(year - 1, referenceDate)) return true;
  return false;
}

/** Internal helper: check if referenceDate falls in the championship week for a given season year */
function checkChampionshipForYear(seasonYear: number, referenceDate: Date): boolean {
  const kickoff = getKickoffDate(seasonYear);

  // Championship = Week 17 Thursday = kickoff + 16 weeks
  const champStart = new Date(kickoff);
  champStart.setDate(champStart.getDate() + (16 * 7));
  champStart.setHours(0, 0, 0, 0);

  // Championship ends Monday night (+4 days from Thursday, end of day)
  const champEnd = new Date(champStart);
  champEnd.setDate(champEnd.getDate() + 4);
  champEnd.setHours(23, 59, 59, 999);

  return referenceDate >= champStart && referenceDate <= champEnd;
}

/**
 * Check if today is trade deadline day (Nov 13).
 * This is the highest priority override — beats everything for 24 hours.
 */
export function isTradeDeadlineDay(referenceDate: Date): boolean {
  const { month, day } = getPTComponents(referenceDate);
  return month === 11 && day === 13;
}

/**
 * Check if the reference date is in the champion crowned period.
 * After championship Monday night → +7 days.
 */
function isChampionCrownedPeriod(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);
  const kickoff = getKickoffDate(year);

  // Championship Monday night end
  const champStart = new Date(kickoff);
  champStart.setDate(champStart.getDate() + (16 * 7));
  const champMondayEnd = new Date(champStart);
  champMondayEnd.setDate(champMondayEnd.getDate() + 4);
  champMondayEnd.setHours(23, 59, 59, 999);

  // Champion crowned period: day after championship → +7 days
  const crownedStart = new Date(champMondayEnd);
  crownedStart.setDate(crownedStart.getDate() + 1);
  crownedStart.setHours(0, 0, 0, 0);

  const crownedEnd = new Date(crownedStart);
  crownedEnd.setDate(crownedEnd.getDate() + 7);
  crownedEnd.setHours(23, 59, 59, 999);

  // Also check previous year's championship (for early January dates)
  const prevKickoff = getKickoffDate(year - 1);
  const prevChampStart = new Date(prevKickoff);
  prevChampStart.setDate(prevChampStart.getDate() + (16 * 7));
  const prevChampMondayEnd = new Date(prevChampStart);
  prevChampMondayEnd.setDate(prevChampMondayEnd.getDate() + 4);
  prevChampMondayEnd.setHours(23, 59, 59, 999);

  const prevCrownedStart = new Date(prevChampMondayEnd);
  prevCrownedStart.setDate(prevCrownedStart.getDate() + 1);
  prevCrownedStart.setHours(0, 0, 0, 0);
  const prevCrownedEnd = new Date(prevCrownedStart);
  prevCrownedEnd.setDate(prevCrownedEnd.getDate() + 7);
  prevCrownedEnd.setHours(23, 59, 59, 999);

  return (referenceDate >= crownedStart && referenceDate <= crownedEnd)
    || (referenceDate >= prevCrownedStart && referenceDate <= prevCrownedEnd);
}

/** Check if in the tag & extension window (after champion crowned → Feb 14) */
function isTagWindow(referenceDate: Date): boolean {
  const { month, day, year } = getPTComponents(referenceDate);

  // Tag window: Jan 8 → Feb 14 (approximate, after champion crowned hero expires)
  // We use a fixed date range since champion crowned varies slightly
  const tagStart = new Date(year, 0, 8); // Jan 8
  const tagEnd = new Date(year, 1, 14, 23, 59, 59, 999); // Feb 14 end of day

  return referenceDate >= tagStart && referenceDate <= tagEnd
    && !isChampionCrownedPeriod(referenceDate); // Champion crowned takes priority
}

/** Check if in the tagged player showcase period (Feb 15 → auction start) */
function isTaggedShowcase(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);

  const showcaseStart = new Date(year, 1, 15); // Feb 15
  const auctionStart = getAuctionHeroStart(year);

  return referenceDate >= showcaseStart && referenceDate < auctionStart;
}

/** Check if in the UDFA free agent window (after draft hero → +7 days, or during draft period if draft complete) */
function isUDFAWindow(referenceDate: Date, draftComplete?: boolean): boolean {
  const year = referenceDate.getFullYear();
  const draftHeroStart = getDraftHeroStart(year);

  const draftHeroEnd = new Date(draftHeroStart);
  draftHeroEnd.setDate(draftHeroEnd.getDate() + DRAFT_HERO_TOTAL_DAYS);
  draftHeroEnd.setHours(23, 59, 59, 999);

  // If draft is complete during the draft hero period, start UDFA window early
  if (draftComplete && isDraftHeroPeriod(referenceDate)) {
    const udfaEnd = new Date(draftHeroEnd);
    udfaEnd.setDate(udfaEnd.getDate() + 7);
    udfaEnd.setHours(23, 59, 59, 999);
    return referenceDate <= udfaEnd;
  }

  const udfaEnd = new Date(draftHeroEnd);
  udfaEnd.setDate(udfaEnd.getDate() + 7);
  udfaEnd.setHours(23, 59, 59, 999);

  return referenceDate > draftHeroEnd && referenceDate <= udfaEnd;
}

/**
 * Check if the rookie draft hero window has ended (post-draft period).
 * Used by AuctionStrip to add UDFA messaging once undrafted rookies
 * enter the free agent pool. Runs from draft hero end through FA close.
 */
export function isPostDraftPeriod(referenceDate: Date): boolean {
  const year = referenceDate.getFullYear();
  const draftHeroStart = getDraftHeroStart(year);

  const draftHeroEnd = new Date(draftHeroStart);
  draftHeroEnd.setDate(draftHeroEnd.getDate() + DRAFT_HERO_TOTAL_DAYS);
  draftHeroEnd.setHours(23, 59, 59, 999);

  const faCloses = getNthDayOfMonth(year, 7, 0, 3); // 3rd Sunday of August
  faCloses.setHours(23, 59, 59, 999);

  return referenceDate > draftHeroEnd && referenceDate <= faCloses;
}

/** Check if in the cut watch period (~Jul 15 → Aug 16) */
function isCutWatch(referenceDate: Date): boolean {
  const { year } = getPTComponents(referenceDate);

  const cutStart = new Date(year, 6, 15); // Jul 15
  const faCloses = getNthDayOfMonth(year, 7, 0, 3); // 3rd Sunday of August
  faCloses.setHours(23, 59, 59, 999);

  return referenceDate >= cutStart && referenceDate <= faCloses;
}

// ── Daily Slot Routing ──

/**
 * Determine which daily hero slot to show based on day-of-week and time-of-day (PT).
 *
 * Schedule:
 * Monday:    <5:15pm → standings, 5:15pm-11pm → live-scoring (MNF), 11pm+ → live-scoring
 * Tuesday:   <2pm → recap, 2pm+ → waiver-wire
 * Wednesday: <8pm → waiver-wire, 8pm+ → article
 * Thursday:  <5:15pm → article, 5:15pm-11pm → live-scoring (TNF), 11pm+ → article
 * Friday:    All day → article
 * Saturday:  All day → game-day-preview
 * Sunday:    <10am → game-day-preview, 10am-8:30pm → live-scoring, 8:30pm+ → live-scoring
 */
export function getDailySlot(referenceDate: Date): { slot: DailySlot; gameWindow: GameWindow } {
  const { hour, minute, dayOfWeek } = getPTComponents(referenceDate);
  const mins = toMinutes(hour, minute);

  switch (dayOfWeek) {
    case 0: // Sunday
      if (mins < 600) return { slot: 'game-day-preview', gameWindow: null };          // before 10am
      if (mins < 1230) return { slot: 'live-scoring', gameWindow: 'sunday' };          // 10am-8:30pm
      return { slot: 'live-scoring', gameWindow: 'snf' };                              // 8:30pm+

    case 1: // Monday
      if (mins < 1035) return { slot: 'standings', gameWindow: null };                 // before 5:15pm
      if (mins < 1380) return { slot: 'live-scoring', gameWindow: 'mnf' };             // 5:15pm-11pm
      return { slot: 'live-scoring', gameWindow: 'mnf' };                              // 11pm+ (post-game)

    case 2: // Tuesday
      if (mins < 840) return { slot: 'recap', gameWindow: null };                      // before 2pm
      return { slot: 'waiver-wire', gameWindow: null };                                // 2pm+

    case 3: // Wednesday
      if (mins < 1200) return { slot: 'waiver-wire', gameWindow: null };               // before 8pm
      return { slot: 'article', gameWindow: null };                                    // 8pm+

    case 4: // Thursday
      if (mins < 1035) return { slot: 'article', gameWindow: null };                   // before 5:15pm
      if (mins < 1380) return { slot: 'live-scoring', gameWindow: 'tnf' };             // 5:15pm-11pm
      return { slot: 'article', gameWindow: null };                                    // 11pm+ (post-TNF)

    case 5: // Friday
      return { slot: 'article', gameWindow: null };

    case 6: // Saturday
      return { slot: 'game-day-preview', gameWindow: null };

    default:
      return { slot: 'article', gameWindow: null };
  }
}

/**
 * Determine if a game is currently live based on the game window.
 * Live = within a known game window time range.
 */
function isGameLive(referenceDate: Date): boolean {
  const { hour, minute, dayOfWeek } = getPTComponents(referenceDate);
  const mins = toMinutes(hour, minute);

  switch (dayOfWeek) {
    case 0: // Sunday: 10am-8:30pm PT
      return mins >= 600 && mins < 1230;
    case 1: // Monday: 5:15pm-11pm PT
      return mins >= 1035 && mins < 1380;
    case 4: // Thursday: 5:15pm-11pm PT
      return mins >= 1035 && mins < 1380;
    default:
      return false;
  }
}

// ── State Machine ──

/** Helper to build a HeroState with common defaults */
function buildState(
  phase: SeasonPhase,
  priority: HeroPriority,
  resolvedBy: string,
  referenceDate: Date,
  testMode: boolean,
  overrides?: Partial<HeroState>,
): HeroState {
  return {
    phase,
    priority,
    metadata: {
      gameWindow: null,
      isLive: false,
      referenceDate,
      testMode,
      resolvedBy,
    },
    ...overrides,
  };
}

/**
 * Resolve the hero state for the new homepage.
 *
 * This is the new state machine that supports time-of-day awareness,
 * day-of-week routing, and the full seasonal calendar.
 *
 * @param referenceDate - Current date (defaults to now, overridable via ?testDate)
 * @param testMode - Whether ?testDate was used
 * @param entries - Optional What's New entries for fallback resolution
 * @param timeline - Optional WhatsNext timeline for fallback resolution
 */
export function resolveHeroState(
  referenceDate?: Date,
  testMode: boolean = false,
  entries?: WhatsNewEntry[],
  timeline?: WhatsNextTimeline,
  draftComplete?: boolean,
): HeroState {
  const now = referenceDate ?? new Date();
  const week = getCurrentNFLWeek(now) ?? undefined;

  // --- P0++: Trade Deadline Day (24h override) ---
  if (isTradeDeadlineDay(now)) {
    const { year } = getPTComponents(now);
    return buildState('trade-deadline', 'P0++', 'isTradeDeadlineDay', now, testMode, {
      tradeDeadlineProps: {
        deadlineMidnightPT: `${year}-11-14T00:00:00-08:00`,
      },
      fallbackHero: {
        source: 'event',
        title: 'Trade Deadline',
        summary: 'Make your moves before midnight PT. After today, rosters are locked for trades.',
        link: '/theleague/trade-builder',
        linkLabel: 'Open Trade Builder',
        icon: 'handshake',
        accentColor: 'var(--color-error, #dc2626)',
        kicker: 'Trade Deadline — Today',
        isUrgent: true,
      },
    });
  }

  // --- P0: Championship Week ---
  if (isChampionshipWeek(now)) {
    const { slot, gameWindow } = getDailySlot(now);
    return buildState('championship', 'P0', 'isChampionshipWeek', now, testMode, {
      slot,
      metadata: {
        week,
        gameWindow,
        isLive: isGameLive(now),
        referenceDate: now,
        testMode,
        resolvedBy: 'isChampionshipWeek',
      },
    });
  }

  // --- P0: Champion Crowned ---
  if (isChampionCrownedPeriod(now)) {
    return buildState('champion-crowned', 'P0', 'isChampionCrownedPeriod', now, testMode, {
      fallbackHero: {
        source: 'event',
        title: 'League Champion',
        summary: 'The season is over. A new champion has been crowned.',
        link: '/theleague/playoffs',
        linkLabel: 'View Championship Recap',
        icon: 'trophy',
        accentColor: 'var(--color-warning, #d97706)',
        kicker: 'Champion Crowned',
        isActive: true,
      },
    });
  }

  // --- P0: Auction Hero (existing) ---
  if (isAuctionHeroPeriod(now)) {
    const live = isAuctionLive(now);
    const year = now.getFullYear();
    return buildState(
      live ? 'auction-live' : 'auction-preview',
      'P0', 'isAuctionHeroPeriod', now, testMode,
      {
        auctionProps: {
          live,
          leagueYear: year,
        },
      },
    );
  }

  // --- P0: Draft Hero (existing — skipped when draft is complete) ---
  if (isDraftHeroPeriod(now) && !draftComplete) {
    const live = isDraftLive(now);
    const year = now.getFullYear();
    return buildState(
      live ? 'draft-live' : 'draft-announced',
      'P0', 'isDraftHeroPeriod', now, testMode,
      {
        draftProps: {
          live,
          leagueYear: year,
          draftStartFormatted: getDraftStartFormatted(year),
        },
      },
    );
  }

  // --- P0: Regular Season Daily Rotation ---
  if (isRegularSeason(now) && !isTradeDeadlineDay(now)) {
    const { slot, gameWindow } = getDailySlot(now);
    return buildState('regular-season', 'P0', 'isRegularSeason', now, testMode, {
      slot,
      metadata: {
        week,
        gameWindow,
        isLive: isGameLive(now),
        referenceDate: now,
        testMode,
        resolvedBy: 'isRegularSeason',
      },
    });
  }

  // --- P0: Playoff Period ---
  if (isPlayoffPeriod(now)) {
    const { slot, gameWindow } = getDailySlot(now);
    return buildState('playoffs', 'P0', 'isPlayoffPeriod', now, testMode, {
      slot,
      metadata: {
        week,
        gameWindow,
        isLive: isGameLive(now),
        referenceDate: now,
        testMode,
        resolvedBy: 'isPlayoffPeriod',
      },
    });
  }

  // --- P1: Tag & Extension Window ---
  if (isTagWindow(now)) {
    return buildState('tag-window', 'P1', 'isTagWindow', now, testMode, {
      fallbackHero: {
        source: 'event',
        title: 'Franchise Tags & Extensions',
        summary: 'Protect your core. Tag players to retain exclusive rights. Extend contracts before they hit the open market.',
        link: '/theleague/rosters',
        linkLabel: 'Manage Your Roster',
        icon: 'tag',
        accentColor: 'var(--cat-preseason, #60a5fa)',
        kicker: 'Offseason',
        isActive: true,
      },
    });
  }

  // --- P1: Tagged Player Showcase ---
  if (isTaggedShowcase(now)) {
    return buildState('tagged-showcase', 'P1', 'isTaggedShowcase', now, testMode, {
      fallbackHero: {
        source: 'event',
        title: 'Tagged Players — Open for Offers',
        summary: 'These franchise-tagged players can be poached. Make an offer before the matching period ends.',
        link: '/theleague/rosters',
        linkLabel: 'View Roster Details',
        icon: 'target',
        accentColor: 'var(--cat-free-agency, #2e8743)',
        kicker: 'Tag Showcase',
        isActive: true,
      },
    });
  }

  // --- P1: UDFA Free Agent Window ---
  if (isUDFAWindow(now, draftComplete)) {
    return buildState('udfa-window', 'P1', 'isUDFAWindow', now, testMode, {
      fallbackHero: {
        source: 'event',
        title: 'Undrafted Free Agents Available',
        summary: 'The draft is over but the bargains aren\'t. Undrafted rookies are now free agents.',
        link: '/theleague/free-agents',
        linkLabel: 'Browse Free Agents',
        icon: 'binoculars',
        accentColor: 'var(--cat-draft, #7c3aed)',
        kicker: 'UDFA Window',
        isActive: true,
      },
    });
  }

  // --- P1: Cut Watch ---
  if (isCutWatch(now)) {
    return buildState('cut-watch', 'P1', 'isCutWatch', now, testMode, {
      fallbackHero: {
        source: 'event',
        title: 'Cut Watch — Roster Deadline',
        summary: 'Teams must cut to 22 active players. Who\'s on the bubble?',
        link: '/theleague/rosters',
        linkLabel: 'View Full Rosters',
        icon: 'scissors',
        accentColor: 'var(--color-error, #dc2626)',
        kicker: 'Cut Watch',
        isUrgent: true,
      },
    });
  }

  // --- P2-P5: Fallback through existing resolver ---
  if (entries && timeline) {
    const fallback = resolveHeroContent(entries, timeline, now);
    const priority: HeroPriority = fallback.source === 'feature' ? 'P2' :
      fallback.source === 'event' ? (fallback.isUrgent ? 'P3' : fallback.isActive ? 'P4' : 'P4') : 'P5';
    return buildState('offseason-fallback', priority, 'resolveHeroContent-fallback', now, testMode, {
      fallbackHero: fallback,
    });
  }

  // Ultimate fallback
  return buildState('offseason-fallback', 'P5', 'ultimate-fallback', now, testMode, {
    fallbackHero: {
      source: 'default',
      title: "What's New",
      summary: 'See all the latest features, tools, and improvements we\'ve shipped.',
      link: '/theleague/whats-new',
      linkLabel: 'View all updates',
      icon: 'star',
      accentColor: 'var(--color-primary, #1c497c)',
      kicker: "What's New",
    },
  });
}

/**
 * Parse a testDate string that supports both date-only and date+time formats.
 * Formats: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"
 */
export function parseTestDate(testDateParam: string | null): Date | undefined {
  if (!testDateParam) return undefined;

  // Try ISO-like format with time: "2027-09-14T14:00"
  if (testDateParam.includes('T')) {
    const parsed = new Date(testDateParam);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Date-only format: "2027-09-14" → interpret as noon PT to avoid day-boundary issues
  const dateOnly = new Date(testDateParam + 'T12:00:00');
  if (!isNaN(dateOnly.getTime())) return dateOnly;

  return undefined;
}

/**
 * Get the appropriate standings/playoffs URL based on the current season phase.
 * During playoffs and championship, links point to /theleague/playoffs instead.
 */
export function getStandingsUrl(phase: SeasonPhase): string {
  return phase === 'playoffs' || phase === 'championship'
    ? '/theleague/playoffs'
    : '/theleague/standings';
}
