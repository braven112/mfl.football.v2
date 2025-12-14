/**
 * Timezone utilities for dynamic matchup previews
 * Handles timezone conversion and display formatting for multiple matchups
 */

export interface TimeZoneInfo {
  abbreviation: string;
  offset: number;
  name: string;
}

export interface GameTimeDisplay {
  localTime: string;
  timezone: string;
  formatted: string;
}

/**
 * Get user's timezone information
 */
export function getUserTimezone(): TimeZoneInfo {
  const date = new Date();
  const timeZoneShort = date.toLocaleTimeString('en-US', {
    timeZoneName: 'short'
  }).split(' ')[2] || 'PST';
  
  const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -date.getTimezoneOffset() / 60;
  
  return {
    abbreviation: timeZoneShort,
    offset,
    name: timeZoneName
  };
}

/**
 * Convert Pacific Time string to user's local timezone
 * @param ptTimeString - Time string like "10:00 AM PST" or "1:25 PM PST"
 * @param gameDate - Optional specific date for the game
 */
export function convertPTTimeToLocal(ptTimeString: string, gameDate?: Date): GameTimeDisplay {
  const userTz = getUserTimezone();
  
  // Parse time like "10:00 AM PST" or "1:25 PM PST"
  const match = ptTimeString.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) {
    return {
      localTime: ptTimeString,
      timezone: userTz.abbreviation,
      formatted: ptTimeString
    };
  }

  let [_, hours, minutes, period] = match;
  let hour24 = parseInt(hours);
  const min = parseInt(minutes);

  // Convert to 24-hour format
  if (period.toUpperCase() === 'PM' && hour24 !== 12) hour24 += 12;
  if (period.toUpperCase() === 'AM' && hour24 === 12) hour24 = 0;

  // Use provided date or next Sunday as reference
  const referenceDate = gameDate || getNextSunday();
  
  // Create PT date string (PT is UTC-8 in standard time, UTC-7 in daylight time)
  const ptOffset = isPacificDaylightTime(referenceDate) ? -7 : -8;
  const utcHour = hour24 - ptOffset;
  
  const ptDate = new Date(referenceDate);
  ptDate.setUTCHours(utcHour, min, 0, 0);

  // Format in user's timezone
  const localTimeString = ptDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return {
    localTime: localTimeString,
    timezone: userTz.abbreviation,
    formatted: `${localTimeString} ${userTz.abbreviation}`
  };
}

/**
 * Get timezone-specific copy for early games
 */
export function getEarlyGameCopy(): string {
  const userTz = getUserTimezone();
  
  // Pacific timezone shows "10 AM PT"
  if (userTz.abbreviation.includes('P')) {
    return '10 AM PT';
  }
  
  // Eastern timezone shows "1 PM ET"  
  if (userTz.abbreviation.includes('E')) {
    return '1 PM ET';
  }
  
  // For other timezones, convert 10 AM PT to local time
  const converted = convertPTTimeToLocal('10:00 AM PST');
  return converted.formatted;
}

/**
 * Get timezone-specific copy for late games
 */
export function getLateGameCopy(): string {
  const userTz = getUserTimezone();
  
  // Pacific timezone shows "1 PM PT"
  if (userTz.abbreviation.includes('P')) {
    return '1 PM PT';
  }
  
  // Eastern timezone shows "4 PM ET"
  if (userTz.abbreviation.includes('E')) {
    return '4 PM ET';
  }
  
  // For other timezones, convert 1 PM PT to local time
  const converted = convertPTTimeToLocal('1:00 PM PST');
  return converted.formatted;
}

/**
 * Update all time displays on the page to user's local timezone
 */
export function updateTimeDisplaysToLocal(): void {
  // Update individual game time displays
  document.querySelectorAll('.game-time-display').forEach((el) => {
    const ptTime = el.getAttribute('data-time-pt');
    if (ptTime) {
      const converted = convertPTTimeToLocal(ptTime);
      el.textContent = converted.formatted;
    }
  });

  // Update Sunday Ticket subtitles with timezone-specific copy
  document.querySelectorAll('[id^="sunday-ticket-subtitle"]').forEach((subtitle) => {
    const currentText = subtitle.textContent || '';
    if (currentText.includes('Top 4') || currentText.includes('Top')) {
      const match = currentText.match(/Top (\d+)/);
      const gameCount = match ? match[1] : '4';
      subtitle.textContent = `Top ${gameCount} games ranked by fantasy impact for your quad-box`;
    }
  });

  // Update time slot tabs with timezone-specific labels
  updateTimeSlotTabs();
}

/**
 * Update time slot tab labels with timezone-specific copy
 */
export function updateTimeSlotTabs(): void {
  const earlyTabLabel = document.querySelector('[data-tab="early"] .tab-label');
  const lateTabLabel = document.querySelector('[data-tab="late"] .tab-label');
  
  if (earlyTabLabel) {
    earlyTabLabel.textContent = `Early Games (${getEarlyGameCopy()})`;
  }
  
  if (lateTabLabel) {
    lateTabLabel.textContent = `Late Games (${getLateGameCopy()})`;
  }
}

/**
 * Check if Pacific Daylight Time is in effect
 */
function isPacificDaylightTime(date: Date): boolean {
  // Simple DST check - in production you'd want a more robust solution
  const month = date.getMonth();
  const day = date.getDate();
  
  // DST roughly March to November
  if (month < 2 || month > 10) return false;
  if (month > 2 && month < 10) return true;
  
  // March and November need day-specific checks
  // This is simplified - actual DST rules are more complex
  return month === 2 ? day > 7 : day < 7;
}

/**
 * Get next Sunday for game time calculations
 */
function getNextSunday(): Date {
  const today = new Date();
  const daysUntilSunday = (7 - today.getDay()) % 7;
  const nextSunday = new Date(today);
  nextSunday.setDate(today.getDate() + daysUntilSunday);
  return nextSunday;
}

/**
 * Format game time for display with calendar icon
 * @param gameTime - Date object for the game
 * @param includeIcon - Whether to include calendar icon
 */
export function formatGameTimeDisplay(gameTime: Date, includeIcon: boolean = true): string {
  const dayName = gameTime.toLocaleDateString('en-US', { weekday: 'short' });
  const timeString = gameTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  const userTz = getUserTimezone();
  const icon = includeIcon ? '🗓️ ' : '';
  
  return `${icon}${dayName} ${timeString} ${userTz.abbreviation}`;
}

/**
 * Get calendar icon for time displays (replaces clock icon)
 */
export function getCalendarIcon(): string {
  return '🗓️';
}

/**
 * Initialize timezone handling for the page
 */
export function initializeTimezoneHandling(): void {
  if (typeof window === 'undefined') return;
  
  // Update displays immediately
  updateTimeDisplaysToLocal();
  
  // Set up timezone change detection (for mobile devices that change timezone)
  if ('addEventListener' in window) {
    // Listen for timezone changes (limited browser support)
    try {
      const intl = (window as any).Intl;
      if (intl && intl.DateTimeFormat) {
        const formatter = new intl.DateTimeFormat();
        if (formatter.resolvedOptions) {
          const timeZone = formatter.resolvedOptions().timeZone;
          if (timeZone) {
            // Re-update displays if timezone changes
            setTimeout(updateTimeDisplaysToLocal, 1000);
          }
        }
      }

    } catch (e) {
      // Timezone change detection not supported
    }
  }
}