import { describe, it, expect } from 'vitest';
import type { WhatsNewEntry } from '../src/types/whats-new';
import {
  sortEntriesNewestFirst,
  formatEntryDate,
  enrichEntries,
  groupByMonth,
  getAdjacentEntries,
  getCategoryCounts,
} from '../src/utils/whats-new-helpers';

/** Helper to create a minimal WhatsNewEntry */
function makeEntry(overrides?: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: overrides?.id ?? 'test-entry',
    date: overrides?.date ?? '2026-02-16',
    title: overrides?.title ?? 'Test Entry',
    summary: overrides?.summary ?? 'A test summary',
    description: overrides?.description ?? ['Test description'],
    category: overrides?.category ?? 'new-feature',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sortEntriesNewestFirst
// ---------------------------------------------------------------------------

describe('sortEntriesNewestFirst', () => {
  it('sorts entries by date descending', () => {
    const entries = [
      makeEntry({ id: 'old', date: '2025-11-15' }),
      makeEntry({ id: 'new', date: '2026-02-21' }),
      makeEntry({ id: 'mid', date: '2026-01-18' }),
    ];
    const sorted = sortEntriesNewestFirst(entries);
    expect(sorted.map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('handles entries with the same date', () => {
    const entries = [
      makeEntry({ id: 'a', date: '2026-02-16' }),
      makeEntry({ id: 'b', date: '2026-02-16' }),
    ];
    const sorted = sortEntriesNewestFirst(entries);
    expect(sorted).toHaveLength(2);
    // Both present, order is stable
    expect(sorted.map((e) => e.id)).toContain('a');
    expect(sorted.map((e) => e.id)).toContain('b');
  });

  it('returns empty array for empty input', () => {
    expect(sortEntriesNewestFirst([])).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const entries = [
      makeEntry({ id: 'a', date: '2025-11-15' }),
      makeEntry({ id: 'b', date: '2026-02-21' }),
    ];
    const original = [...entries];
    sortEntriesNewestFirst(entries);
    expect(entries.map((e) => e.id)).toEqual(original.map((e) => e.id));
  });
});

// ---------------------------------------------------------------------------
// formatEntryDate
// ---------------------------------------------------------------------------

describe('formatEntryDate', () => {
  it('formats a date string to "Mon DD, YYYY"', () => {
    expect(formatEntryDate('2026-02-21')).toBe('Feb 21, 2026');
  });

  it('formats a date in a different month', () => {
    expect(formatEntryDate('2025-11-15')).toBe('Nov 15, 2025');
  });

  it('formats January 1st correctly', () => {
    expect(formatEntryDate('2026-01-01')).toBe('Jan 1, 2026');
  });
});

// ---------------------------------------------------------------------------
// enrichEntries
// ---------------------------------------------------------------------------

describe('enrichEntries', () => {
  it('marks entries after lastVisitDate as isNew', () => {
    const entries = [
      makeEntry({ id: 'new', date: '2026-02-21' }),
      makeEntry({ id: 'old', date: '2026-02-10' }),
    ];
    const enriched = enrichEntries(entries, '2026-02-15');
    expect(enriched.find((e) => e.id === 'new')?.isNew).toBe(true);
    expect(enriched.find((e) => e.id === 'old')?.isNew).toBe(false);
  });

  it('marks all entries as isNew=false when lastVisitDate is null (first visit)', () => {
    const entries = [
      makeEntry({ id: 'a', date: '2026-02-21' }),
      makeEntry({ id: 'b', date: '2026-02-10' }),
    ];
    const enriched = enrichEntries(entries, null);
    expect(enriched.every((e) => e.isNew === false)).toBe(true);
  });

  it('same-date entries are not marked new', () => {
    const entries = [makeEntry({ id: 'same', date: '2026-02-15' })];
    const enriched = enrichEntries(entries, '2026-02-15');
    expect(enriched[0].isNew).toBe(false);
  });

  it('computes formattedDate correctly', () => {
    const entries = [makeEntry({ date: '2026-02-21' })];
    const enriched = enrichEntries(entries, null);
    expect(enriched[0].formattedDate).toBe('Feb 21, 2026');
  });

  it('computes monthGroupId and monthGroupLabel correctly', () => {
    const entries = [makeEntry({ date: '2026-02-21' })];
    const enriched = enrichEntries(entries, null);
    expect(enriched[0].monthGroupId).toBe('2026-02');
    expect(enriched[0].monthGroupLabel).toBe('February 2026');
  });

  it('returns empty array for empty input', () => {
    expect(enrichEntries([], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupByMonth
// ---------------------------------------------------------------------------

describe('groupByMonth', () => {
  it('groups entries into correct months', () => {
    const entries = sortEntriesNewestFirst([
      makeEntry({ id: 'feb1', date: '2026-02-21' }),
      makeEntry({ id: 'feb2', date: '2026-02-16' }),
      makeEntry({ id: 'jan1', date: '2026-01-18' }),
      makeEntry({ id: 'nov1', date: '2025-11-15' }),
    ]);
    const enriched = enrichEntries(entries, null);
    const groups = groupByMonth(enriched);

    expect(groups).toHaveLength(3);
    expect(groups[0].label).toBe('February 2026');
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].label).toBe('January 2026');
    expect(groups[1].entries).toHaveLength(1);
    expect(groups[2].label).toBe('November 2025');
    expect(groups[2].entries).toHaveLength(1);
  });

  it('returns groups newest-first', () => {
    const entries = sortEntriesNewestFirst([
      makeEntry({ id: 'old', date: '2025-11-15' }),
      makeEntry({ id: 'new', date: '2026-02-21' }),
    ]);
    const enriched = enrichEntries(entries, null);
    const groups = groupByMonth(enriched);

    expect(groups[0].id).toBe('2026-02');
    expect(groups[1].id).toBe('2025-11');
  });

  it('returns empty array for empty input', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAdjacentEntries
// ---------------------------------------------------------------------------

describe('getAdjacentEntries', () => {
  const sorted = sortEntriesNewestFirst([
    makeEntry({ id: 'first', date: '2026-02-21' }),
    makeEntry({ id: 'middle', date: '2026-02-16' }),
    makeEntry({ id: 'last', date: '2025-11-15' }),
  ]);

  it('returns correct prev/next for middle entry', () => {
    const { prev, next } = getAdjacentEntries(sorted, 'middle');
    expect(prev?.id).toBe('first');
    expect(next?.id).toBe('last');
  });

  it('returns null prev for first (newest) entry', () => {
    const { prev, next } = getAdjacentEntries(sorted, 'first');
    expect(prev).toBeNull();
    expect(next?.id).toBe('middle');
  });

  it('returns null next for last (oldest) entry', () => {
    const { prev, next } = getAdjacentEntries(sorted, 'last');
    expect(prev?.id).toBe('middle');
    expect(next).toBeNull();
  });

  it('returns both null for unknown ID', () => {
    const { prev, next } = getAdjacentEntries(sorted, 'nonexistent');
    expect(prev).toBeNull();
    expect(next).toBeNull();
  });

  it('handles single entry (both null)', () => {
    const single = [makeEntry({ id: 'only' })];
    const { prev, next } = getAdjacentEntries(single, 'only');
    expect(prev).toBeNull();
    expect(next).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCategoryCounts
// ---------------------------------------------------------------------------

describe('getCategoryCounts', () => {
  it('counts each category correctly', () => {
    const entries = [
      makeEntry({ category: 'new-page' }),
      makeEntry({ category: 'new-page' }),
      makeEntry({ category: 'new-feature' }),
      makeEntry({ category: 'enhancement' }),
      makeEntry({ category: 'enhancement' }),
      makeEntry({ category: 'enhancement' }),
    ];
    const counts = getCategoryCounts(entries);

    expect(counts['new-page']).toBe(2);
    expect(counts['new-feature']).toBe(1);
    expect(counts['enhancement']).toBe(3);
    expect(counts['league-event']).toBe(0);
  });

  it('includes all total', () => {
    const entries = [
      makeEntry({ category: 'new-page' }),
      makeEntry({ category: 'new-feature' }),
    ];
    const counts = getCategoryCounts(entries);
    expect(counts.all).toBe(2);
  });

  it('returns zeros for empty input', () => {
    const counts = getCategoryCounts([]);
    expect(counts.all).toBe(0);
    expect(counts['new-page']).toBe(0);
    expect(counts['new-feature']).toBe(0);
    expect(counts['enhancement']).toBe(0);
    expect(counts['league-event']).toBe(0);
  });
});
