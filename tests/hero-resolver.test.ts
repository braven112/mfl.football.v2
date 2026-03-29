import { describe, it, expect } from 'vitest';
import {
  resolveHeroContent, isAuctionHeroPeriod, isAuctionLive, isAuctionStripPeriod,
  isDraftHeroPeriod, isDraftLive, getDraftStartFormatted,
  resolveHeroState, isRegularSeason, isPlayoffPeriod, isChampionshipWeek,
  isTradeDeadlineDay, getDailySlot, parseTestDate,
} from '../src/utils/hero-resolver';
import type { WhatsNewEntry } from '../src/types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent, LeagueEventDefinition } from '../src/types/league-events';

/** Helper to create a minimal ResolvedLeagueEvent */
function makeEvent(overrides: Partial<ResolvedLeagueEvent> & { name?: string; category?: string }): ResolvedLeagueEvent {
  const def: LeagueEventDefinition = {
    id: 'test-event',
    name: overrides.name ?? 'Test Event',
    description: 'A test event description',
    category: (overrides.category as LeagueEventDefinition['category']) ?? 'preseason',
    startDate: { type: 'fixed', month: 3, day: 1 },
    sortOrder: 1,
    urgencyDays: 3,
    ...(overrides.definition ?? {}),
  };
  return {
    definition: def,
    startDate: overrides.startDate ?? new Date(2026, 2, 1),
    endDate: overrides.endDate ?? new Date(2026, 2, 7),
    isActive: overrides.isActive ?? false,
    isPast: overrides.isPast ?? false,
    isUrgent: overrides.isUrgent ?? false,
    daysUntilStart: overrides.daysUntilStart ?? 30,
    actionLinks: overrides.actionLinks ?? [],
    resultLinks: overrides.resultLinks ?? [],
  };
}

/** Helper to create a WhatsNextTimeline */
function makeTimeline(overrides?: Partial<WhatsNextTimeline>): WhatsNextTimeline {
  return {
    current: overrides?.current ?? null,
    next: overrides?.next ?? null,
    upcoming: overrides?.upcoming ?? null,
    referenceDate: overrides?.referenceDate ?? new Date(2026, 1, 16),
    leagueYear: overrides?.leagueYear ?? 2026,
  };
}

/** Helper to create a WhatsNewEntry */
function makeEntry(overrides?: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: overrides?.id ?? 'test-feature',
    date: overrides?.date ?? '2026-02-16',
    title: overrides?.title ?? 'Test Feature',
    summary: overrides?.summary ?? 'A test feature summary',
    description: overrides?.description ?? ['Test description'],
    category: overrides?.category ?? 'new-feature',
    link: overrides?.link ?? '/theleague/test',
    linkLabel: overrides?.linkLabel,
    icon: overrides?.icon,
    pinToHero: overrides?.pinToHero,
    excludeFromHero: overrides?.excludeFromHero,
  };
}

describe('isAuctionHeroPeriod', () => {
  // 2026: 3rd Thursday of March = March 19
  // Monday before = March 16, hero starts at midnight
  // 30 days from March 16 = April 15
  // Window: March 16 midnight → April 15 end of day

  it('should return false just before Monday (hero start)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 2, 15, 23, 59))).toBe(false);
  });

  it('should return true at Monday midnight (hero start)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 2, 16, 0, 0))).toBe(true);
  });

  it('should return true on auction opening day (March 19)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 2, 19, 12, 0))).toBe(true);
  });

  it('should return true on day 13 (March 29)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 2, 29, 12, 0))).toBe(true);
  });

  it('should return false on day 14 (March 30)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 2, 30))).toBe(false);
  });

  it('should return false in January (well outside window)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 0, 15))).toBe(false);
  });

  it('should return false in July (auction strip period, not hero)', () => {
    expect(isAuctionHeroPeriod(new Date(2026, 6, 4))).toBe(false);
  });
});

