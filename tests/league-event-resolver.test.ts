import { describe, it, expect } from 'vitest';
import {
  resolveDateForYear,
  resolveAllEvents,
  selectWhatsNextTimeline,
  getNthDayOfMonth,
} from '../src/utils/league-event-resolver';
import { THE_LEAGUE_EVENTS } from '../src/data/theleague/league-events';
import type { LinkTemplateVars } from '../src/types/league-events';

const TEST_LINK_VARS: LinkTemplateVars = {
  mflHost: 'www49.myfantasyleague.com',
  year: '2026',
  prevYear: '2025',
  leagueId: '13522',
};

describe('getNthDayOfMonth', () => {
  it('should find the 3rd Thursday of March 2026', () => {
    const date = getNthDayOfMonth(2026, 2, 4, 3); // March, Thursday, 3rd
    expect(date.getMonth()).toBe(2); // March
    expect(date.getDay()).toBe(4); // Thursday
    expect(date.getDate()).toBe(19); // March 19, 2026
  });

  it('should find the 3rd Sunday of August 2026', () => {
    const date = getNthDayOfMonth(2026, 7, 0, 3); // August, Sunday, 3rd
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDay()).toBe(0); // Sunday
    expect(date.getDate()).toBe(16); // August 16, 2026
  });

  it('should find the 1st Monday of September 2026 (Labor Day)', () => {
    const date = getNthDayOfMonth(2026, 8, 1, 1); // September, Monday, 1st
    expect(date.getMonth()).toBe(8); // September
    expect(date.getDay()).toBe(1); // Monday
    expect(date.getDate()).toBe(7); // September 7, 2026
  });

  it('should find the 4th Thursday of April 2026 (NFL Draft estimate)', () => {
    const date = getNthDayOfMonth(2026, 3, 4, 4); // April, Thursday, 4th
    expect(date.getMonth()).toBe(3); // April
    expect(date.getDay()).toBe(4); // Thursday
    expect(date.getDate()).toBe(23); // April 23, 2026
  });
});

describe('resolveDateForYear', () => {
  it('should resolve fixed dates correctly', () => {
    const date = resolveDateForYear({ type: 'fixed', month: 2, day: 14, time: '20:45' }, 2026);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(1); // Feb = 1 (0-indexed)
    expect(date.getDate()).toBe(14);
    expect(date.getHours()).toBe(20);
    expect(date.getMinutes()).toBe(45);
  });

  it('should resolve fixed dates without time as midnight', () => {
    const date = resolveDateForYear({ type: 'fixed', month: 2, day: 15 }, 2026);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(1);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it('should resolve computed third-thursday-march', () => {
    const date = resolveDateForYear({ type: 'computed', rule: 'third-thursday-march' }, 2026);
    expect(date.getMonth()).toBe(2); // March
    expect(date.getDay()).toBe(4); // Thursday
  });

  it('should resolve computed third-sunday-august', () => {
    const date = resolveDateForYear({ type: 'computed', rule: 'third-sunday-august' }, 2026);
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDay()).toBe(0); // Sunday
  });

  it('should resolve computed nfl-kickoff as Thursday after Labor Day', () => {
    const date = resolveDateForYear({ type: 'computed', rule: 'nfl-kickoff' }, 2026);
    expect(date.getDay()).toBe(4); // Thursday
    expect(date.getMonth()).toBe(8); // September
    // Labor Day 2026 is Sep 7, so kickoff = Sep 10
    expect(date.getDate()).toBe(10);
  });

  it('should resolve AL draft to the Saturday a week before Labor Day weekend', () => {
    // Labor Day 2026 is Mon Sep 7. The draft is NOT on the holiday weekend —
    // it is the Saturday a full week earlier: Aug 29, 2026.
    const date = resolveDateForYear(
      { type: 'computed', rule: 'saturday-before-labor-day-weekend' },
      2026,
    );
    expect(date.getDay()).toBe(6); // Saturday
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDate()).toBe(29);
  });

  it('should resolve NL draft to the Sunday after the AL draft Saturday', () => {
    const date = resolveDateForYear(
      { type: 'computed', rule: 'sunday-before-labor-day-weekend' },
      2026,
    );
    expect(date.getDay()).toBe(0); // Sunday
    expect(date.getMonth()).toBe(7); // August
    expect(date.getDate()).toBe(30);
  });

  it('should resolve computed day-before-nfl-kickoff', () => {
    const date = resolveDateForYear({ type: 'computed', rule: 'day-before-nfl-kickoff' }, 2026);
    expect(date.getDay()).toBe(3); // Wednesday
    expect(date.getMonth()).toBe(8); // September
    expect(date.getDate()).toBe(9);
  });

  it('should resolve computed friday-before-week-11', () => {
    const date = resolveDateForYear({ type: 'computed', rule: 'friday-before-week-11' }, 2026);
    expect(date.getDay()).toBe(5); // Friday
  });

  it('should use configured NFL Draft date when available', () => {
    const date = resolveDateForYear({ type: 'configured', configKey: 'nflDraftDate' }, 2026);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3); // April
    expect(date.getDate()).toBe(23);
  });

  it('should estimate NFL Draft when year has no override', () => {
    const date = resolveDateForYear({ type: 'configured', configKey: 'nflDraftDate' }, 2030);
    expect(date.getMonth()).toBe(3); // April
    expect(date.getDay()).toBe(4); // Thursday
  });

  it('should resolve relative dates (saturday-after-next-week)', () => {
    const events = THE_LEAGUE_EVENTS;
    const date = resolveDateForYear(
      { type: 'relative', rule: 'saturday-after-next-week', relativeTo: 'nfl-draft' },
      2026,
      events,
    );
    // NFL Draft 2026 = April 23 (Thursday), full week later on Saturday = May 2
    expect(date.getDay()).toBe(6); // Saturday
    expect(date.getMonth()).toBe(4); // May
    expect(date.getDate()).toBe(2);
  });
});

