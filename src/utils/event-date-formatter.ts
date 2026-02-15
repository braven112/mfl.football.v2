/**
 * Event Date Formatter
 *
 * Formatting helpers for league event dates and countdowns.
 */

const DAY_NAMES = [
  'Sun', 'Mon', 'Tue', 'Wed',
  'Thu', 'Fri', 'Sat',
];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a date as "Thu, Mar 19" or "Thu, Mar 19, 8:45 PM PT" if time is set.
 */
export function formatEventDate(date: Date): string {
  const dayName = DAY_NAMES[date.getDay()];
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();

  const hours = date.getHours();
  const minutes = date.getMinutes();

  // If time is midnight (0:00), treat as date-only
  if (hours === 0 && minutes === 0) {
    return `${dayName}, ${month} ${day}`;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');

  return `${dayName}, ${month} ${day}, ${displayHours}:${displayMinutes} ${period} PT`;
}

/**
 * Format a date range:
 * - Same month: "Sun, Feb 1 - 14"
 * - Cross month: "Sun, Feb 15 - Mar 7"
 * - Same day: just the single date
 */
export function formatEventDateRange(start: Date, end: Date): string {
  if (start.getTime() === end.getTime()) {
    return formatEventDate(start);
  }

  const startDay = DAY_NAMES[start.getDay()];
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];

  if (start.getMonth() === end.getMonth()) {
    return `${startDay}, ${startMonth} ${start.getDate()} - ${end.getDate()}`;
  }

  return `${startDay}, ${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
}

/**
 * Format a countdown from days until an event.
 */
export function formatCountdown(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `In ${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'In 1 week';
  return `${weeks} weeks away`;
}

/**
 * Get display text for the event's timing status.
 */
export function getStatusText(isActive: boolean, isPast: boolean, daysUntilStart: number): string {
  if (isActive) return 'Happening Now';
  if (isPast) return 'Completed';
  return formatCountdown(daysUntilStart);
}
