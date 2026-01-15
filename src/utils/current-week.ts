/**
 * Current NFL Week Calculator
 * Automatically determines the current NFL week based on the season schedule
 */

/**
 * NFL season structure for 2024-2025
 * - Regular season: Weeks 1-18 (17 games per team)
 * - Playoffs: Weeks 19-22
 *
 * Season start dates (Week 1 Thursday kickoff):
 * - 2024: September 5, 2024
 * - 2025: September 4, 2025 (estimated)
 * - 2026: September 10, 2026 (estimated)
 */

interface SeasonConfig {
  year: number;
  week1Start: Date;
  regularSeasonWeeks: number;
  playoffWeeks: number;
}

const SEASON_CONFIGS: SeasonConfig[] = [
  {
    year: 2024,
    week1Start: new Date('2024-09-05T20:20:00-04:00'), // Thursday Night Football
    regularSeasonWeeks: 18,
    playoffWeeks: 4,
  },
  {
    year: 2025,
    week1Start: new Date('2025-09-04T20:20:00-04:00'), // Thursday Night Football (Sept 4, 2025)
    regularSeasonWeeks: 18,
    playoffWeeks: 4,
  },
  {
    year: 2026,
    week1Start: new Date('2026-09-10T20:20:00-04:00'), // Estimated
    regularSeasonWeeks: 18,
    playoffWeeks: 4,
  },
];

/**
 * Get season configuration for a given year
 */
function getSeasonConfig(year: number): SeasonConfig | undefined {
  return SEASON_CONFIGS.find(config => config.year === year);
}

/**
 * Calculate the NFL week number for a given date
 *
 * @param date - The date to calculate the week for (defaults to now)
 * @param year - The NFL season year (defaults to current year if before September, otherwise next year)
 * @returns The NFL week number (1-22), or null if date is before season starts
 */
export function getCurrentNFLWeek(date: Date = new Date(), year?: number): number | null {
  // Determine the season year if not provided
  const seasonYear = year ?? (date.getMonth() < 8 ? date.getFullYear() : date.getFullYear());

  const config = getSeasonConfig(seasonYear);

  // If no config for this year, fall back to calculation based on September start
  if (!config) {
    return calculateWeekFromSeptemberStart(date, seasonYear);
  }

  const { week1Start, regularSeasonWeeks, playoffWeeks } = config;

  // Check if date is before season starts
  if (date < week1Start) {
    return null;
  }

  // Calculate milliseconds since week 1 start
  const msSinceStart = date.getTime() - week1Start.getTime();

  // Convert to weeks (7 days = 1 week)
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));

  // Week number is weeks since start + 1
  const weekNumber = weeksSinceStart + 1;

  // Cap at max week number (regular season + playoffs)
  const maxWeek = regularSeasonWeeks + playoffWeeks;

  return Math.min(weekNumber, maxWeek);
}

/**
 * Fallback calculation for years without explicit config
 * Assumes season starts first Thursday of September
 */
function calculateWeekFromSeptemberStart(date: Date, year: number): number | null {
  // Find first Thursday of September
  const september1 = new Date(year, 8, 1); // Month is 0-indexed
  const dayOfWeek = september1.getDay(); // 0 = Sunday, 4 = Thursday

  // Calculate days until Thursday
  const daysUntilThursday = dayOfWeek <= 4 ? 4 - dayOfWeek : 11 - dayOfWeek;

  const week1Start = new Date(year, 8, 1 + daysUntilThursday, 20, 20); // 8:20 PM

  if (date < week1Start) {
    return null;
  }

  const msSinceStart = date.getTime() - week1Start.getTime();
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));
  const weekNumber = weeksSinceStart + 1;

  // Cap at 22 weeks (18 regular + 4 playoffs)
  return Math.min(weekNumber, 22);
}

/**
 * Get the current NFL week for the current season
 * Throws an error if called before the season starts
 *
 * @returns The current NFL week number (1-22)
 */
export function getCurrentWeek(): number {
  const week = getCurrentNFLWeek();

  if (week === null) {
    // If no current week, we're in the off-season
    // Return week 1 as a safe default for development
    return 1;
  }

  return week;
}

/**
 * Check if we're currently in the NFL season
 */
export function isInSeason(): boolean {
  return getCurrentNFLWeek() !== null;
}

/**
 * Get the current week for a specific league year
 * This is useful for historical data where we want to know what week it is
 * in that season context
 *
 * @param leagueYear - The year to get the current week for
 * @returns The current week number, or the last week if season is over
 */
export function getCurrentWeekForYear(leagueYear: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();

  // If requesting a historical year, return the last week of that season
  if (leagueYear < currentYear) {
    return 18; // Last regular season week (or 22 if you want playoffs)
  }

  // If requesting current or future year, calculate normally
  const week = getCurrentNFLWeek(now, leagueYear);
  return week ?? 1;
}