describe('resolveAllEvents', () => {
  it('should resolve all TheLeague events without errors', () => {
    const ref = new Date(2026, 5, 1); // June 1, 2026
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    expect(resolved.length).toBe(THE_LEAGUE_EVENTS.length);
    resolved.forEach((event) => {
      expect(event.startDate).toBeInstanceOf(Date);
      expect(event.endDate).toBeInstanceOf(Date);
      expect(event.endDate.getTime()).toBeGreaterThanOrEqual(event.startDate.getTime());
    });
  });

  it('should sort events chronologically', () => {
    const ref = new Date(2026, 0, 1); // Jan 1, 2026
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    for (let i = 1; i < resolved.length; i++) {
      expect(resolved[i].startDate.getTime()).toBeGreaterThanOrEqual(
        resolved[i - 1].startDate.getTime(),
      );
    }
  });

  it('should mark events as past when reference date is after them', () => {
    const ref = new Date(2027, 0, 15); // Jan 15, 2027 - well after all 2026 events
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    const pastCount = resolved.filter((e) => e.isPast).length;
    expect(pastCount).toBe(THE_LEAGUE_EVENTS.length);
  });

  it('should mark tagging period as active on Feb 5', () => {
    const ref = new Date(2026, 1, 5); // Feb 5, 2026
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    const tagging = resolved.find((e) => e.definition.id === 'tagging-period');
    expect(tagging?.isActive).toBe(true);
    expect(tagging?.isPast).toBe(false);
  });

  it('should mark events as urgent within urgencyDays', () => {
    // 2 days before FA opens (3rd Thursday of March 2026 = Mar 19)
    const ref = new Date(2026, 2, 17); // Mar 17, 2026
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    const faEvent = resolved.find((e) => e.definition.id === 'offseason-fa-opens');
    expect(faEvent?.isUrgent).toBe(true);
    expect(faEvent?.daysUntilStart).toBeLessThanOrEqual(5);
  });

  it('should resolve link template variables', () => {
    const ref = new Date(2026, 1, 5); // Feb 5, 2026
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, ref, TEST_LINK_VARS);

    // Tagging period links to the forum (static URL, no template vars)
    const tagging = resolved.find((e) => e.definition.id === 'tagging-period');
    expect(tagging?.actionLinks.length).toBeGreaterThan(0);
    expect(tagging?.actionLinks[0].url).toContain('theleague.us/forum');

    // FA auction link uses template vars
    const fa = resolved.find((e) => e.definition.id === 'offseason-fa-opens');
    expect(fa?.actionLinks.length).toBeGreaterThan(0);
    expect(fa?.actionLinks[0].url).toContain('www49.myfantasyleague.com');
    expect(fa?.actionLinks[0].url).toContain('2026');
    expect(fa?.actionLinks[0].url).toContain('13522');
    expect(fa?.actionLinks[0].url).not.toContain('{');

    // Manage Roster links keep {franchiseId} for client-side resolution
    const lastDayRelease = resolved.find((e) => e.definition.id === 'last-day-release');
    expect(lastDayRelease?.actionLinks.length).toBeGreaterThan(0);
    expect(lastDayRelease?.actionLinks[0].url).toContain('/theleague/rosters');
    expect(lastDayRelease?.actionLinks[0].url).toContain('{franchiseId}');
  });
});

