/**
 * League Year Management
 *
 * Manages year transitions for MFL Football v2 application with two critical dates:
 * - Feb 14th @ 8:45 PT: New MFL league created, rosters move to new year
 * - Labor Day (first Monday in September): NFL season starts, standings/playoffs update
 *
 * This creates a "dual-year window" from Feb 14 - Labor Day where:
 * - Roster management uses currentLeagueYear (new MFL league)
 * - Season results use currentSeasonYear (previous season)
 */

export interface LeagueYearConfig {
  /** Current MFL league year (for rosters, contracts, live data) - Updates Feb 14th */
  currentLeagueYear: number;

  /** Year for standings/playoffs (historical until Labor Day) - Updates Labor Day */
  currentSeasonYear: number;

  /** Year for draft predictor (always shows next year's draft) */
  nextDraftYear: number;

  /** Year for auction predictor (always shows next auction year's free agents) */
  nextAuctionYear: number;
}

/**
 * Calculate Labor Day for a given year
 * Labor Day is the first Monday in September
 *
 * @param year - The year to calculate Labor Day for
 * @returns Date object representing Labor Day at midnight
 */
function getLaborDay(year: number): Date {
  // Labor Day is the first Monday in September
  const septemberFirst = new Date(year, 8, 1); // Month 8 = September (0-indexed)
  const dayOfWeek = septemberFirst.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // If Sept 1st is Monday (1), Labor Day is Sept 1st
  // If Sept 1st is Sunday (0), Labor Day is Sept 2nd
  // Otherwise, calculate days until next Monday
  let daysUntilMonday: number;
  if (dayOfWeek === 1) {
    daysUntilMonday = 0; // Sept 1st is already Monday
  } else if (dayOfWeek === 0) {
    daysUntilMonday = 1; // Sept 1st is Sunday, Labor Day is Sept 2nd
  } else {
    daysUntilMonday = 8 - dayOfWeek; // Days until next Monday
  }

  return new Date(year, 8, 1 + daysUntilMonday, 0, 0, 0, 0);
}

/**
 * Get test date override from URL parameter (browser only)
 * Supports `?testDate=YYYY-MM-DD` for testing different date scenarios
 *
 * @returns Date object if testDate param exists, null otherwise
 */
export function getTestDateFromUrl(): Date | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const testDate = params.get('testDate');

  if (testDate) {
    const parsed = new Date(testDate);
    // Validate date
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Calculate base year automatically based on current date
 * Base year = last completed NFL season
 *
 * Logic:
 * - If today is before Labor Day: base year = previous calendar year
 * - If today is after Labor Day: base year = current calendar year
 *
 * This eliminates the need for manual updates!
 */
function calculateBaseYear(date: Date): number {
  const calendarYear = date.getFullYear();
  const laborDay = getLaborDay(calendarYear);

  // If we're before Labor Day this year, the last completed season is previous year
  // If we're after Labor Day this year, the last completed season is this year
  return date >= laborDay ? calendarYear : calendarYear - 1;
}

/**
 * Determines which MFL year to use based on current date and league calendar
 *
 * @param referenceDate - Optional date for testing (defaults to now, or URL testDate param)
 * @returns LeagueYearConfig with appropriate years for different contexts
 */
export function getLeagueYear(referenceDate?: Date): LeagueYearConfig {
  // Priority: explicit param > URL testDate param > current date
  const date = referenceDate || getTestDateFromUrl() || new Date();

  // Get base year - either from env var (for manual override) or auto-calculate
  const envBaseYear = import.meta.env.PUBLIC_BASE_YEAR || import.meta.env.PUBLIC_MFL_YEAR;
  const baseYear = envBaseYear
    ? parseInt(envBaseYear, 10)
    : calculateBaseYear(date);

  // Feb 14th @ 8:45 PT cutoff
  // PT timezone: PST (UTC-8) in winter, PDT (UTC-7) in summer
  // Feb 14th is always PST, so 8:45 PT = 16:45 UTC
  const febCutoff = new Date(date.getFullYear(), 1, 14, 16, 45, 0, 0); // Feb = month 1 (0-indexed)

  // Labor Day cutoff (first Monday in September)
  const laborDay = getLaborDay(date.getFullYear());

  let currentLeagueYear = baseYear;
  let currentSeasonYear = baseYear;

  // After Feb 14th @ 8:45 PT, league year advances (rosters move to new MFL league)
  if (date >= febCutoff) {
    currentLeagueYear = baseYear + 1;
  }

  // After Labor Day, season year advances (standings/playoffs show new season)
  if (date >= laborDay) {
    currentSeasonYear = baseYear + 1;
  }

  return {
    currentLeagueYear,
    currentSeasonYear,
    nextDraftYear: currentSeasonYear + 1, // Draft is always for next year
    nextAuctionYear: currentLeagueYear + 1, // Auction is always for next year's free agents
  };
}

/**
 * Get current league year for roster/contract management
 * Updates: Feb 14th @ 8:45 PT
 *
 * Use this for: Rosters, Contracts, Salary Cap, Trade Analysis, Matchup Previews
 *
 * @param referenceDate - Optional date for testing
 * @returns Current league year (e.g., 2026 after Feb 14, 2026)
 */
export function getCurrentLeagueYear(referenceDate?: Date): number {
  return getLeagueYear(referenceDate).currentLeagueYear;
}

/**
 * Get current season year for standings/playoffs
 * Updates: Labor Day (first Monday in September)
 *
 * Use this for: Standings, Playoffs, MVP Tracking, Season Results, Draft Order
 *
 * @param referenceDate - Optional date for testing
 * @returns Current season year (e.g., 2025 until Labor Day 2026)
 */
export function getCurrentSeasonYear(referenceDate?: Date): number {
  return getLeagueYear(referenceDate).currentSeasonYear;
}

/**
 * Get next draft year (always currentSeasonYear + 1)
 * Draft order is based on the current/most recent completed season
 *
 * Use this for: Draft Predictor pages
 *
 * @param referenceDate - Optional date for testing
 * @returns Next draft year (e.g., 2026 before Labor Day, 2027 after)
 */
export function getNextDraftYear(referenceDate?: Date): number {
  return getLeagueYear(referenceDate).nextDraftYear;
}

/**
 * Get next auction year (always currentLeagueYear + 1)
 * Auction predictions are for the upcoming auction (next Feb)
 *
 * Use this for: Auction Predictor page
 *
 * @param referenceDate - Optional date for testing
 * @returns Next auction year (e.g., 2026 before Feb 14, 2027 after)
 */
export function getNextAuctionYear(referenceDate?: Date): number {
  return getLeagueYear(referenceDate).nextAuctionYear;
}

/**
 * Get Labor Day date for a given year (exposed for testing/display purposes)
 *
 * @param year - The year to calculate Labor Day for
 * @returns Date object representing Labor Day
 */
export function getLaborDayForYear(year: number): Date {
  return getLaborDay(year);
}
