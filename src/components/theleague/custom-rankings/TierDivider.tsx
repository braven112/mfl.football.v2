/**
 * TierDivider — a visual tier break row between players.
 * Shows a label, source indicator, and move/remove controls in edit mode.
 */

import { useState } from 'react';
import type { TierBreak } from '../../../types/custom-rankings';

interface TierDividerProps {
  tier: TierBreak;
  tierNumber: number;
  isEditing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRemove: (afterPlayerId: string) => void;
  onRename: (afterPlayerId: string, newLabel: string) => void;
  onMove: (afterPlayerId: string, direction: 'up' | 'down') => void;
}

export default function TierDivider({
  tier,
  tierNumber,
  isEditing,
  canMoveUp,
  canMoveDown,
  onRemove,
  onRename,
  onMove,
}: TierDividerProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tier.label || `Tier ${tierNumber}`);

  const displayLabel = tier.label || `Tier ${tierNumber}`;

  const handleSubmit = () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayLabel) {
      onRename(tier.afterPlayerId, trimmed);
    }
  };

  return (
    <div className="cr-tier">
      <div className="cr-tier__line" />

      {/* Move controls — only in edit mode */}
      {isEditing && (
        <div className="cr-tier__move">
          <button
            className="cr-tier__move-btn"
            onClick={() => onMove(tier.afterPlayerId, 'up')}
            disabled={!canMoveUp}
            title="Move tier up"
            type="button"
          >
            ▲
          </button>
          <button
            className="cr-tier__move-btn"
            onClick={() => onMove(tier.afterPlayerId, 'down')}
            disabled={!canMoveDown}
            title="Move tier down"
            type="button"
          >
            ▼
          </button>
        </div>
      )}

      <div className="cr-tier__label-area">
        {isEditing && editing ? (
          <input
            className="cr-tier__input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <button
            className="cr-tier__label"
            onClick={() => isEditing && setEditing(true)}
            title={isEditing ? 'Click to rename' : undefined}
            type="button"
            style={!isEditing ? { cursor: 'default' } : undefined}
          >
            {displayLabel}
          </button>
        )}
        {tier.source !== 'manual' && (
          <span className="cr-tier__source">
            {tier.source === 'auto' ? 'auto' : tier.source}
          </span>
        )}
      </div>

      <div className="cr-tier__line" />

      {isEditing && (
        <button
          className="cr-tier__remove"
          onClick={() => onRemove(tier.afterPlayerId)}
          title="Remove tier break"
          type="button"
        >
          ×
        </button>
      )}
    </div>
  );
}