describe('selectWhatsNextTimeline', () => {
  function getTimeline(refDate: Date) {
    const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, 2026, refDate, TEST_LINK_VARS);
    return selectWhatsNextTimeline(resolved, refDate, 2026);
  }

  it('should show tagging period as current when date is Feb 5', () => {
    const timeline = getTimeline(new Date(2026, 1, 5));

    expect(timeline.current?.definition.id).toBe('tagging-period');
    expect(timeline.current?.isActive).toBe(true);
  });

  it('should show next and upcoming events after current', () => {
    const timeline = getTimeline(new Date(2026, 1, 5));

    expect(timeline.next).not.toBeNull();
    expect(timeline.upcoming).not.toBeNull();
    // Next events should be future
    expect(timeline.next?.isPast).toBe(false);
    expect(timeline.next?.isActive).toBe(false);
  });

  it('should fall back to most recently completed event when none is active', () => {
    // March 10 - after matching period (Mar 1-7), before FA opens (Mar 19)
    const timeline = getTimeline(new Date(2026, 2, 10));

    expect(timeline.current?.definition.id).toBe('tag-matching-period');
    expect(timeline.current?.isPast).toBe(true);
    expect(timeline.next?.definition.id).toBe('offseason-fa-opens');
  });

  it('should show correct events mid-season', () => {
    // October 15 - during regular season, after kickoff
    const timeline = getTimeline(new Date(2026, 9, 15));

    // Should have trading deadline as an upcoming event
    const ids = [
      timeline.current?.definition.id,
      timeline.next?.definition.id,
      timeline.upcoming?.definition.id,
    ];
    expect(ids).toContain('trading-deadline');
  });

  it('should handle end-of-year gracefully', () => {
    // December 31 at 11pm - after all events (deadlines default to 8:45 PM PT)
    const timeline = getTimeline(new Date(2026, 11, 31, 23, 0));

    expect(timeline.current).not.toBeNull();
    expect(timeline.current?.isPast).toBe(true);
    expect(timeline.next).toBeNull();
    expect(timeline.upcoming).toBeNull();
  });

  it('should handle start-of-year (before first event)', () => {
    // January 15 - before any events
    const timeline = getTimeline(new Date(2026, 0, 15));

    // tagging-period starts at midnight Feb 1 (earlier than team-purchase-deadline at 8:45 PM)
    expect(timeline.next?.definition.id).toBe('tagging-period');
    expect(timeline.current).toBeNull();
  });

  it('should always include referenceDate and leagueYear', () => {
    const ref = new Date(2026, 5, 1);
    const timeline = getTimeline(ref);

    expect(timeline.referenceDate).toEqual(ref);
    expect(timeline.leagueYear).toBe(2026);
  });
});