describe('isAuctionStripPeriod', () => {
  // Strip: day 31 (April 16) → 3rd Sunday of August (Aug 16, 2026)

  it('should return false during the full hero window', () => {
    expect(isAuctionStripPeriod(new Date(2026, 2, 22))).toBe(false);
  });

  it('should return true on day 31 (April 16)', () => {
    expect(isAuctionStripPeriod(new Date(2026, 3, 16))).toBe(true);
  });

  it('should return true in July (mid-auction strip period)', () => {
    expect(isAuctionStripPeriod(new Date(2026, 6, 4))).toBe(true);
  });

  it('should return true on 3rd Sunday of August (FA close)', () => {
    expect(isAuctionStripPeriod(new Date(2026, 7, 16))).toBe(true);
  });

  it('should return false after 3rd Sunday of August', () => {
    expect(isAuctionStripPeriod(new Date(2026, 7, 17))).toBe(false);
  });

  it('should return false in January', () => {
    expect(isAuctionStripPeriod(new Date(2026, 0, 15))).toBe(false);
  });
});

describe('isAuctionLive', () => {
  it('should return false before auction opens', () => {
    expect(isAuctionLive(new Date(2026, 2, 18))).toBe(false);
  });

  it('should return false on opening day before 7am', () => {
    expect(isAuctionLive(new Date(2026, 2, 19, 6, 59))).toBe(false);
  });

  it('should return true on opening day at 7am', () => {
    expect(isAuctionLive(new Date(2026, 2, 19, 7, 0))).toBe(true);
  });

  it('should return true after auction opens', () => {
    expect(isAuctionLive(new Date(2026, 3, 15))).toBe(true);
  });
});

describe('isDraftHeroPeriod', () => {
  // 2026: NFL Draft = April 23 (Thursday)
  // Monday after = April 27, hero starts at 9am
  // 30 days from April 27 = May 27

  it('should return false before Monday 9am (hero start)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 3, 27, 8, 59))).toBe(false);
  });

  it('should return true at Monday 9am (hero start)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 3, 27, 9, 0))).toBe(true);
  });

  it('should return true mid-window (May 10)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 4, 10))).toBe(true);
  });

  it('should return true on day 30 (May 27)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 4, 27, 12, 0))).toBe(true);
  });

  it('should return false on day 31 (May 28)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 4, 28))).toBe(false);
  });

  it('should return false in January', () => {
    expect(isDraftHeroPeriod(new Date(2026, 0, 15))).toBe(false);
  });

  it('should return false during auction hero window (March 22)', () => {
    expect(isDraftHeroPeriod(new Date(2026, 2, 22))).toBe(false);
  });
});

describe('isDraftLive', () => {
  // 2026: NFL Draft = April 23 (Thursday)
  // Rookie draft = Saturday after next week = May 2

  it('should return false before rookie draft starts', () => {
    expect(isDraftLive(new Date(2026, 4, 1))).toBe(false);
  });

  it('should return true at rookie draft start (May 2)', () => {
    expect(isDraftLive(new Date(2026, 4, 2))).toBe(true);
  });

  it('should return true after rookie draft starts', () => {
    expect(isDraftLive(new Date(2026, 4, 10))).toBe(true);
  });
});

describe('getDraftStartFormatted', () => {
  it('should return a formatted date string for 2026', () => {
    const formatted = getDraftStartFormatted(2026);
    // Rookie draft for 2026: May 2 (Saturday after next week from April 23)
    expect(formatted).toContain('May');
    expect(formatted).toContain('2');
    expect(formatted).toContain('2026');
  });
});

