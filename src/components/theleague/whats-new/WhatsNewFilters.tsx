/**
 * WhatsNewFilters - Horizontal pill tabs for category filtering.
 *
 * Shows "All" plus one tab per category with entry counts. Active tab
 * uses the category accent color. Filter state is synced to the
 * ?category= URL param via replaceState so links are shareable.
 */
import { useEffect } from 'react';
import { WHATS_NEW_CATEGORY_LABELS } from '../../../types/whats-new';
import type { WhatsNewCategory } from '../../../types/whats-new';

interface Props {
  categoryCounts: Record<WhatsNewCategory | 'all', number>;
  activeCategory: string;
  onChange: (category: string) => void;
}

const CATEGORY_ORDER: Array<WhatsNewCategory | 'all'> = [
  'all',
  'new-page',
  'new-feature',
  'enhancement',
  'league-event',
];

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  ...WHATS_NEW_CATEGORY_LABELS,
};

export default function WhatsNewFilters({ categoryCounts, activeCategory, onChange }: Props) {
  // Sync filter state to URL on mount (restore from URL param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCategory = params.get('category');
    if (urlCategory && urlCategory !== activeCategory && urlCategory in categoryCounts) {
      onChange(urlCategory);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = (category: string) => {
    onChange(category);
    const url = new URL(window.location.href);
    if (category === 'all') {
      url.searchParams.delete('category');
    } else {
      url.searchParams.set('category', category);
    }
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <div className="wn-filters" role="tablist" aria-label="Filter by category">
      {CATEGORY_ORDER.map((cat) => {
        const count = categoryCounts[cat] ?? 0;
        if (cat !== 'all' && count === 0) return null;
        const isActive = activeCategory === cat;

        return (
          <button
            key={cat}
            role="tab"
            aria-selected={isActive}
            className={`wn-filters__tab wn-filters__tab--${cat}${isActive ? ' wn-filters__tab--active' : ''}`}
            onClick={() => handleClick(cat)}
          >
            {CATEGORY_LABELS[cat]}
            <span className="wn-filters__count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
