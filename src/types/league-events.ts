/**
 * League Events Timeline Types
 *
 * Data model for league calendar events used by the "What's Next" timeline
 * on the homepage. Designed to be league-agnostic (extensible to AFL).
 */

/** How to compute a date: fixed calendar date, computed rule, or manually configured */
export type DateResolution =
  | { type: 'fixed'; month: number; day: number; time?: string }
  | { type: 'computed'; rule: string }
  | { type: 'configured'; configKey: string }
  | { type: 'relative'; rule: string; relativeTo: string };

/** A link associated with an event (action or result) */
export interface EventLink {
  label: string;
  /** URL with template vars: {mflHost}, {year}, {leagueId} */
  url: string;
  external?: boolean;
}

/** A single league calendar event definition (static config, no resolved dates) */
export interface LeagueEventDefinition {
  id: string;
  name: string;
  description: string;
  /** Icon ID from the SVG sprite (without "icon-" prefix) */
  icon?: string;
  category: 'preseason' | 'free-agency' | 'draft' | 'regular-season';
  startDate: DateResolution;
  endDate?: DateResolution;
  actionLinks?: EventLink[];
  resultLinks?: EventLink[];
  /** Days before the event to show urgency styling */
  urgencyDays?: number;
  /** Optional hero image filename relative to /assets/whats-new/ */
  image?: string;
  /** Alt text for the hero image */
  imageAlt?: string;
  sortOrder: number;
}

/** A resolved event with concrete Date objects for a specific league year */
export interface ResolvedLeagueEvent {
  definition: LeagueEventDefinition;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  isPast: boolean;
  isUrgent: boolean;
  daysUntilStart: number;
  actionLinks: EventLink[];
  resultLinks: EventLink[];
}

/** The 3 events displayed in the "What's Next" timeline */
export interface WhatsNextTimeline {
  current: ResolvedLeagueEvent | null;
  next: ResolvedLeagueEvent | null;
  upcoming: ResolvedLeagueEvent | null;
  referenceDate: Date;
  leagueYear: number;
}

/** Template variables for resolving link URLs */
export interface LinkTemplateVars {
  mflHost: string;
  year: string;
  /** Previous year — for events that reference the outgoing season (e.g., roster cuts before Feb 15) */
  prevYear: string;
  leagueId: string;
}

/** Event category type alias for convenience */
export type EventCategory = LeagueEventDefinition['category'];

/** Human-readable labels for event categories */
export const CATEGORY_LABELS: Record<EventCategory, string> = {
  'preseason': 'Preseason',
  'free-agency': 'Free Agency',
  'draft': 'Draft',
  'regular-season': 'Regular Season',
};

/** Category display order for the full calendar page */
export const CATEGORY_ORDER: EventCategory[] = [
  'preseason',
  'free-agency',
  'draft',
  'regular-season',
];

/** Annual overrides for dates that can't be computed */
export interface LeagueYearOverrides {
  nflDraftDate?: string; // ISO format: 'YYYY-MM-DD'
}