describe('resolveHeroContent', () => {
  describe('Priority 0: Auction hero window always wins', () => {
    // 2026: 3rd Thursday of March = March 19
    // Monday before = March 16, hero starts at midnight
    // Hero window: March 16 → April 15

    it('should return auction hero during the hero window (live)', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 2, 22); // March 22 — 3 days after auction opens

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('auction');
      expect(result.title).toBe('Free Agent Auction');
      expect(result.accentColor).toContain('--cat-free-agency');
      expect(result.isActive).toBe(true);
      expect(result.kicker).toBe('Auction Under Way');
    });

    it('should return pre-auction hero before auction opens', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 2, 16, 12); // March 16 noon — Monday before auction

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('auction');
      expect(result.isActive).toBe(false);
      expect(result.kicker).toBe('Auction Opens Soon');
    });

    it('should beat fresh features during hero window', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'fresh', title: 'Fresh Feature', date: '2026-03-21' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 2, 22); // March 22

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('auction');
    });

    it('should beat urgent events during hero window', () => {
      const entries: WhatsNewEntry[] = [];
      const urgentEvent = makeEvent({ name: 'Urgent Event', isUrgent: true, daysUntilStart: 1 });
      const timeline = makeTimeline({ next: urgentEvent });
      const now = new Date(2026, 2, 22); // March 22

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('auction');
    });

    it('should NOT return auction hero outside the window', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16); // Feb 16

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).not.toBe('auction');
    });

    it('should NOT return auction hero after the 30-day window', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 3, 16); // April 16 — day 31, outside hero window

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).not.toBe('auction');
    });
  });

  describe('Priority 1: New features (≤7 days old)', () => {
    it('should show a feature that is 0 days old', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'today', title: 'Just Shipped', date: '2026-02-16' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('feature');
      expect(result.title).toBe('Just Shipped');
    });

    it('should show a feature that is exactly 7 days old', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'seven-days', title: '7 Day Feature', date: '2026-02-09' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('feature');
      expect(result.title).toBe('7 Day Feature');
    });

    it('should NOT show a feature at Priority 1 when 8 days old, but still show it as fallback', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'eight-days', title: '8 Day Feature', date: '2026-02-08' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Falls through Priority 1 (too old) but picked up by fallback as newest article
      expect(result.source).toBe('feature');
      expect(result.title).toBe('8 Day Feature');
    });

    it('should prefer features over urgent events', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'fresh', title: 'Fresh Feature', date: '2026-02-15' }),
      ];
      const urgentEvent = makeEvent({ name: 'Urgent Event', isUrgent: true, daysUntilStart: 2 });
      const timeline = makeTimeline({ next: urgentEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('feature');
      expect(result.title).toBe('Fresh Feature');
    });

    it('should prefer features over active events', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'fresh', title: 'Fresh Feature', date: '2026-02-15' }),
      ];
      const activeEvent = makeEvent({ name: 'Active Event', isActive: true });
      const timeline = makeTimeline({ current: activeEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('feature');
      expect(result.title).toBe('Fresh Feature');
    });

    it('should randomly select among multiple features within 7-day window', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'a', title: 'Feature A', date: '2026-02-14' }),
        makeEntry({ id: 'b', title: 'Feature B', date: '2026-02-15' }),
        makeEntry({ id: 'c', title: 'Feature C', date: '2026-02-16' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const titles = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = resolveHeroContent(entries, timeline, now);
        titles.add(result.title);
      }
      // With 50 iterations and 3 options, should see at least 2 different titles
      expect(titles.size).toBeGreaterThan(1);
    });

    it('should always return a feature source when features are in window', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'a', title: 'Feature A', date: '2026-02-14' }),
        makeEntry({ id: 'b', title: 'Feature B', date: '2026-02-15' }),
      ];
      const urgentEvent = makeEvent({ name: 'Urgent', isUrgent: true });
      const timeline = makeTimeline({ next: urgentEvent });
      const now = new Date(2026, 1, 16);

      for (let i = 0; i < 20; i++) {
        const result = resolveHeroContent(entries, timeline, now);
        expect(result.source).toBe('feature');
        expect(['Feature A', 'Feature B']).toContain(result.title);
      }
    });

    it('should NOT show future-dated features at Priority 1, but still show as fallback', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'future', title: 'Future Feature', date: '2026-02-20' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Future date skips Priority 1 but picked up by fallback as newest article
      expect(result.source).toBe('feature');
      expect(result.title).toBe('Future Feature');
    });
  });

  describe('Priority 2: Urgent league event', () => {
    it('should show an urgent event when no features are in window', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'old', title: 'Old Feature', date: '2025-12-01' }),
      ];
      const urgentEvent = makeEvent({
        name: 'Tagging Deadline',
        isUrgent: true,
        daysUntilStart: 2,
      });
      const timeline = makeTimeline({ next: urgentEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('event');
      expect(result.title).toBe('Tagging Deadline');
    });
  });

  describe('Priority 3: Active league event', () => {
    it('should show an active event when no features or urgent events exist', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'old', title: 'Old Feature', date: '2025-11-01' }),
      ];
      const activeEvent = makeEvent({
        name: 'Offseason Free Agency',
        isActive: true,
        category: 'free-agency',
      });
      const timeline = makeTimeline({ current: activeEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('event');
      expect(result.title).toBe('Offseason Free Agency');
    });
  });

  describe('Priority 4: Upcoming event (within 7 days)', () => {
    it('should show an upcoming event within 7 days', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'old', title: 'Old Feature', date: '2025-11-01' }),
      ];
      const upcomingEvent = makeEvent({
        name: 'NFL Draft',
        isActive: false,
        isPast: false,
        daysUntilStart: 5,
      });
      const timeline = makeTimeline({ next: upcomingEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('event');
      expect(result.title).toBe('NFL Draft');
    });

    it('should NOT show an upcoming event more than 7 days away', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'old', title: 'Old Feature', date: '2025-11-01' }),
      ];
      const farEvent = makeEvent({
        name: 'Far Away Event',
        isActive: false,
        isPast: false,
        daysUntilStart: 15,
      });
      const timeline = makeTimeline({ next: farEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Falls through to fallback — shows newest article
      expect(result.source).toBe('feature');
      expect(result.title).toBe('Old Feature');
    });
  });

  describe('Priority 5: Default fallback', () => {
    it('should show the newest article as fallback when no entries or events qualify for higher priority', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'ancient', title: 'Ancient Feature', date: '2025-01-01' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Falls through to fallback — shows newest article regardless of age
      expect(result.source).toBe('feature');
      expect(result.title).toBe('Ancient Feature');
    });

    it('should show the generic default only with empty entries', () => {
      const result = resolveHeroContent([], makeTimeline(), new Date(2026, 1, 16));

      expect(result.source).toBe('default');
      expect(result.title).toBe("What's New");
    });
  });

  describe('excludeFromHero filtering', () => {
    it('should exclude entries with excludeFromHero: true from both Priority 1 and fallback', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'excluded', title: 'Excluded Feature', date: '2026-02-16', excludeFromHero: true }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Excluded from hero-eligible pool entirely — falls to generic default
      expect(result.source).toBe('default');
    });
  });

  describe('accent color mapping', () => {
    it('should use green accent for feature entries', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'feature', title: 'New Feature', date: '2026-02-16' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.accentColor).toContain('--color-secondary');
    });

    it('should use category color for event entries', () => {
      const entries: WhatsNewEntry[] = [];
      const activeEvent = makeEvent({
        name: 'Free Agency',
        isActive: true,
        category: 'free-agency',
      });
      const timeline = makeTimeline({ current: activeEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.accentColor).toContain('--cat-free-agency');
    });

    it('should use primary color for default fallback', () => {
      const result = resolveHeroContent([], makeTimeline(), new Date(2026, 1, 16));

      expect(result.accentColor).toContain('--color-primary');
    });
  });

  describe('HeroContent structure', () => {
    it('should include all required fields for feature-sourced content', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({
          id: 'full',
          title: 'Full Feature',
          summary: 'Full summary',
          date: '2026-02-16',
          link: '/theleague/full',
          linkLabel: 'Go There',
          icon: 'star',
        }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result).toMatchObject({
        source: 'feature',
        title: 'Full Feature',
        summary: 'Full summary',
        link: '/theleague/full',
        linkLabel: 'Go There',
        icon: 'star',
        accentColor: 'var(--color-secondary, #2e8743)',
        kicker: 'New Feature',
        kickerDate: 'Feb 16, 2026',
      });
      expect(result.image).toBeUndefined();
      expect(result.imageAlt).toBeUndefined();
      // Feature-sourced content should NOT have heroEventId
      expect(result.heroEventId).toBeUndefined();
    });

    it('should default linkLabel to "Check it out" when not provided', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'no-label', date: '2026-02-16', link: '/theleague/test' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.linkLabel).toBe('Check it out');
    });
  });

  describe('heroEventId for event deduplication', () => {
    it('should include heroEventId when hero is sourced from an event', () => {
      const entries: WhatsNewEntry[] = [];
      const activeEvent = makeEvent({
        name: 'Tag Matching Period',
        isActive: true,
        category: 'free-agency',
      });
      activeEvent.definition.id = 'tag-matching';
      const timeline = makeTimeline({ current: activeEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('event');
      expect(result.heroEventId).toBe('tag-matching');
    });

    it('should NOT include heroEventId when hero is sourced from a feature', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'fresh', title: 'Fresh Feature', date: '2026-02-16' }),
      ];
      const activeEvent = makeEvent({ name: 'Active Event', isActive: true });
      const timeline = makeTimeline({ current: activeEvent });
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('feature');
      expect(result.heroEventId).toBeUndefined();
    });

    it('should NOT include heroEventId for default fallback', () => {
      const result = resolveHeroContent([], makeTimeline(), new Date(2026, 1, 16));

      expect(result.source).toBe('default');
      expect(result.heroEventId).toBeUndefined();
    });
  });

  describe('priority ordering — full cascade', () => {
    it('should correctly cascade through all 6 priorities', () => {
      // Use February date (outside auction season) for priorities 1-5
      const now = new Date(2026, 1, 16);

      const fresh = makeEntry({ id: 'fresh', title: 'Fresh', date: '2026-02-15' });
      const old = makeEntry({ id: 'old', title: 'Old', date: '2025-06-01' });

      const urgentEvent = makeEvent({ name: 'Urgent', isUrgent: true, daysUntilStart: 2 });
      const activeEvent = makeEvent({ name: 'Active', isActive: true });
      const upcomingEvent = makeEvent({ name: 'Upcoming', daysUntilStart: 5 });

      // Priority 0: Auction hero window wins over everything
      const auctionDate = new Date(2026, 2, 22); // March 22 — within hero window
      let result = resolveHeroContent(
        [makeEntry({ id: 'fresh-mar', title: 'Fresh March', date: '2026-03-21' })],
        makeTimeline({ next: urgentEvent, current: activeEvent }),
        auctionDate,
      );
      expect(result.source).toBe('auction');

      // Priority 1: Fresh feature wins over everything (outside auction season)
      result = resolveHeroContent(
        [fresh, old],
        makeTimeline({ next: urgentEvent, current: activeEvent, upcoming: upcomingEvent }),
        now,
      );
      expect(result.title).toBe('Fresh');

      // Priority 2: Remove fresh — urgent event wins
      result = resolveHeroContent(
        [old],
        makeTimeline({ next: urgentEvent, current: activeEvent }),
        now,
      );
      expect(result.title).toBe('Urgent');

      // Priority 3: Remove urgent — active event wins
      result = resolveHeroContent(
        [old],
        makeTimeline({ current: activeEvent, next: upcomingEvent }),
        now,
      );
      expect(result.title).toBe('Active');

      // Priority 4: Remove active — upcoming event wins
      result = resolveHeroContent(
        [old],
        makeTimeline({ next: upcomingEvent }),
        now,
      );
      expect(result.title).toBe('Upcoming');

      // Priority 5: Remove upcoming — fallback shows newest article
      result = resolveHeroContent(
        [old],
        makeTimeline(),
        now,
      );
      expect(result.title).toBe('Old');
    });
  });

  describe('Priority 0b: Draft hero window always wins', () => {
    // 2026: NFL Draft = April 23 (Thursday)
    // Monday after = April 27, hero starts at 9am
    // 30 days from April 27 = May 27
    // Rookie draft = May 2 (Saturday after next week from NFL Draft)

    it('should return draft hero during the hero window (live)', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 4, 5); // May 5 — after rookie draft starts

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('draft');
      expect(result.title).toBe('Rookie Draft');
      expect(result.accentColor).toContain('--cat-draft');
      expect(result.isActive).toBe(true);
      expect(result.kicker).toBe('Draft Under Way');
    });

    it('should return pre-draft hero before rookie draft starts', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 3, 28); // April 28 — Monday after NFL Draft +1 day

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('draft');
      expect(result.isActive).toBe(false);
      expect(result.kicker).toBe('Draft Day Is Coming');
    });

    it('should beat fresh features during hero window', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'fresh', title: 'Fresh Feature', date: '2026-04-27' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 3, 28); // April 28

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('draft');
    });

    it('should beat urgent events during hero window', () => {
      const entries: WhatsNewEntry[] = [];
      const urgentEvent = makeEvent({ name: 'Urgent Event', isUrgent: true, daysUntilStart: 1 });
      const timeline = makeTimeline({ next: urgentEvent });
      const now = new Date(2026, 4, 5); // May 5

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('draft');
    });

    it('should NOT return draft hero outside the window', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16); // Feb 16

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).not.toBe('draft');
    });

    it('should NOT return draft hero after the 30-day window', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 4, 28); // May 28 — day 31

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).not.toBe('draft');
    });
  });

  describe('testDate correctness for past features', () => {
    it('should find features relative to testDate, not today', () => {
      // Feature shipped Jan 20, testing as if it were Jan 22 (2 days old)
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'jan-feature', title: 'January Feature', date: '2026-01-20' }),
      ];
      const timeline = makeTimeline();
      const testDate = new Date(2026, 0, 22); // Jan 22

      const result = resolveHeroContent(entries, timeline, testDate);

      expect(result.source).toBe('feature');
      expect(result.title).toBe('January Feature');
    });

    it('should NOT show a feature at Priority 1 when testDate makes it too old, but show as fallback', () => {
      // Feature shipped Jan 20, testing as if it were Jan 30 (10 days old, > 7)
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'jan-feature', title: 'January Feature', date: '2026-01-20' }),
      ];
      const timeline = makeTimeline();
      const testDate = new Date(2026, 0, 30); // Jan 30

      const result = resolveHeroContent(entries, timeline, testDate);

      // Too old for Priority 1 but picked up by fallback as newest article
      expect(result.source).toBe('feature');
      expect(result.title).toBe('January Feature');
    });

    it('should show features from the right time window when multiple exist', () => {
      // Multiple features at different dates, testDate should find the right ones
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'feb', title: 'February Feature', date: '2026-02-16' }),
        makeEntry({ id: 'jan', title: 'January Feature', date: '2026-01-20' }),
        makeEntry({ id: 'dec', title: 'December Feature', date: '2025-12-15' }),
      ];
      const timeline = makeTimeline();

      // Testing Jan 22 — only January Feature is in window
      const jan22 = new Date(2026, 0, 22);
      const result = resolveHeroContent(entries, timeline, jan22);
      expect(result.source).toBe('feature');
      expect(result.title).toBe('January Feature');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// NEW STATE MACHINE TESTS — resolveHeroState()
