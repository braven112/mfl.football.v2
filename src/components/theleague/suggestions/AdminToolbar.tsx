import React, { useState } from 'react';
import type { Idea, IdeaStatus } from '../../../types/suggestions';

interface Props {
  idea: Idea;
  onSetStatus: (status: IdeaStatus) => void;
  onTogglePin: () => void;
  onToggleLock: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

const STATUS_OPTIONS: { value: IdeaStatus; label: string; icon: string }[] = [
  { value: 'open', label: 'Open', icon: '⚪' },
  { value: 'under-review', label: 'Under Review', icon: '🟡' },
  { value: 'approved', label: 'Approved', icon: '🟢' },
  { value: 'rejected', label: 'Rejected', icon: '🔴' },
  { value: 'implemented', label: 'Implemented', icon: '🔵' },
  { value: 'tabled', label: 'Tabled', icon: '⚫' },
];

export default function AdminToolbar({ idea, onSetStatus, onTogglePin, onToggleLock, onToggleArchive, onDelete }: Props) {
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="sb-admin">
      <div className="sb-admin__label">Commissioner Tools</div>
      <div className="sb-admin__actions">
        {/* Status dropdown */}
        <div className="sb-admin__dropdown-wrap">
          <button
            type="button"
            className="sb-admin__btn"
            onClick={() => setStatusOpen(!statusOpen)}
            title="Set status"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            Status
          </button>
          {statusOpen && (
            <div className="sb-admin__dropdown">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`sb-admin__dropdown-item${idea.status === opt.value ? ' sb-admin__dropdown-item--active' : ''}`}
                  onClick={() => { onSetStatus(opt.value); setStatusOpen(false); }}
                >
                  <span>{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pin toggle */}
        <button
          type="button"
          className={`sb-admin__btn${idea.pinned ? ' sb-admin__btn--active' : ''}`}
          onClick={onTogglePin}
          title={idea.pinned ? 'Unpin' : 'Pin to top'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={idea.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
          </svg>
          {idea.pinned ? 'Pinned' : 'Pin'}
        </button>

        {/* Lock toggle */}
        <button
          type="button"
          className={`sb-admin__btn${idea.locked ? ' sb-admin__btn--active' : ''}`}
          onClick={onToggleLock}
          title={idea.locked ? 'Unlock comments' : 'Lock comments'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          {idea.locked ? 'Locked' : 'Lock'}
        </button>

        {/* Archive toggle */}
        <button
          type="button"
          className={`sb-admin__btn${idea.archived ? ' sb-admin__btn--active' : ''}`}
          onClick={onToggleArchive}
          title={idea.archived ? 'Unarchive' : 'Archive'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="21 8 21 21 3 21 3 8"/>
            <rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          {idea.archived ? 'Archived' : 'Archive'}
        </button>

        {/* Delete */}
        <button
          type="button"
          className="sb-admin__btn sb-admin__btn--danger"
          onClick={onDelete}
          title="Delete idea"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}
