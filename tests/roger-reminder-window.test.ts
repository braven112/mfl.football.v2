import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { shouldFireReminder, calendarDaysUntil } from '../scripts/lib/roger-reminder-window.mjs';

/**
 * These tests lock in the fix for the April 2026 bug where Roger posted
 * "TODAY: NFL Draft" on Wednesday when the draft was actually Thursday.
 * If either helper regresses, the bug comes back.
 *
 * Touch definitions mirror REMINDER_TOUCHES in scripts/schefter-scan.mjs:
 *   14d → targetDays=14,  7d → targetDays=7,  2d → targetDays=2,  dayof → 0
 */

describe('shouldFireReminder — reminder window', () => {
  describe('dayof (targetDays=0)', () => {
    it('fires on the target day (daysUntil=0)', () => {
      expect(shouldFireReminder(0, 0)).toBe(true);
    });

    it('fires as a catch-up one day late (daysUntil=-1)', () => {
      expect(shouldFireReminder(0, -1)).toBe(true);
    });

    it('does NOT fire the day before (regression for the Wed-before-Thu-draft bug)', () => {
      expect(shouldFireReminder(0, 1)).toBe(false);
    });

    it('does NOT fire two days before', () => {
      expect(shouldFireReminder(0, 2)).toBe(false);
    });

    it('does NOT fire two days after', () => {
      expect(shouldFireReminder(0, -2)).toBe(false);
    });
  });

  describe('2d (targetDays=2)', () => {
    it('fires on target', () => {
      expect(shouldFireReminder(2, 2)).toBe(true);
    });

    it('allows late catch-up at daysUntil=1', () => {
      expect(shouldFireReminder(2, 1)).toBe(true);
    });

    it('does NOT fire early at daysUntil=3', () => {
      expect(shouldFireReminder(2, 3)).toBe(false);
    });
  });

  describe('7d (targetDays=7)', () => {
    it('fires on target', () => {
      expect(shouldFireReminder(7, 7)).toBe(true);
    });

    it('allows late catch-up at daysUntil=6', () => {
      expect(shouldFireReminder(7, 6)).toBe(true);
    });

    it('does NOT fire early at daysUntil=8', () => {
      expect(shouldFireReminder(7, 8)).toBe(false);
    });
  });

  describe('14d (targetDays=14)', () => {
    it('fires on target', () => {
      expect(shouldFireReminder(14, 14)).toBe(true);
    });

    it('allows late catch-up at daysUntil=13', () => {
      expect(shouldFireReminder(14, 13)).toBe(true);
    });

    it('does NOT fire early at daysUntil=15', () => {
      expect(shouldFireReminder(14, 15)).toBe(false);
    });
  });

  describe('no overlap between adjacent touches', () => {
    // Each daysUntil value can hit at most ONE touch. In particular the
    // dayof window must not overlap the 2d window.
    it('daysUntil=1 fires only 2d (catch-up), never dayof', () => {
      expect(shouldFireReminder(2, 1)).toBe(true);
      expect(shouldFireReminder(0, 1)).toBe(false);
    });

    it('daysUntil=3 fires no touch (gap between 2d and 7d)', () => {
      expect(shouldFireReminder(0, 3)).toBe(false);
      expect(shouldFireReminder(2, 3)).toBe(false);
      expect(shouldFireReminder(7, 3)).toBe(false);
    });
  });
});

describe('calendarDaysUntil — calendar-day diff', () => {
  it('morning-of returns 0 (not negative)', () => {
    const start = new Date(2026, 3, 23, 20, 0); // Apr 23 2026 8:00pm
    const now = new Date(2026, 3, 23, 8, 0);   // Apr 23 2026 8:00am
    expect(calendarDaysUntil(start, now)).toBe(0);
  });

  it('day-before-at-any-hour returns 1 (regression for the bug — Math.ceil returned 1 too, but via fractional rounding)', () => {
    const start = new Date(2026, 3, 23, 0, 0); // Apr 23 midnight
    // 1 hour before
    expect(calendarDaysUntil(start, new Date(2026, 3, 22, 23, 0))).toBe(1);
    // Midday
    expect(calendarDaysUntil(start, new Date(2026, 3, 22, 12, 0))).toBe(1);
    // Morning
    expect(calendarDaysUntil(start, new Date(2026, 3, 22, 6, 0))).toBe(1);
  });

  it('two-days-before returns 2', () => {
    const start = new Date(2026, 3, 23);
    const now = new Date(2026, 3, 21, 17, 0);
    expect(calendarDaysUntil(start, now)).toBe(2);
  });

  it('day-after returns -1', () => {
    const start = new Date(2026, 3, 23);
    const now = new Date(2026, 3, 24, 9, 0);
    expect(calendarDaysUntil(start, now)).toBe(-1);
  });

  it('spans month boundaries', () => {
    const start = new Date(2026, 4, 2); // May 2
    const now = new Date(2026, 3, 30);  // Apr 30
    expect(calendarDaysUntil(start, now)).toBe(2);
  });

  it('is independent of time-of-day on either side (Math.ceil regression)', () => {
    // Under the old Math.ceil((start - now) / msPerDay) logic, now at 8pm
    // with start at midnight the next day returned ceil(4h/24h) = 1, same
    // as now at 1am with start tomorrow midnight — OK. But with start at
    // tomorrow 8pm and now at tomorrow 1am, ceil gave 1 (24h/24h boundary).
    // Calendar diff always returns 1 for "tomorrow regardless of time".
    const start = new Date(2026, 3, 23, 20, 30); // Apr 23 8:30pm
    expect(calendarDaysUntil(start, new Date(2026, 3, 22, 0, 1))).toBe(1);
    expect(calendarDaysUntil(start, new Date(2026, 3, 22, 23, 59))).toBe(1);
  });
});
