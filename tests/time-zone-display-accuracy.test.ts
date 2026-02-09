import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  convertPTTimeToLocal,
  getEarlyGameCopy,
  getLateGameCopy,
  formatGameTimeDisplay,
  getUserTimezone,
  getCalendarIcon
} from '../src/utils/timezone-utils';

/**
 * Property-Based Tests for Time Zone Display Accuracy
 * **Feature: dynamic-matchup-previews, Property 5: Time zone display accuracy**
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */

describe('Time Zone Display Accuracy - Property-Based Tests', () => {
  let originalDateTimeFormat: any;
  let originalToLocaleTimeString: any;
  let originalGetTimezoneOffset: any;

  beforeEach(() => {
    // Store original implementations
    originalDateTimeFormat = Intl.DateTimeFormat;
    originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  });

  afterEach(() => {
    // Restore original implementations
    global.Intl.DateTimeFormat = originalDateTimeFormat;
    Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
    vi.restoreAllMocks();
  });

  // Generator for valid Pacific Time strings
  const pacificTimeArb = fc.record({
    hour: fc.integer({ min: 1, max: 12 }),
    minute: fc.integer({ min: 0, max: 59 }),
    period: fc.constantFrom('AM', 'PM')
  }).map(({ hour, minute, period }) => {
    const minuteStr = minute.toString().padStart(2, '0');
    return `${hour}:${minuteStr} ${period} PST`;
  });

  // Generator for timezone abbreviations
  const timezoneAbbrevArb = fc.constantFrom(
    'PST', 'PDT', 'EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT',
    'AKST', 'AKDT', 'HST', 'UTC'
  );

  // Generator for timezone offsets (in hours from UTC)
  const timezoneOffsetArb = fc.integer({ min: -12, max: 14 });

  // Generator for game dates (Sundays in football season)
  const gameDateArb = fc.date({
    min: new Date('2024-09-01'),
    max: new Date('2025-02-28')
  }).filter(date => !isNaN(date.getTime())).map(date => {
    // Adjust to next Sunday
    const dayOfWeek = date.getDay();
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const sunday = new Date(date);
    sunday.setDate(date.getDate() + daysToSunday);
    return sunday;
  });

  // Mock timezone helper
  function mockTimezone(abbreviation: string, offset: number, name: string = 'America/Los_Angeles') {
    // Mock Intl.DateTimeFormat
    global.Intl.DateTimeFormat = vi.fn().mockImplementation(() => ({
      resolvedOptions: () => ({ timeZone: name })
    })) as any;

    // Mock Date.prototype.toLocaleTimeString
    Date.prototype.toLocaleTimeString = vi.fn().mockImplementation(function(this: Date, locale?: string, options?: any) {
      if (options && options.timeZoneName === 'short') {
        return `12:00:00 PM ${abbreviation}`;
      }
      
      // For hour12 formatting, use the actual date but adjust for timezone
      if (options && options.hour12) {
        // Get the UTC time and adjust for the mocked timezone offset
        const utcTime = this.getTime();
        const adjustedTime = new Date(utcTime + (offset * 60 * 60 * 1000));
        
        const hour = adjustedTime.getUTCHours();
        const minute = adjustedTime.getUTCMinutes();
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        const minuteStr = minute.toString().padStart(2, '0');
        return `${displayHour}:${minuteStr} ${period}`;
      }
      
      return this.toISOString().substr(11, 8);
    });

    // Mock Date.prototype.getTimezoneOffset
    Date.prototype.getTimezoneOffset = vi.fn().mockReturnValue(-offset * 60);
  }

  describe('Property 5: Time zone display accuracy', () => {
    it('should correctly convert Pacific Time strings and return properly formatted results', () => {
      fc.assert(
        fc.property(
          pacificTimeArb,
          gameDateArb,
          (ptTimeString, gameDate) => {
            const result = convertPTTimeToLocal(ptTimeString, gameDate);

            // The result should have all required fields
            const hasRequiredFields = 
              typeof result.localTime === 'string' &&
              typeof result.timezone === 'string' &&
              typeof result.formatted === 'string';

            // The formatted string should include both time and timezone
            const formattedIncludesTimezone = result.formatted.includes(result.timezone);

            // The local time should be a valid time format
            const timeRegex = /^\d{1,2}:\d{2} (AM|PM)$/;
            const isValidTimeFormat = timeRegex.test(result.localTime);

            // The formatted string should contain the local time
            const formattedIncludesTime = result.formatted.includes(result.localTime);

            return hasRequiredFields && formattedIncludesTimezone && isValidTimeFormat && formattedIncludesTime;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should display "10 AM PT" for early games when user is in Pacific timezone', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('PST', 'PDT'),
          (pacificTz) => {
            // Mock Pacific timezone
            mockTimezone(pacificTz, pacificTz === 'PST' ? -8 : -7);

            const earlyGameCopy = getEarlyGameCopy();

            // Should show "10 AM PT" for Pacific timezone
            return earlyGameCopy === '10 AM PT';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should display "1 PM ET" for early games when user is in Eastern timezone', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('EST', 'EDT'),
          (easternTz) => {
            // Mock Eastern timezone
            mockTimezone(easternTz, easternTz === 'EST' ? -5 : -4);

            const earlyGameCopy = getEarlyGameCopy();

            // Should show "1 PM ET" for Eastern timezone
            return earlyGameCopy === '1 PM ET';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should display "1 PM PT" for late games when user is in Pacific timezone', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('PST', 'PDT'),
          (pacificTz) => {
            // Mock Pacific timezone
            mockTimezone(pacificTz, pacificTz === 'PST' ? -8 : -7);

            const lateGameCopy = getLateGameCopy();

            // Should show "1 PM PT" for Pacific timezone
            return lateGameCopy === '1 PM PT';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should display "4 PM ET" for late games when user is in Eastern timezone', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('EST', 'EDT'),
          (easternTz) => {
            // Mock Eastern timezone
            mockTimezone(easternTz, easternTz === 'EST' ? -5 : -4);

            const lateGameCopy = getLateGameCopy();

            // Should show "4 PM ET" for Eastern timezone
            return lateGameCopy === '4 PM ET';
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should convert 10 AM PT to valid local time format for any timezone', () => {
      fc.assert(
        fc.property(
          gameDateArb,
          (gameDate) => {
            const result = convertPTTimeToLocal('10:00 AM PST', gameDate);

            // The result should be a valid time string
            const timeRegex = /^\d{1,2}:\d{2} (AM|PM)$/;
            const isValidTimeFormat = timeRegex.test(result.localTime);

            // The formatted string should include the timezone
            const includesTimezone = result.formatted.includes(result.timezone);

            // The formatted string should include the local time
            const includesLocalTime = result.formatted.includes(result.localTime);

            return isValidTimeFormat && includesTimezone && includesLocalTime;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle invalid time strings gracefully', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.match(/^\d{1,2}:\d{2}\s*(AM|PM)/i)),
          timezoneAbbrevArb,
          timezoneOffsetArb,
          (invalidTimeString, userTzAbbrev, userTzOffset) => {
            // Mock the user's timezone
            mockTimezone(userTzAbbrev, userTzOffset);

            const result = convertPTTimeToLocal(invalidTimeString);

            // Should return the original string when parsing fails
            return result.localTime === invalidTimeString &&
                   result.formatted === invalidTimeString;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should format game time display with correct components', () => {
      fc.assert(
        fc.property(
          gameDateArb,
          fc.boolean(),
          (gameTime, includeIcon) => {
            const result = formatGameTimeDisplay(gameTime, includeIcon);

            // Should include day name, time, and timezone
            const includesDay = /^(🗓️ )?(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(result);
            const includesTime = /\d{1,2}:\d{2} (AM|PM)/.test(result);
            const includesTimezone = /[A-Z]{2,4}$/.test(result); // Ends with timezone abbreviation
            const hasIcon = includeIcon ? result.startsWith('🗓️') : !result.startsWith('🗓️');

            return includesDay && includesTime && includesTimezone && hasIcon;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain timezone consistency across multiple conversions', () => {
      fc.assert(
        fc.property(
          fc.array(pacificTimeArb, { minLength: 2, maxLength: 5 }),
          gameDateArb,
          (ptTimes, gameDate) => {
            const results = ptTimes.map(ptTime => convertPTTimeToLocal(ptTime, gameDate));

            // All results should use the same timezone (user's current timezone)
            const firstTimezone = results[0].timezone;
            const allSameTimezone = results.every(result => result.timezone === firstTimezone);

            // All results should have valid formatted strings
            const allValidFormatted = results.every(result => 
              result.formatted.includes(result.localTime) && 
              result.formatted.includes(result.timezone)
            );

            return allSameTimezone && allValidFormatted;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case timezones correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('HST', 'AKST', 'UTC'),
          (edgeTz) => {
            const offsetMap: Record<string, number> = {
              'HST': -10,   // Hawaii Standard Time
              'AKST': -9,   // Alaska Standard Time  
              'UTC': 0      // Coordinated Universal Time
            };

            // Mock the edge case timezone
            mockTimezone(edgeTz, offsetMap[edgeTz]);

            const earlyResult = getEarlyGameCopy();
            const lateResult = getLateGameCopy();

            // Should not be the special Pacific/Eastern cases
            const notPacificEarly = earlyResult !== '10 AM PT';
            const notEasternEarly = earlyResult !== '1 PM ET';
            const notPacificLate = lateResult !== '1 PM PT';
            const notEasternLate = lateResult !== '4 PM ET';

            // Should include the correct timezone abbreviation
            const earlyIncludesTimezone = earlyResult.includes(edgeTz);
            const lateIncludesTimezone = lateResult.includes(edgeTz);

            return notPacificEarly && notEasternEarly && 
                   notPacificLate && notEasternLate &&
                   earlyIncludesTimezone && lateIncludesTimezone;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve time relationships when converting timezones', () => {
      fc.assert(
        fc.property(
          gameDateArb,
          (gameDate) => {
            // Convert both early and late game times
            const earlyResult = convertPTTimeToLocal('10:00 AM PST', gameDate);
            const lateResult = convertPTTimeToLocal('1:00 PM PST', gameDate);

            // Parse the times to compare
            const parseTime = (timeStr: string) => {
              const match = timeStr.match(/(\d{1,2}):(\d{2}) (AM|PM)/);
              if (!match) return null;
              
              let hour = parseInt(match[1]);
              const minute = parseInt(match[2]);
              const period = match[3];
              
              if (period === 'PM' && hour !== 12) hour += 12;
              if (period === 'AM' && hour === 12) hour = 0;
              
              return hour * 60 + minute; // Convert to minutes for comparison
            };

            const earlyMinutes = parseTime(earlyResult.localTime);
            const lateMinutes = parseTime(lateResult.localTime);

            // If both times parsed successfully, late should be after early
            // (accounting for potential day boundary crossing)
            if (earlyMinutes !== null && lateMinutes !== null) {
              // 3 hours difference in PT should be preserved (allowing for day boundary)
              const expectedDiff = 3 * 60; // 3 hours in minutes
              const actualDiff = lateMinutes >= earlyMinutes ? 
                lateMinutes - earlyMinutes : 
                (24 * 60) + lateMinutes - earlyMinutes; // Account for day boundary
              
              return actualDiff === expectedDiff;
            }

            return true; // Skip if parsing failed
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use calendar icon instead of clock icon', () => {
      fc.assert(
        fc.property(
          fc.constant(true),
          () => {
            const calendarIcon = getCalendarIcon();
            
            // Should return the calendar emoji
            return calendarIcon === '🗓️';
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});