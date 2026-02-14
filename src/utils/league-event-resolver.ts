/**
 * League Event Resolver
 *
 * Resolves league event definitions into concrete dates for a given league year,
 * then selects the "What's Next" timeline (current, next, upcoming).
 */

import type {
  DateResolution,
  LeagueEventDefinition,
  ResolvedLeagueEvent,
  WhatsNextTimeline,
  EventLink,
  LinkTemplateVars,
} from '../types/league-events';
import { THE_LEAGUE_EVENTS } from '../data/theleague/league-events';
import { LEAGUE_YEAR_OVERRIDES } from '../data/theleague/league-year-config';
import { getCurrentLeagueYear, getLaborDayForYear } from './league-year';

/**
 * Get the Nth occurrence of a day-of-week in a given month.
 * @param year - Calendar year
 * @param month - 0-indexed month (0=Jan, 2=Mar, 7=Aug)
 * @param dayOfWeek - 0=Sun, 1=Mon, ..., 6=Sat
 * @param nth - Which occurrence (1=first, 2=second, 3=third, 4=fourth)
 */
export function getNthDayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  nth: number,
): Date {
  const first = new Date(year, month, 1);
  const firstDow = first.getDay();
  let diff = dayOfWeek - firstDow;
  if (diff < 0) diff += 7;
  const targetDate = 1 + diff + (nth - 1) * 7;
  return new Date(year, month, targetDate);
}

/**
 * Resolve a computed date rule to a concrete Date.
 */
function resolveComputedDate(rule: string, year: number): Date {
  switch (rule) {
    case 'labor-day':
      return getLaborDayForYear(year);

    case 'third-thursday-march':
      return getNthDayOfMonth(year, 2, 4, 3); // March, Thursday, 3rd

    case 'third-sunday-august':
      return getNthDayOfMonth(year, 7, 0, 3); // August, Sunday, 3rd

    case 'nfl-kickoff': {
      // NFL kickoff is the Thursday after Labor Day
      const laborDay = getLaborDayForYear(year);
      const kickoff = new Date(laborDay);
      kickoff.setDate(kickoff.getDate() + 3);
      return kickoff;
    }

    case 'day-before-nfl-kickoff': {
      const laborDay = getLaborDayForYear(year);
      const dayBefore = new Date(laborDay);
      dayBefore.setDate(dayBefore.getDate() + 2); // Wednesday before Thursday kickoff
      return dayBefore;
    }

    case 'friday-before-week-11': {
      // Week 1 starts the Thursday after Labor Day
      // Week 11 is 10 weeks later; the Friday before is 10*7 - 6 days after kickoff
      const laborDay = getLaborDayForYear(year);
      const kickoff = new Date(laborDay);
      kickoff.setDate(kickoff.getDate() + 3); // Thursday kickoff
      const friday = new Date(kickoff);
      friday.setDate(friday.getDate() + 10 * 7 - 6); // Friday of Week 11
      return friday;
    }

    case 'after-week-16': {
      // Week 16 ends on Monday, ~15 weeks after kickoff
      const laborDay = getLaborDayForYear(year);
      const kickoff = new Date(laborDay);
      kickoff.setDate(kickoff.getDate() + 3); // Thursday kickoff
      const week16End = new Date(kickoff);
      week16End.setDate(week16End.getDate() + 15 * 7 + 4); // Tuesday after Week 16 Monday
      return week16End;
    }

    default:
      return new Date(year, 0, 1);
  }
}

/**
 * Estimate a configured date when no override exists.
 */
function estimateConfiguredDate(configKey: string, year: number): Date {
  if (configKey === 'nflDraftDate') {
    // NFL Draft is typically the last Thursday of April
    return getNthDayOfMonth(year, 3, 4, 4); // 4th Thursday of April
  }
  return new Date(year, 0, 1);
}

/**
 * Apply a relative date rule offset from a base date.
 */
function applyRelativeRule(rule: string, baseDate: Date): Date {
  const result = new Date(baseDate);
  if (rule === '1-week-after') {
    result.setDate(result.getDate() + 7);
  } else if (rule === 'saturday-after-next-week') {
    // Full week after, then Saturday (e.g., Thursday + 9 days = Saturday)
    const dayOfWeek = result.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysUntilNextSaturday = (6 - dayOfWeek + 7) % 7 + 7;
    result.setDate(result.getDate() + daysUntilNextSaturday);
  }
  return result;
}

/**
 * Resolve a DateResolution to a concrete Date for a given league year.
 */
export function resolveDateForYear(
  resolution: DateResolution,
  leagueYear: number,
  allEvents?: LeagueEventDefinition[],
): Date {
  switch (resolution.type) {
    case 'fixed': {
      const date = new Date(leagueYear, resolution.month - 1, resolution.day);
      if (resolution.time) {
        const [hours, minutes] = resolution.time.split(':').map(Number);
        date.setHours(hours, minutes, 0, 0);
      }
      return date;
    }

    case 'computed':
      return resolveComputedDate(resolution.rule, leagueYear);

    case 'configured': {
      const overrides = LEAGUE_YEAR_OVERRIDES[leagueYear];
      const value = overrides?.[resolution.configKey as keyof typeof overrides];
      if (value) {
        // Parse as local date to avoid UTC timezone offset issues
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d);
      }
      return estimateConfiguredDate(resolution.configKey, leagueYear);
    }

    case 'relative': {
      const baseEvent = allEvents?.find((e) => e.id === resolution.relativeTo);
      if (baseEvent) {
        const baseDate = resolveDateForYear(baseEvent.startDate, leagueYear, allEvents);
        return applyRelativeRule(resolution.rule, baseDate);
      }
      return new Date(leagueYear, 4, 1); // fallback to May 1
    }
  }
}

