/**
 * The division chip row on a league board — see `utils/live/board-groups.ts`
 * for who gets one and why.
 *
 * Toggle buttons with `aria-pressed`, the same contract as the board's
 * Scores/Standings switch beside it: a half-built `role="tablist"` owes the
 * reader tabpanels and roving arrow keys it would not get. The row scrolls
 * sideways on a phone rather than wrapping into three lines of chips above
 * the games it filters.
 */
import type { JSX } from 'react';
import type { LivePanelGroup } from '../../../types/live';
import { ALL_GROUPS, groupChipLabel } from '../../../utils/live/board-groups';

interface Props {
  groups: readonly LivePanelGroup[];
  /** The viewer's own division, offered first as "My division". */
  viewerGroupId: string | null;
  value: string;
  onChange: (groupId: string) => void;
}

export default function LvGroupPicker({ groups, viewerGroupId, value, onChange }: Props): JSX.Element {
  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      className={`lv-groups__chip${value === id ? ' lv-groups__chip--on' : ''}`}
      aria-pressed={value === id}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="lv-groups" role="group" aria-label="Show games by division">
      {viewerGroupId && chip(viewerGroupId, 'My division')}
      {chip(ALL_GROUPS, 'All')}
      {groups
        .filter((g) => g.id !== viewerGroupId)
        .map((g) => chip(g.id, groupChipLabel(g.name)))}
    </div>
  );
}
