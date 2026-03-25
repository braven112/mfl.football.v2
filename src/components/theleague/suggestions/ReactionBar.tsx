import React, { useState, useCallback } from 'react';
import type { ReactionMap } from '../../../types/suggestions';
import EmojiPicker from './EmojiPicker';

interface Props {
  reactions: ReactionMap;
  userFranchiseId?: string;
  /** Map franchiseId → team name for tooltips */
  teamNames?: Record<string, string>;
  onToggle: (emoji: string) => void;
  disabled?: boolean;
}

export default function ReactionBar({ reactions, userFranchiseId, teamNames, onToggle, disabled }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleSelect = useCallback((emoji: string) => {
    onToggle(emoji);
  }, [onToggle]);

  const entries = Object.entries(reactions || {}).filter(([, ids]) => ids.length > 0);

  return (
    <div className="sb-reactions">
      {entries.map(([emoji, franchiseIds]) => {
        const isActive = userFranchiseId ? franchiseIds.includes(userFranchiseId) : false;
        const names = teamNames
          ? franchiseIds.map(id => teamNames[id] ?? 'Unknown').join(', ')
          : `${franchiseIds.length} reaction${franchiseIds.length !== 1 ? 's' : ''}`;

        return (
          <button
            key={emoji}
            type="button"
            className={`sb-reaction-pill${isActive ? ' sb-reaction-pill--active' : ''}`}
            onClick={() => onToggle(emoji)}
            title={names}
            disabled={disabled}
          >
            <span className="sb-reaction-pill__emoji">{emoji}</span>
            <span className="sb-reaction-pill__count">{franchiseIds.length}</span>
          </button>
        );
      })}

      {!disabled && (
        <div className="sb-reaction-add-wrap">
          <button
            type="button"
            className="sb-reaction-add"
            onClick={() => setPickerOpen(!pickerOpen)}
            title="Add reaction"
            aria-label="Add reaction"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
            </svg>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
          {pickerOpen && (
            <EmojiPicker
              onSelect={handleSelect}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
