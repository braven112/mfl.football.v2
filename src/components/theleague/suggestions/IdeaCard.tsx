import React from 'react';
import type { Idea } from '../../../types/suggestions';

interface Props {
  idea: Idea;
  teamIcon?: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const CATEGORY_LABELS: Record<string, { label: string; spriteId: string; className: string }> = {
  'rule-change': { label: 'Rule Change', spriteId: 'icon-gavel', className: 'sb-cat--rule' },
  'website': { label: 'Website', spriteId: 'icon-wrench', className: 'sb-cat--website' },
  'general': { label: 'General', spriteId: 'icon-beer', className: 'sb-cat--general' },
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  'open': { label: 'Open', className: 'sb-status--open' },
  'under-review': { label: 'Under Review', className: 'sb-status--review' },
  'approved': { label: 'Approved', className: 'sb-status--approved' },
  'rejected': { label: 'Rejected', className: 'sb-status--rejected' },
  'implemented': { label: 'Implemented', className: 'sb-status--implemented' },
  'tabled': { label: 'Tabled', className: 'sb-status--tabled' },
};

export default function IdeaCard({ idea, teamIcon, isAdmin, isOwner, onSelect, onDelete }: Props) {
  const canDelete = isOwner || isAdmin;
  const statusInfo = STATUS_LABELS[idea.status] ?? STATUS_LABELS['open'];

  return (
    <article
      className={`sb-card${idea.pinned ? ' sb-card--pinned' : ''}`}
      onClick={() => onSelect(idea.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onSelect(idea.id); }}
    >
      <div className="sb-card__header">
        <div className={`sb-card__avatar${teamIcon ? ' sb-card__avatar--has-icon' : ''}`}>
          {teamIcon ? (
            <img src={teamIcon} alt="" width="32" height="32" className="sb-card__team-icon" />
          ) : (
            <span>{idea.author.teamName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="sb-card__meta">
          <span className="sb-card__author">{idea.author.teamName}</span>
          <span className="sb-card__time">{timeAgo(idea.createdAt)}</span>
          {idea.editedAt && <span className="sb-card__edited">(edited)</span>}
        </div>
        <div className="sb-card__badges">
          {idea.pinned && (
            <span className="sb-card__pin" title="Pinned" aria-label="Pinned">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
              </svg>
            </span>
          )}
          {idea.status !== 'open' && (
            <span className={`sb-status ${statusInfo.className}`}>{statusInfo.label}</span>
          )}
        </div>
        {canDelete && onDelete && (
          <button
            className="sb-card__delete"
            onClick={e => { e.stopPropagation(); onDelete(idea.id); }}
            title="Delete this idea"
            aria-label="Delete this idea"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        )}
      </div>

      <h3 className="sb-card__title">
        {idea.category && (
          <span className={`sb-cat ${(CATEGORY_LABELS[idea.category] ?? CATEGORY_LABELS['general']).className}`}>
            <svg className="sb-cat__icon" aria-hidden="true"><use href={`/assets/icons/sprite.svg#${(CATEGORY_LABELS[idea.category] ?? CATEGORY_LABELS['general']).spriteId}`} /></svg>
            {' '}{(CATEGORY_LABELS[idea.category] ?? CATEGORY_LABELS['general']).label}
          </span>
        )}
        {idea.websiteFields && (
          <span className={`sb-ws-type sb-ws-type--${idea.websiteFields.type}`}>
            {idea.websiteFields.type === 'bug' ? '🐛 Bug' : '✨ Feature'}
          </span>
        )}
        {idea.title}
      </h3>
      <p className="sb-card__preview">
        {idea.websiteFields
          ? `${idea.websiteFields.pageOrFeature} — ${idea.websiteFields.problem.slice(0, 120)}${idea.websiteFields.problem.length > 120 ? '...' : ''}`
          : idea.body.length > 160 ? idea.body.slice(0, 160) + '...' : idea.body}
      </p>

      {/* Image thumbnails */}
      {idea.images && idea.images.length > 0 && (
        <div className="sb-card__images">
          {idea.images.slice(0, 3).map((img, i) => (
            <img key={img.url} src={img.url} alt="" className="sb-card__thumb" loading="lazy" />
          ))}
          {idea.images.length > 3 && (
            <span className="sb-card__more-images">+{idea.images.length - 3}</span>
          )}
        </div>
      )}

      <div className="sb-card__footer">
        <span className="sb-card__comments">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {idea.commentCount || 0}
        </span>
        {idea.locked && (
          <span className="sb-card__locked" title="Comments locked">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </span>
        )}
      </div>
    </article>
  );
}
