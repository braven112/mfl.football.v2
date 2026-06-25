import { describe, it, expect } from 'vitest';
import { buildLeagueEventView } from '../src/utils/league-event-hero-view';
import type { HeroContent } from '../src/types/whats-new';
import type { WhatsNextTimeline, ResolvedLeagueEvent, LeagueEventDefinition } from '../src/types/league-events';

/** Minimal ResolvedLeagueEvent factory. */
function makeEvent(
  overrides: Partial<ResolvedLeagueEvent> & { id?: string; name?: string; category?: LeagueEventDefinition['category'] },
): ResolvedLeagueEvent {
  const def: LeagueEventDefinition = {
    id: overrides.id ?? 'nfl-draft',
    name: overrides.name ?? 'NFL Draft',
    description: 'A test event description',
    category: overrides.category ?? 'draft',
    icon: 'nfl',
    startDate: { type: 'fixed', month: 4, day: 23 },
    sortOrder: 1,
    ...(overrides.definition ?? {}),
  };
  return {
    definition: def,
    startDate: overrides.startDate ?? new Date(2026, 3, 23),
    endDate: overrides.endDate,
    isActive: overrides.isActive ?? false,
    isPast: overrides.isPast ?? false,
    isUrgent: overrides.isUrgent ?? false,
    daysUntilStart: overrides.daysUntilStart ?? 5,
    actionLinks: overrides.actionLinks ?? [],
    resultLinks: overrides.resultLinks ?? [],
  } as ResolvedLeagueEvent;
}

function makeTimeline(next: ResolvedLeagueEvent | null): WhatsNextTimeline {
  return { current: null, next, upcoming: null, referenceDate: new Date(2026, 3, 18), leagueYear: 2026 };
}

describe('buildLeagueEventView', () => {
  it('builds a bordered calendar view with the category accent for an nfl-draft lead-up', () => {
    const now = new Date(2026, 3, 18); // 5 days before Apr 23
    const event = makeEvent({ id: 'nfl-draft', category: 'draft', startDate: new Date(2026, 3, 23) });
    const fallback: HeroContent = {
      source: 'event',
      title: 'NFL Draft',
      summary: 'NFL Draft weekend',
      heroEventId: 'nfl-draft',
      icon: 'nfl',
    };

    const { view, bordered } = buildLeagueEventView(fallback, makeTimeline(event), now);

    expect(bordered).toBe(true);
    expect(view.accent).toBe('#7c3aed'); // draft category accent
    expect(view.countValue).toBe(5);
    expect(view.pill).toContain('NFL Draft');
  });

  it('synthesizes a bordered view for a calendar event without a rich config', () => {
    const now = new Date(2026, 1, 10);
    const event = makeEvent({
      id: 'tag-matching-period',
      name: 'Tag Matching Period',
      category: 'preseason',
      startDate: new Date(2026, 2, 1),
    });
    const fallback: HeroContent = {
      source: 'event',
      title: 'Tag Matching Period',
      summary: 'Original teams must match offers or lose tagged players',
      heroEventId: 'tag-matching-period',
    };

    const { view, bordered } = buildLeagueEventView(fallback, makeTimeline(event), now);

    expect(bordered).toBe(true);
    expect(view.accent).toBe('#2563eb'); // preseason category accent (readable as white-text pill)
    expect(view.headline).toBe('Tag Matching Period');
  });

  it('builds a non-bordered feature view for a fresh What\'s New entry', () => {
    const now = new Date(2026, 5, 1);
    const fallback: HeroContent = {
      source: 'feature',
      title: 'New Trade Builder',
      summary: 'Build and analyze trades right on the site.',
      link: '/theleague/trade-builder',
      linkLabel: 'Try it',
      icon: 'exchange',
      kicker: 'New Feature',
    };

    const { view, bordered } = buildLeagueEventView(fallback, makeTimeline(null), now);

    expect(bordered).toBe(false);
    expect(view.headline).toBe('Fresh on the');
    expect(view.pill).toBe('NEW FEATURE');
    expect(view.link).toBe('/theleague/trade-builder');
  });

  it('builds a non-bordered default view otherwise', () => {
    const now = new Date(2026, 5, 1);
    const fallback: HeroContent = {
      source: 'default',
      title: "What's New",
      summary: 'See all the latest features.',
      link: '/theleague/whats-new',
      kicker: "What's New",
    };

    const { view, bordered } = buildLeagueEventView(fallback, makeTimeline(null), now);

    expect(bordered).toBe(false);
    expect(view.headline).toBe("What's New");
    expect(view.accent).toBe('#1c497c'); // regular-season / default accent
  });
});
