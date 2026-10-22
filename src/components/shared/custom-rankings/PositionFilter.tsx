/**
 * PositionFilter — chip bar for filtering the ranking list by position.
 */

import type { PositionFilter as PositionFilterType } from '../../../types/custom-rankings';

const POSITIONS: PositionFilterType[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF'];

interface PositionFilterProps {
  active: PositionFilterType;
  counts: Record<PositionFilterType, number>;
  onChange: (position: PositionFilterType) => void;
}

export default function PositionFilter({ active, counts, onChange }: PositionFilterProps) {
  return (
    <div className="ui-pills cr-filters" role="group" aria-label="Filter by position">
      {POSITIONS.map((pos) => (
        <button
          key={pos}
          className="ui-pill cr-filters__chip"
          aria-pressed={active === pos}
          onClick={() => onChange(pos)}
          type="button"
        >
          {pos}
          <span className="cr-filters__count">{counts[pos]}</span>
        </button>
      ))}
    </div>
  );
}
