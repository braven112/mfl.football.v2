/**
 * What's New Helpers
 *
 * Pure utility functions for sorting, enriching, grouping, and navigating
 * What's New entries. Used by both the listing page (React island) and
 * the detail page (Astro static paths).
 */
import type { WhatsNewEntry, WhatsNewCategory } from '../types/whats-new';

// ---------------------------------------------------------------------------
// Enriched entry type (adds computed fields for the listing page)
// ---------------------------------------------------------------------------

export interface EnrichedWhatsNewEntry extends WhatsNewEntry {
  /** Whether this entry is newer than the user's last visit */
  isNew: boolean;
  /** Human-readable date string (e.g., "Feb 21, 2026") */
  formattedDate: string;
  /** Month group key for grouping (e.g., "2026-02") */
  monthGroupId: string;
  /** Human-readable month label (e.g., "February 2026") */
  monthGroupLabel: string;
}

export interface MonthGroup {
  id: string;
  label: string;
  entries: EnrichedWhatsNewEntry[];
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Sort entries newest-first by date. Returns a new array. */
export function sortEntriesNewestFirst(entries: WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format "YYYY-MM-DD" to "Feb 21, 2026" */
export function formatEntryDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Enrichment (adds isNew, formattedDate, monthGroup fields)
// ---------------------------------------------------------------------------

/**
 * Enrich entries with computed display fields and "new since last visit" flag.
 *
 * When `lastVisitDate` is `null` (first visit), all entries are marked
 * `isNew: false` to avoid overwhelming badge noise on the first page load.
 */
export function enrichEntries(
  entries: WhatsNewEntry[],
  lastVisitDate: string | null,
): EnrichedWhatsNewEntry[] {
  return entries.map((entry) => {
    const date = new Date(entry.date + 'T00:00:00');
    const monthGroupId = entry.date.slice(0, 7); // "2026-02"
    const monthGroupLabel = date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    return {
      ...entry,
      isNew: lastVisitDate !== null && entry.date > lastVisitDate,
      formattedDate: formatEntryDate(entry.date),
      monthGroupId,
      monthGroupLabel,
    };
  });
}

// ---------------------------------------------------------------------------
// Grouping by month
// ---------------------------------------------------------------------------

/** Group enriched entries by month. Returns groups in newest-first order. */
export function groupByMonth(entries: EnrichedWhatsNewEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let currentId = '';

  for (const entry of entries) {
    if (entry.monthGroupId !== currentId) {
      groups.push({
        id: entry.monthGroupId,
        label: entry.monthGroupLabel,
        entries: [],
      });
      currentId = entry.monthGroupId;
    }
    groups[groups.length - 1].entries.push(entry);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Adjacent entry navigation (for detail page prev/next)
// ---------------------------------------------------------------------------

/**
 * Get the adjacent entries for prev/next navigation on the detail page.
 *
 * Operates on a newest-first sorted array. "prev" = the newer entry (toward
 * index 0), "next" = the older entry (toward the end).
 */
export function getAdjacentEntries(
  sortedEntries: WhatsNewEntry[],
  currentId: string,
): { prev: WhatsNewEntry | null; next: WhatsNewEntry | null } {
  const index = sortedEntries.findIndex((e) => e.id === currentId);
  if (index === -1) return { prev: null, next: null };

  return {
    prev: index > 0 ? sortedEntries[index - 1] : null,
    next: index < sortedEntries.length - 1 ? sortedEntries[index + 1] : null,
  };
}

// ---------------------------------------------------------------------------
// Category counts (for filter tabs)
// ---------------------------------------------------------------------------

/** Count entries per category, plus an "all" total. */
export function getCategoryCounts(
  entries: WhatsNewEntry[],
): Record<WhatsNewCategory | 'all', number> {
  const counts: Record<string, number> = {
    all: entries.length,
    'new-page': 0,
    'new-feature': 0,
    enhancement: 0,
    'league-event': 0,
  };

  for (const entry of entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }

  return counts as Record<WhatsNewCategory | 'all', number>;
}
