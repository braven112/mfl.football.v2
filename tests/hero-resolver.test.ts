import { describe, it, expect } from 'vitest';
import { resolveHeroContent } from '../src/utils/hero-resolver';
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

describe('resolveHeroContent', () => {
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

    it('should NOT show a feature that is 8 days old', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'eight-days', title: '8 Day Feature', date: '2026-02-08' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Should fall through to default (no events in timeline)
      expect(result.source).toBe('default');
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

    it('should NOT show future-dated features', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'future', title: 'Future Feature', date: '2026-02-20' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      // Future date = negative age, should not match
      expect(result.source).toBe('default');
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

      expect(result.source).toBe('default');
    });
  });

  describe('Priority 5: Default fallback', () => {
    it('should show the default when no entries or events qualify', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'ancient', title: 'Ancient Feature', date: '2025-01-01' }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

      expect(result.source).toBe('default');
      expect(result.title).toBe("What's New");
      expect(result.link).toBe('/theleague/whats-new');
    });

    it('should show the default with empty entries and empty timeline', () => {
      const result = resolveHeroContent([], makeTimeline(), new Date(2026, 1, 16));

      expect(result.source).toBe('default');
    });
  });

  describe('excludeFromHero filtering', () => {
    it('should exclude entries with excludeFromHero: true', () => {
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'excluded', title: 'Excluded Feature', date: '2026-02-16', excludeFromHero: true }),
      ];
      const timeline = makeTimeline();
      const now = new Date(2026, 1, 16);

      const result = resolveHeroContent(entries, timeline, now);

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
    it('should correctly cascade through all 5 priorities', () => {
      const now = new Date(2026, 1, 16);

      const fresh = makeEntry({ id: 'fresh', title: 'Fresh', date: '2026-02-15' });
      const old = makeEntry({ id: 'old', title: 'Old', date: '2025-06-01' });

      const urgentEvent = makeEvent({ name: 'Urgent', isUrgent: true, daysUntilStart: 2 });
      const activeEvent = makeEvent({ name: 'Active', isActive: true });
      const upcomingEvent = makeEvent({ name: 'Upcoming', daysUntilStart: 5 });

      // Priority 1: Fresh feature wins over everything
      let result = resolveHeroContent(
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

      // Priority 5: Remove upcoming — default wins
      result = resolveHeroContent(
        [old],
        makeTimeline(),
        now,
      );
      expect(result.title).toBe("What's New");
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

    it('should NOT show a feature when testDate makes it too old', () => {
      // Feature shipped Jan 20, testing as if it were Jan 30 (10 days old, > 7)
      const entries: WhatsNewEntry[] = [
        makeEntry({ id: 'jan-feature', title: 'January Feature', date: '2026-01-20' }),
      ];
      const timeline = makeTimeline();
      const testDate = new Date(2026, 0, 30); // Jan 30

      const result = resolveHeroContent(entries, timeline, testDate);

      expect(result.source).toBe('default');
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