/**
 * Replace template variables in event link URLs.
 */
function resolveLinks(links: EventLink[] | undefined, vars: LinkTemplateVars): EventLink[] {
  if (!links?.length) return [];
  return links.map((link) => ({
    ...link,
    url: link.url
      .replace(/\{mflHost\}/g, vars.mflHost)
      .replace(/\{prevYear\}/g, vars.prevYear)
      .replace(/\{year\}/g, vars.year)
      .replace(/\{leagueId\}/g, vars.leagueId),
  }));
}

/**
 * Resolve all event definitions into concrete events for a given league year.
 */
export function resolveAllEvents(
  events: LeagueEventDefinition[],
  leagueYear: number,
  referenceDate: Date,
  linkVars: LinkTemplateVars,
): ResolvedLeagueEvent[] {
  return events
    .map((def) => {
      const startDate = resolveDateForYear(def.startDate, leagueYear, events);
      const endDate = def.endDate
        ? resolveDateForYear(def.endDate, leagueYear, events)
        : startDate;

      const now = referenceDate.getTime();
      const startMs = startDate.getTime();
      const endMs = endDate.getTime();

      const isActive = now >= startMs && now <= endMs;
      const isPast = now > endMs;
      const daysUntilStart = Math.ceil((startMs - now) / (1000 * 60 * 60 * 24));
      const isUrgent =
        !isPast &&
        !isActive &&
        def.urgencyDays != null &&
        daysUntilStart <= def.urgencyDays &&
        daysUntilStart > 0;

      return {
        definition: def,
        startDate,
        endDate,
        isActive,
        isPast,
        isUrgent,
        daysUntilStart,
        actionLinks: resolveLinks(def.actionLinks, linkVars),
        resultLinks: resolveLinks(def.resultLinks, linkVars),
      };
    })
    .sort((a, b) => {
      const timeDiff = a.startDate.getTime() - b.startDate.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.definition.sortOrder - b.definition.sortOrder;
    });
}

/**
 * Select the 3 events for the "What's Next" timeline:
 * - current: the active event, or the most recently completed event
 * - next: the first future event
 * - upcoming: the second future event
 */
export function selectWhatsNextTimeline(
  resolvedEvents: ResolvedLeagueEvent[],
  referenceDate: Date,
  leagueYear: number,
): WhatsNextTimeline {
  const activeEvent = resolvedEvents.find((e) => e.isActive) || null;
  const futureEvents = resolvedEvents.filter((e) => !e.isPast && !e.isActive);
  const pastEvents = resolvedEvents.filter((e) => e.isPast);

  let current: ResolvedLeagueEvent | null = activeEvent;
  if (!current && pastEvents.length > 0) {
    current = pastEvents[pastEvents.length - 1];
  }

  const next: ResolvedLeagueEvent | null = futureEvents[0] || null;
  const upcoming: ResolvedLeagueEvent | null = futureEvents[1] || null;

  return { current, next, upcoming, referenceDate, leagueYear };
}

/**
 * Main entry point: get the "What's Next" timeline for TheLeague.
 *
 * Resolves events for both the current and next league year so that
 * the transition period (e.g., Feb 14 before the 8:45 PM cutoff) still
 * shows upcoming events from the new year.
 */
export function getWhatsNextTimeline(
  referenceDate?: Date,
  linkVars?: LinkTemplateVars,
): WhatsNextTimeline {
  const now = referenceDate || new Date();
  const leagueYear = getCurrentLeagueYear(now);
  const nextLeagueYear = leagueYear + 1;

  const makeVars = (year: number): LinkTemplateVars =>
    linkVars || {
      mflHost: 'www49.myfantasyleague.com',
      year: year.toString(),
      prevYear: (year - 1).toString(),
      leagueId: '13522',
    };

  // Resolve both current and next league year events
  const currentYearEvents = resolveAllEvents(THE_LEAGUE_EVENTS, leagueYear, now, makeVars(leagueYear));
  const nextYearEvents = resolveAllEvents(THE_LEAGUE_EVENTS, nextLeagueYear, now, makeVars(nextLeagueYear));

  // Deduplicate: if an event ID exists in both years with the same start date,
  // keep only the current year's version (it has the correct MFL year in links).
  // For next-year events with different dates, include them (they represent the
  // next cycle — e.g., next year's tagging period, FA, etc.).
  const currentYearIds = new Set(
    currentYearEvents.map((e) => `${e.definition.id}:${e.startDate.getTime()}`),
  );
  const dedupedNextYear = nextYearEvents.filter(
    (e) => !currentYearIds.has(`${e.definition.id}:${e.startDate.getTime()}`),
  );

  // Merge and re-sort by start date, then sortOrder
  const allResolved = [...currentYearEvents, ...dedupedNextYear].sort((a, b) => {
    const timeDiff = a.startDate.getTime() - b.startDate.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.definition.sortOrder - b.definition.sortOrder;
  });

  return selectWhatsNextTimeline(allResolved, now, leagueYear);
}
