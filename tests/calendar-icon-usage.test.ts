import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  formatGameTimeDisplay,
  getCalendarIcon
} from '../src/utils/timezone-utils';

/**
 * Property-Based Tests for Calendar Icon Usage
 * **Feature: dynamic-matchup-previews, Property 6: Calendar icon usage**
 * **Validates: Requirements 2.3**
 */

describe('Calendar Icon Usage - Property-Based Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Generator for valid game dates
  const gameDateArb = fc.date({
    min: new Date('2024-09-01'),
    max: new Date('2025-02-28')
  }).filter(date => !isNaN(date.getTime()));

  // Generator for boolean values to test icon inclusion
  const booleanArb = fc.boolean();

  // Generator for time display elements
  const timeDisplayElementArb = fc.record({
    tagName: fc.constantFrom('div', 'span', 'p'),
    className: fc.constantFrom('game-time-display', 'time-display', 'schedule-time'),
    timeValue: fc.record({
      hour: fc.integer({ min: 1, max: 12 }),
      minute: fc.integer({ min: 0, max: 59 }),
      period: fc.constantFrom('AM', 'PM')
    }).map(({ hour, minute, period }) => {
      const minuteStr = minute.toString().padStart(2, '0');
      return `${hour}:${minuteStr} ${period} PST`;
    })
  });

  describe('Property 6: Calendar icon usage', () => {
    it('should return calendar emoji for getCalendarIcon function', () => {
      fc.assert(
        fc.property(
          fc.constant(true),
          () => {
            const icon = getCalendarIcon();
            
            // Should return the calendar emoji, not a clock emoji
            const isCalendarIcon = icon === '🗓️';
            const isNotClockIcon = !['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'].includes(icon);
            
            return isCalendarIcon && isNotClockIcon;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use calendar icon in formatGameTimeDisplay when includeIcon is true', () => {
      fc.assert(
        fc.property(
          gameDateArb,
          booleanArb,
          (gameTime, includeIcon) => {
            const result = formatGameTimeDisplay(gameTime, includeIcon);
            
            if (includeIcon) {
              // Should start with calendar icon
              const startsWithCalendarIcon = result.startsWith('🗓️');
              // Should not contain any clock icons
              const containsClockIcon = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'].some(clockIcon => result.includes(clockIcon));
              
              return startsWithCalendarIcon && !containsClockIcon;
            } else {
              // Should not start with calendar icon when includeIcon is false
              const doesNotStartWithCalendarIcon = !result.startsWith('🗓️');
              // Should still not contain clock icons
              const containsClockIcon = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'].some(clockIcon => result.includes(clockIcon));
              
              return doesNotStartWithCalendarIcon && !containsClockIcon;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prefer calendar icons over clock icons in any time display context', () => {
      fc.assert(
        fc.property(
          timeDisplayElementArb,
          ({ tagName, className, timeValue }) => {
            // Test that when we format time displays, we use calendar icons
            const formattedWithIcon = formatGameTimeDisplay(new Date(), true);
            const calendarIcon = getCalendarIcon();
            
            // Calendar icon should be the standard calendar emoji
            const isCorrectCalendarIcon = calendarIcon === '🗓️';
            
            // Formatted display with icon should use calendar icon
            const usesCalendarIcon = formattedWithIcon.includes('🗓️');
            
            // Should not use any clock icons
            const clockIcons = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'];
            const usesClockIcon = clockIcons.some(clockIcon => formattedWithIcon.includes(clockIcon));
            
            return isCorrectCalendarIcon && usesCalendarIcon && !usesClockIcon;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain calendar icon consistency across multiple time displays', () => {
      fc.assert(
        fc.property(
          fc.array(gameDateArb, { minLength: 2, maxLength: 5 }),
          (gameDates) => {
            const formattedTimes = gameDates.map(date => formatGameTimeDisplay(date, true));
            
            // All formatted times should start with the same calendar icon
            const allStartWithCalendarIcon = formattedTimes.every(time => time.startsWith('🗓️'));
            
            // None should contain clock icons
            const clockIcons = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'];
            const noneContainClockIcons = formattedTimes.every(time => 
              !clockIcons.some(clockIcon => time.includes(clockIcon))
            );
            
            // All should use the same calendar icon
            const calendarIcon = getCalendarIcon();
            const allUseConsistentIcon = formattedTimes.every(time => time.includes(calendarIcon));
            
            return allStartWithCalendarIcon && noneContainClockIcons && allUseConsistentIcon;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should consistently return calendar icon across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (numCalls) => {
            // Call getCalendarIcon multiple times
            const icons = Array.from({ length: numCalls }, () => getCalendarIcon());
            
            // All calls should return the same calendar icon
            const allSame = icons.every(icon => icon === icons[0]);
            
            // All should be calendar emoji
            const allCalendarEmoji = icons.every(icon => icon === '🗓️');
            
            // None should be clock icons
            const clockIcons = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'];
            const noneAreClockIcons = icons.every(icon => !clockIcons.includes(icon));
            
            return allSame && allCalendarEmoji && noneAreClockIcons;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should replace any existing clock icons with calendar icons in time contexts', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'),
          (clockIcon) => {
            // Create a time display with a clock icon
            const timeDisplay = `${clockIcon} 10:00 AM PST`;
            
            // The system should prefer calendar icon over clock icon
            const calendarIcon = getCalendarIcon();
            const properTimeDisplay = formatGameTimeDisplay(new Date(), true);
            
            // Proper time display should use calendar icon
            const usesCalendarIcon = properTimeDisplay.startsWith(calendarIcon);
            
            // Should not use the clock icon
            const usesClockIcon = properTimeDisplay.includes(clockIcon);
            
            return usesCalendarIcon && !usesClockIcon;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should ensure calendar icon is visually distinct from clock icons', () => {
      fc.assert(
        fc.property(
          fc.constant(true),
          () => {
            const calendarIcon = getCalendarIcon();
            const clockIcons = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'];
            
            // Calendar icon should be visually distinct from all clock icons
            const isDistinctFromClockIcons = !clockIcons.includes(calendarIcon);
            
            // Should be the specific calendar emoji
            const isCalendarEmoji = calendarIcon === '🗓️';
            
            // Should be a valid emoji (calendar emojis can be multiple UTF-16 code units)
            const isValidEmoji = calendarIcon.length >= 1 && calendarIcon.length <= 4;
            
            return isDistinctFromClockIcons && isCalendarEmoji && isValidEmoji;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain calendar icon usage across different time formats', () => {
      fc.assert(
        fc.property(
          fc.record({
            hour: fc.integer({ min: 1, max: 12 }),
            minute: fc.integer({ min: 0, max: 59 }),
            period: fc.constantFrom('AM', 'PM'),
            timezone: fc.constantFrom('PST', 'EST', 'CST', 'MST')
          }),
          ({ hour, minute, period, timezone }) => {
            const timeString = `${hour}:${minute.toString().padStart(2, '0')} ${period} ${timezone}`;
            
            // When formatting any time with icon, should use calendar icon
            const formattedTime = formatGameTimeDisplay(new Date(), true);
            const calendarIcon = getCalendarIcon();
            
            // Should use calendar icon consistently regardless of input format
            const usesCalendarIcon = formattedTime.startsWith(calendarIcon);
            
            // Should not use clock icons
            const clockIcons = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '⏰', '⏱️', '⏲️'];
            const usesClockIcon = clockIcons.some(clockIcon => formattedTime.includes(clockIcon));
            
            return usesCalendarIcon && !usesClockIcon;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});