/**
 * TimelineSidebar - Right-side sticky anchor navigation.
 *
 * Renders month labels with dot indicators (one dot per entry) in a sticky
 * aside. Uses IntersectionObserver to highlight the month section currently
 * in view. Clicking a month smooth-scrolls to that section. Hidden below
 * 1024px breakpoint.
 */
import { useEffect, useRef, useState } from 'react';
import type { MonthGroup } from '../../../utils/whats-new-helpers';

interface Props {
  months: MonthGroup[];
}

export default function TimelineSidebar({ months }: Props) {
  const [activeMonthId, setActiveMonthId] = useState(months[0]?.id ?? '');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    // Clean up previous observer
    observerRef.current?.disconnect();

    const sections = document.querySelectorAll<HTMLElement>('[data-month-id]');
    if (sections.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          const id = visible[0].target.getAttribute('data-month-id');
          if (id) setActiveMonthId(id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      },
    );

    sections.forEach((section) => observerRef.current!.observe(section));

    return () => observerRef.current?.disconnect();
  }, [months]);

  const handleClick = (monthId: string) => {
    const section = document.querySelector(`[data-month-id="${monthId}"]`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (months.length === 0) return null;

  return (
    <aside className="wn-timeline" aria-label="Timeline navigation">
      <nav>
        <ul className="wn-timeline__list">
          {months.map((month) => {
            const isActive = activeMonthId === month.id;
            return (
              <li key={month.id} className="wn-timeline__item">
                <button
                  className={`wn-timeline__link${isActive ? ' wn-timeline__link--active' : ''}`}
                  onClick={() => handleClick(month.id)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className="wn-timeline__label">{month.label}</span>
                  <span className="wn-timeline__dots" aria-label={`${month.entries.length} entries`}>
                    {month.entries.map((entry, i) => (
                      <span
                        key={i}
                        className={`wn-timeline__dot wn-timeline__dot--${entry.category}${entry.isNew ? ' wn-timeline__dot--new' : ''}`}
                      />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