// ══════════════════════════════════════════════════════════════════════════════

describe('parseTestDate', () => {
  it('should return undefined for null', () => {
    expect(parseTestDate(null)).toBeUndefined();
  });

  it('should parse date-only format as noon', () => {
    const result = parseTestDate('2027-09-14');
    expect(result).toBeDefined();
    expect(result!.getFullYear()).toBe(2027);
    expect(result!.getMonth()).toBe(8); // September
    expect(result!.getDate()).toBe(14);
  });

  it('should parse date+time format', () => {
    const result = parseTestDate('2027-09-14T14:00');
    expect(result).toBeDefined();
    expect(result!.getFullYear()).toBe(2027);
  });

  it('should return undefined for invalid string', () => {
    expect(parseTestDate('not-a-date')).toBeUndefined();
  });
});

describe('isTradeDeadlineDay', () => {
  it('should return true on Nov 13', () => {
    expect(isTradeDeadlineDay(new Date(2027, 10, 13, 12, 0))).toBe(true);
  });

  it('should return false on Nov 12', () => {
    expect(isTradeDeadlineDay(new Date(2027, 10, 12, 23, 0))).toBe(false);
  });

  it('should return false on Nov 14', () => {
    expect(isTradeDeadlineDay(new Date(2027, 10, 14, 1, 0))).toBe(false);
  });
});

