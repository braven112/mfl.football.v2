/**
 * LineupWeekSelector — dropdown to choose which week to set lineup for.
 * Shows current week + up to 3 future weeks.
 */

import { useCallback } from 'react';

interface LineupWeekSelectorProps {
  currentWeek: number;
  selectedWeek: number;
  maxWeek?: number;
  onChange: (week: number) => void;
  disabled?: boolean;
}

export default function LineupWeekSelector({
  currentWeek,
  selectedWeek,
  maxWeek = 17,
  onChange,
  disabled = false,
}: LineupWeekSelectorProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  // Build week options: current + up to 3 future
  const weeks: number[] = [];
  for (let w = currentWeek; w <= Math.min(currentWeek + 3, maxWeek); w++) {
    weeks.push(w);
  }

  return (
    <div className="lineup-week-selector">
      <label htmlFor="lineup-week" className="sr-only">
        Select week
      </label>
      <select
        id="lineup-week"
        className="lineup-week-selector__select"
        value={selectedWeek}
        onChange={handleChange}
        disabled={disabled}
        aria-label={`Week ${selectedWeek} lineup`}
      >
        {weeks.map((w) => (
          <option key={w} value={w}>
            Week {w}{w === currentWeek ? ' (Current)' : ''}
          </option>
        ))}
      </select>
      <svg
        className="lineup-week-selector__chevron"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
