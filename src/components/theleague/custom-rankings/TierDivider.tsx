/**
 * TierDivider — a visual tier break row between players.
 * Shows a label, source indicator, and remove button.
 */

import { useState } from 'react';
import type { TierBreak } from '../../../types/custom-rankings';

interface TierDividerProps {
  tier: TierBreak;
  tierNumber: number;
  onRemove: (afterPlayerId: string) => void;
  onRename: (afterPlayerId: string, newLabel: string) => void;
}

export default function TierDivider({
  tier,
  tierNumber,
  onRemove,
  onRename,
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
      <div className="cr-tier__label-area">
        {editing ? (
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
            onClick={() => setEditing(true)}
            title="Click to rename"
            type="button"
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
      <button
        className="cr-tier__remove"
        onClick={() => onRemove(tier.afterPlayerId)}
        title="Remove tier break"
        type="button"
      >
        ×
      </button>
    </div>
  );
}