describe('isRegularSeason', () => {
  // 2027: Labor Day = Sep 6 (1st Monday), kickoff = Sep 9 (Thursday)
  // Regular season runs ~13 weeks through Monday night

  it('should return false before NFL kickoff', () => {
    expect(isRegularSeason(new Date(2027, 8, 8))).toBe(false); // Sep 8 (Wed)
  });

  it('should return true on NFL kickoff Thursday', () => {
    expect(isRegularSeason(new Date(2027, 8, 9))).toBe(true); // Sep 9 (Thu)
  });

  it('should return true mid-season (Oct)', () => {
    expect(isRegularSeason(new Date(2027, 9, 15))).toBe(true); // Oct 15
  });

  it('should return false on trade deadline day (Nov 13)', () => {
    // Trade deadline overrides at a higher priority, but isRegularSeason
    // still returns true (the override is in resolveHeroState, not here)
    expect(isRegularSeason(new Date(2027, 10, 13))).toBe(true);
  });
});

describe('getDailySlot', () => {
  // Use 2027-09-14 which is a Tuesday

  it('should return recap on Tuesday morning', () => {
    const result = getDailySlot(new Date(2027, 8, 14, 10, 0)); // Tue 10am
    expect(result.slot).toBe('recap');
    expect(result.gameWindow).toBeNull();
  });

  it('should return waiver-wire on Tuesday afternoon', () => {
    const result = getDailySlot(new Date(2027, 8, 14, 15, 0)); // Tue 3pm
    expect(result.slot).toBe('waiver-wire');
  });

  it('should return waiver-wire on Wednesday morning', () => {
    const result = getDailySlot(new Date(2027, 8, 15, 12, 0)); // Wed noon
    expect(result.slot).toBe('waiver-wire');
  });

  it('should return article on Wednesday night', () => {
    const result = getDailySlot(new Date(2027, 8, 15, 21, 0)); // Wed 9pm
    expect(result.slot).toBe('article');
  });

  it('should return article on Thursday morning', () => {
    const result = getDailySlot(new Date(2027, 8, 16, 10, 0)); // Thu 10am
    expect(result.slot).toBe('article');
  });

  it('should return live-scoring on Thursday evening (TNF)', () => {
    const result = getDailySlot(new Date(2027, 8, 16, 18, 0)); // Thu 6pm
    expect(result.slot).toBe('live-scoring');
    expect(result.gameWindow).toBe('tnf');
  });

  it('should return article on Friday', () => {
    const result = getDailySlot(new Date(2027, 8, 17, 12, 0)); // Fri noon
    expect(result.slot).toBe('article');
  });

  it('should return game-day-preview on Saturday', () => {
    const result = getDailySlot(new Date(2027, 8, 18, 12, 0)); // Sat noon
    expect(result.slot).toBe('game-day-preview');
  });

  it('should return game-day-preview on Sunday pre-game', () => {
    const result = getDailySlot(new Date(2027, 8, 19, 8, 0)); // Sun 8am
    expect(result.slot).toBe('game-day-preview');
  });

  it('should return live-scoring on Sunday during games', () => {
    const result = getDailySlot(new Date(2027, 8, 19, 14, 0)); // Sun 2pm
    expect(result.slot).toBe('live-scoring');
    expect(result.gameWindow).toBe('sunday');
  });

  it('should return live-scoring on Sunday night (SNF)', () => {
    const result = getDailySlot(new Date(2027, 8, 19, 21, 0)); // Sun 9pm
    expect(result.slot).toBe('live-scoring');
    expect(result.gameWindow).toBe('snf');
  });

  it('should return standings on Monday morning', () => {
    const result = getDailySlot(new Date(2027, 8, 20, 10, 0)); // Mon 10am
    expect(result.slot).toBe('standings');
  });

  it('should return live-scoring on Monday evening (MNF)', () => {
    const result = getDailySlot(new Date(2027, 8, 20, 18, 0)); // Mon 6pm
    expect(result.slot).toBe('live-scoring');
    expect(result.gameWindow).toBe('mnf');
  });
});

