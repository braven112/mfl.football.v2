/**
 * WhatsNewListing - Parent React island for the What's New listing page.
 *
 * Manages category filter state and renders the filter tabs, card grid
 * (grouped by month), and the right-side timeline sidebar. Data is passed
 * from Astro as serialized JSON strings (same pattern as RankingsImportPage).
 */
import { useState, useMemo } from 'react';
import type { WhatsNewCategory } from '../../../types/whats-new';
import type { MonthGroup } from '../../../utils/whats-new-helpers';
import WhatsNewFilters from './WhatsNewFilters';
import WhatsNewCard from './WhatsNewCard';
import TimelineSidebar from './TimelineSidebar';

interface Props {
  monthsJson: string;
  categoryCountsJson: string;
}

export default function WhatsNewListing({ monthsJson, categoryCountsJson }: Props) {
  const months: MonthGroup[] = useMemo(() => JSON.parse(monthsJson), [monthsJson]);
  const categoryCounts = useMemo(
    () => JSON.parse(categoryCountsJson) as Record<WhatsNewCategory | 'all', number>,
    [categoryCountsJson],
  );

  const [activeCategory, setActiveCategory] = useState<string>('all');

  // Filter months/entries based on activeCategory
  const filteredMonths = useMemo(() => {
    if (activeCategory === 'all') return months;
    return months
      .map((m) => ({
        ...m,
        entries: m.entries.filter((e) => e.category === activeCategory),
      }))
      .filter((m) => m.entries.length > 0);
  }, [months, activeCategory]);

  return (
    <div className="wn-listing">
      <WhatsNewFilters
        categoryCounts={categoryCounts}
        activeCategory={activeCategory}
        onChange={setActiveCategory}
      />

      <div className="wn-listing__body">
        <div className="wn-listing__main">
          {filteredMonths.length === 0 ? (
            <p className="wn-listing__empty">No entries in this category.</p>
          ) : (
            filteredMonths.map((month) => (
              <section
                key={month.id}
                className="wn-month"
                data-month-id={month.id}
              >
                <h2 className="wn-month__label">{month.label}</h2>
                <div className="wn-month__entries">
                  {month.entries.map((entry, i) => (
                    <WhatsNewCard key={entry.id} entry={entry} featured={i === 0} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <TimelineSidebar months={filteredMonths} />
      </div>
    </div>
  );
}
