/**
 * League Planner Phase Utility
 *
 * Determines which phase the League Planner should display based on the
 * current date relative to key league events. Uses the existing event
 * resolver infrastructure to compute phase boundaries.
 *
 * Phases (in chronological order within a planning cycle):
 * 1. default: Rookie Draft + 14 days → Friday before Week 11 (extensions at bottom)
 * 2. extensions-and-tags: Friday before Week 11 → Feb 14 (extensions at top)
 * 3. free-agency: Feb 15 (new season) → day before NFL Draft
 * 4. draft: NFL Draft → Rookie Draft + 14 days
 *
 * A "planning cycle" runs from one championship to the next. We identify the
 * cycle by finding the most recent championship (late Dec) and deriving all
 * subsequent dates from planningYear = championshipYear + 1.
 *
 * The extensions-and-tags phase starts at the end of NFL Week 10 (Friday
 * before Week 11) rather than championship week, because extension decisions
 * become relevant once the regular season winds down — not during playoffs.
 */

import { THE_LEAGUE_EVENTS } from '../data/theleague/league-events';
import { resolveDateForYear } from './league-event-resolver';

export type PlannerPhase = 'extensions-and-tags' | 'free-agency' | 'draft' | 'default';

export interface PlannerPhaseInfo {
  phase: PlannerPhase;
  label: string;
  /** Show both current and future draft cards */
  showDualDraftCards: boolean;
}

/**
 * Resolve a specific league event's start date for a given year.
 */
function resolveEventDate(eventId: string, year: number): Date {
  const event = THE_LEAGUE_EVENTS.find((e) => e.id === eventId);
  if (!event) throw new Error(`Unknown event: ${eventId}`);
  return resolveDateForYear(event.startDate, year, THE_LEAGUE_EVENTS);
}

/**
 * Find the most recent championship date relative to `now`.
 * Championships happen in late December. We check the current calendar
 * year first; if that championship is still in the future, use the
 * previous year's championship.
 */
function findMostRecentChampionship(now: Date): { date: Date; seasonYear: number } {
  const calendarYear = now.getFullYear();
  const thisYearChamp = resolveEventDate('league-championship', calendarYear);

  if (now.getTime() >= thisYearChamp.getTime()) {
    return { date: thisYearChamp, seasonYear: calendarYear };
  }

  const prevYearChamp = resolveEventDate('league-championship', calendarYear - 1);
  return { date: prevYearChamp, seasonYear: calendarYear - 1 };
}

/**
 * Determine the current League Planner phase based on the reference date.
 *
 * @param referenceDate - Date to evaluate (defaults to now)
 * @returns Phase info with label and flags
 */
export function getPlannerPhase(referenceDate?: Date): PlannerPhaseInfo {
  const now = referenceDate ?? new Date();

  // Find the most recent championship (anchors the planning cycle)
  const { seasonYear } = findMostRecentChampionship(now);

  // All post-championship dates use planningYear = seasonYear + 1
  // (the league year that starts the following Feb 15)
  const planningYear = seasonYear + 1;

  // Resolve boundaries for the current planning cycle
  const fridayBeforeW11 = resolveEventDate('trading-deadline', seasonYear);
  const lastDayRelease = resolveEventDate('last-day-release', planningYear);
  const newSeasonStarts = resolveEventDate('new-season-starts', planningYear);
  const nflDraft = resolveEventDate('nfl-draft', planningYear);
  const rookieDraft = resolveEventDate('rookie-draft', planningYear);
  const rookieDraftPlus14 = new Date(rookieDraft);
  rookieDraftPlus14.setDate(rookieDraftPlus14.getDate() + 14);

  const ts = now.getTime();

  // Extensions & Tags: Friday before Week 11 → Feb 14 8:45 PM
  // (extensions surface once the regular season winds down)
  if (ts >= fridayBeforeW11.getTime() && ts < lastDayRelease.getTime()) {
    return {
      phase: 'extensions-and-tags',
      label: 'Extensions & Tags',
      showDualDraftCards: false,
    };
  }

  // Free Agency: Feb 15 → day before NFL Draft
  if (ts >= newSeasonStarts.getTime() && ts < nflDraft.getTime()) {
    return {
      phase: 'free-agency',
      label: 'Free Agency',
      showDualDraftCards: true,
    };
  }

  // Draft: NFL Draft start → Rookie Draft + 14 days
  if (ts >= nflDraft.getTime() && ts < rookieDraftPlus14.getTime()) {
    return {
      phase: 'draft',
      label: 'Draft',
      showDualDraftCards: true,
    };
  }

  // Check if we've entered extensions-and-tags for the NEXT planning cycle.
  // This handles dates after rookieDraftPlus14 but in a new NFL season
  // where Friday before Week 11 has passed (e.g., November of the same year).
  const nextSeasonYear = seasonYear + 1;
  const nextFridayBeforeW11 = resolveEventDate('trading-deadline', nextSeasonYear);
  const nextPlanningYear = nextSeasonYear + 1;
  const nextLastDayRelease = resolveEventDate('last-day-release', nextPlanningYear);

  if (ts >= nextFridayBeforeW11.getTime() && ts < nextLastDayRelease.getTime()) {
    return {
      phase: 'extensions-and-tags',
      label: 'Extensions & Tags',
      showDualDraftCards: false,
    };
  }

  // Default: everything else (post-draft through regular season before Week 11)
  return {
    phase: 'default',
    label: 'Overview',
    showDualDraftCards: false,
  };
}
