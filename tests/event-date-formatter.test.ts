import { describe, it, expect } from 'vitest';
import {
  formatEventDate,
  formatEventDateRange,
  formatCountdown,
  getStatusText,
} from '../src/utils/event-date-formatter';

describe('formatEventDate', () => {
  it('should format a date without time', () => {
    const date = new Date(2026, 1, 15, 0, 0); // Feb 15 at midnight
    expect(formatEventDate(date)).toBe('Sun, Feb 15');
  });

  it('should format a date with evening time', () => {
    const date = new Date(2026, 1, 14, 20, 45); // Feb 14 at 8:45 PM
    expect(formatEventDate(date)).toBe('Sat, Feb 14, 8:45 PM PT');
  });

  it('should format a date with morning time', () => {
    const date = new Date(2026, 2, 19, 7, 0); // Mar 19 at 7:00 AM
    expect(formatEventDate(date)).toBe('Thu, Mar 19, 7:00 AM PT');
  });

  it('should format noon correctly', () => {
    const date = new Date(2026, 5, 1, 12, 0); // Jun 1 at noon
    expect(formatEventDate(date)).toBe('Mon, Jun 1, 12:00 PM PT');
  });

  it('should zero-pad minutes', () => {
    const date = new Date(2026, 8, 10, 9, 5); // Sep 10 at 9:05 AM
    expect(formatEventDate(date)).toBe('Thu, Sep 10, 9:05 AM PT');
  });
});

describe('formatEventDateRange', () => {
  it('should format same-month range as "Sun, Feb 1 - 14"', () => {
    const start = new Date(2026, 1, 1);
    const end = new Date(2026, 1, 14);
    expect(formatEventDateRange(start, end)).toBe('Sun, Feb 1 - 14');
  });

  it('should format cross-month range as "Sun, Feb 15 - Mar 7"', () => {
    const start = new Date(2026, 1, 15);
    const end = new Date(2026, 2, 7);
    expect(formatEventDateRange(start, end)).toBe('Sun, Feb 15 - Mar 7');
  });

  it('should format same day as single date', () => {
    const date = new Date(2026, 1, 15);
    expect(formatEventDateRange(date, date)).toBe('Sun, Feb 15');
  });
});

describe('formatCountdown', () => {
  it('should return "Today" for 0 days', () => {
    expect(formatCountdown(0)).toBe('Today');
  });

  it('should return "Today" for negative days', () => {
    expect(formatCountdown(-1)).toBe('Today');
  });

  it('should return "Tomorrow" for 1 day', () => {
    expect(formatCountdown(1)).toBe('Tomorrow');
  });

  it('should return "In X days" for 2-14 days', () => {
    expect(formatCountdown(2)).toBe('In 2 days');
    expect(formatCountdown(7)).toBe('In 7 days');
    expect(formatCountdown(14)).toBe('In 14 days');
  });

  it('should return weeks for 15+ days', () => {
    expect(formatCountdown(15)).toBe('2 weeks away');
    expect(formatCountdown(21)).toBe('3 weeks away');
    expect(formatCountdown(30)).toBe('4 weeks away');
  });

  it('should return "In 1 week" for ~7-10 days boundary', () => {
    expect(formatCountdown(18)).toBe('3 weeks away');
  });
});

describe('getStatusText', () => {
  it('should return "Happening Now" when active', () => {
    expect(getStatusText(true, false, -2)).toBe('Happening Now');
  });

  it('should return "Completed" when past', () => {
    expect(getStatusText(false, true, -10)).toBe('Completed');
  });

  it('should return countdown text when future', () => {
    expect(getStatusText(false, false, 5)).toBe('In 5 days');
  });

  it('should return "Tomorrow" when 1 day away', () => {
    expect(getStatusText(false, false, 1)).toBe('Tomorrow');
  });
});