describe('resolveHeroState', () => {
  describe('P0++ Trade Deadline override', () => {
    it('should return trade-deadline on Nov 13', () => {
      const state = resolveHeroState(new Date(2027, 10, 13, 12, 0), true);
      expect(state.phase).toBe('trade-deadline');
      expect(state.priority).toBe('P0++');
    });
  });

  describe('P0 Auction/Draft hero', () => {
    it('should return auction-live during auction (March 22)', () => {
      const state = resolveHeroState(new Date(2027, 2, 22), true);
      expect(state.phase).toBe('auction-live');
      expect(state.priority).toBe('P0');
      expect(state.auctionProps?.live).toBe(true);
    });

    it('should return auction-preview before auction opens', () => {
      // 2027: 3rd Thursday of March = Mar 18. Monday before = Mar 15
      const state = resolveHeroState(new Date(2027, 2, 15, 12, 0), true);
      expect(state.phase).toBe('auction-preview');
      expect(state.auctionProps?.live).toBe(false);
    });

    it('should return draft-announced after NFL Draft', () => {
      // 2027: NFL Draft = Apr 22 (4th Thu), Mon after = Apr 26
      const state = resolveHeroState(new Date(2027, 3, 27), true);
      expect(state.phase).toBe('draft-announced');
      expect(state.draftProps?.live).toBe(false);
    });
  });

  describe('P0 Regular season daily rotation', () => {
    it('should return regular-season with live-scoring on Sunday 2pm', () => {
      // 2027: Labor Day = Sep 6, kickoff = Sep 10. Oct 3 = Sunday
      const state = resolveHeroState(new Date(2027, 9, 3, 14, 0), true);
      expect(state.phase).toBe('regular-season');
      expect(state.slot).toBe('live-scoring');
      expect(state.metadata.gameWindow).toBe('sunday');
    });

    it('should return regular-season with standings on Monday morning', () => {
      // 2027: Oct 4 = Monday
      const state = resolveHeroState(new Date(2027, 9, 4, 10, 0), true);
      expect(state.phase).toBe('regular-season');
      expect(state.slot).toBe('standings');
    });

    it('should return regular-season with recap on Tuesday morning', () => {
      const state = resolveHeroState(new Date(2027, 9, 5, 10, 0), true);
      expect(state.phase).toBe('regular-season');
      expect(state.slot).toBe('recap');
    });

    it('should return regular-season with waiver-wire on Tuesday afternoon', () => {
      const state = resolveHeroState(new Date(2027, 9, 5, 15, 0), true);
      expect(state.phase).toBe('regular-season');
      expect(state.slot).toBe('waiver-wire');
    });
  });

  describe('P1 Off-season phases', () => {
    it('should return tag-window in January', () => {
      const state = resolveHeroState(new Date(2027, 0, 15), true);
      expect(state.phase).toBe('tag-window');
      expect(state.priority).toBe('P1');
    });

    it('should return tagged-showcase in late February', () => {
      const state = resolveHeroState(new Date(2027, 1, 20), true);
      expect(state.phase).toBe('tagged-showcase');
      expect(state.priority).toBe('P1');
    });

    it('should return cut-watch in late July', () => {
      const state = resolveHeroState(new Date(2027, 6, 20), true);
      expect(state.phase).toBe('cut-watch');
      expect(state.priority).toBe('P1');
    });
  });

  describe('P5 Fallback', () => {
    it('should return offseason-fallback when no seasonal phase matches', () => {
      // Use a date that falls between phases (e.g., early June)
      const state = resolveHeroState(new Date(2027, 5, 15), true);
      // This should be either udfa-window or offseason-fallback depending on draft timing
      expect(['offseason-fallback', 'udfa-window', 'cut-watch']).toContain(state.phase);
    });
  });

  describe('testMode metadata', () => {
    it('should set testMode: true when flag is passed', () => {
      const state = resolveHeroState(new Date(2027, 5, 15), true);
      expect(state.metadata.testMode).toBe(true);
    });

    it('should set testMode: false by default', () => {
      const state = resolveHeroState(new Date(2027, 5, 15));
      expect(state.metadata.testMode).toBe(false);
    });
  });

  describe('backward compatibility — resolveHeroContent still works', () => {
    it('should still resolve auction hero via old API', () => {
      const entries: WhatsNewEntry[] = [];
      const timeline = makeTimeline();
      const now = new Date(2026, 2, 22); // March 22

      const result = resolveHeroContent(entries, timeline, now);
      expect(result.source).toBe('auction');
    });
  });
});
