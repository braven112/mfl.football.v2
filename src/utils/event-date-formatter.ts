/**
 * Event Date Formatter
 *
 * Formatting helpers for league event dates and countdowns.
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a date as "Feb 14" or "Feb 14, 8:45 PM PT" if time is set.
 */
export function formatEventDate(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();

  const hours = date.getHours();
  const minutes = date.getMinutes();

  // If time is midnight (0:00), treat as date-only
  if (hours === 0 && minutes === 0) {
    return `${month} ${day}`;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');

  return `${month} ${day}, ${displayHours}:${displayMinutes} ${period} PT`;
}

/**
 * Format a date range:
 * - Same month: "Feb 1 - 14"
 * - Cross month: "Feb 15 - Mar 7"
 * - Same day: just the single date
 */
export function formatEventDateRange(start: Date, end: Date): string {
  if (start.getTime() === end.getTime()) {
    return formatEventDate(start);
  }

  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];

  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${start.getDate()} - ${end.getDate()}`;
  }

  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
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
