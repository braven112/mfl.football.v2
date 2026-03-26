import React, { useState } from 'react';
import type { Idea, Comment, IdeaCategory, IdeaStatus, WebsiteFields } from '../../../types/suggestions';
import CommentThread from './CommentThread';
import CommentComposer from './CommentComposer';
import IdeaComposer from './IdeaComposer';
import ReactionBar from './ReactionBar';
import AdminToolbar from './AdminToolbar';
import ImageGallery from './ImageGallery';
import PollCard from './PollCard';
import PollCreator from './PollCreator';

interface SubmitData {
  title: string;
  body: string;
  category: IdeaCategory;
  websiteFields?: WebsiteFields;
}

interface Props {
  idea: Idea;
  comments: Comment[];
  iconMap: Record<string, string>;
  teamNameMap?: Record<string, string>;
  isAdmin?: boolean;
  userFranchiseId?: string;
  isAuthenticated: boolean;
  onBack: () => void;
  onEdit: (id: string, title: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onAddComment: (ideaId: string, body: string, parentId?: string, imageUrls?: string[]) => Promise<boolean>;
  onEditComment: (commentId: string, body: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  onIdeaReaction: (ideaId: string, emoji: string) => void;
  onCommentReaction: (commentId: string, emoji: string) => void;
  onSetStatus?: (ideaId: string, status: IdeaStatus) => void;
  onTogglePin?: (ideaId: string) => void;
  onToggleLock?: (ideaId: string) => void;
  onToggleArchive?: (ideaId: string) => void;
  onCreatePoll?: (ideaId: string, options: string[], anonymous: boolean) => Promise<boolean>;
  onVote?: (ideaId: string, optionId: string) => void;
  onDeletePoll?: (ideaId: string) => void;
}

const CATEGORY_LABELS: Record<string, { label: string; spriteId: string }> = {
  'rule-change': { label: 'Rule Change', spriteId: 'icon-gavel' },
  'website': { label: 'Website Suggestion', spriteId: 'icon-wrench' },
  'general': { label: 'General Discussion', spriteId: 'icon-beer' },
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  'open': { label: 'Open', className: 'sb-status--open' },
  'under-review': { label: 'Under Review', className: 'sb-status--review' },
  'approved': { label: 'Approved', className: 'sb-status--approved' },
  'rejected': { label: 'Rejected', className: 'sb-status--rejected' },
  'implemented': { label: 'Implemented', className: 'sb-status--implemented' },
  'tabled': { label: 'Tabled', className: 'sb-status--tabled' },
};

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

/** Minimal markdown → React rendering (bold, italic, links, line breaks) */
function renderBody(text: string): React.ReactNode[] {
  const paragraphs = text.split('\n\n');
  return paragraphs.map((para, i) => {
    const lines = para.split('\n');
    const content = lines.map((line, j) => {
      const isBullet = line.startsWith('- ');
      const cleanLine = isBullet ? line.slice(2) : line;

      const parts: React.ReactNode[] = [];
      let remaining = cleanLine;
      let key = 0;

      while (remaining.length > 0) {
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

        const candidates = [
          boldMatch && { type: 'bold' as const, match: boldMatch, index: boldMatch.index! },
          italicMatch && { type: 'italic' as const, match: italicMatch, index: italicMatch.index! },
        ].filter(Boolean) as { type: 'bold' | 'italic'; match: RegExpMatchArray; index: number }[];

        if (candidates.length === 0) {
          parts.push(remaining);
          break;
        }

        const earliest = candidates.sort((a, b) => a.index - b.index)[0];

        if (earliest.index > 0) {
          parts.push(remaining.slice(0, earliest.index));
        }

        if (earliest.type === 'bold') {
          parts.push(<strong key={key++}>{earliest.match[1]}</strong>);
        } else {
          parts.push(<em key={key++}>{earliest.match[1]}</em>);
        }
        remaining = remaining.slice(earliest.index + earliest.match[0].length);
      }

      return (
        <React.Fragment key={j}>
          {j > 0 && <br />}
          {isBullet && '• '}
          {parts}
        </React.Fragment>
      );
    });
    return <p key={i} className="sb-detail__para">{content}</p>;
  });
}

export default function IdeaDetail({
  idea,
  comments,
  iconMap,
  teamNameMap,
  isAdmin,
  userFranchiseId,
  isAuthenticated,
  onBack,
  onEdit,
  onDelete,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onIdeaReaction,
  onCommentReaction,
  onSetStatus,
  onTogglePin,
  onToggleLock,
  onToggleArchive,
  onCreatePoll,
  onVote,
  onDeletePoll,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const teamIcon = iconMap[idea.author.franchiseId];
  const isOwner = idea.author.franchiseId === userFranchiseId;
  const canModify = isOwner || isAdmin;
  const statusInfo = STATUS_LABELS[idea.status] ?? STATUS_LABELS['open'];

  const handleEdit = async (data: SubmitData) => {
    const ok = await onEdit(idea.id, data.title, data.body);
    if (ok) setEditing(false);
  };

  const handleAddComment = async (body: string, parentId?: string, imageUrls?: string[]) => {
    return onAddComment(idea.id, body, parentId, imageUrls);
  };

  return (
    <div className="sb-detail">
      {/* Back button */}
      <button className="sb-detail__back" onClick={onBack} type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        All Ideas
      </button>

      {/* Idea header */}
      <div className="sb-detail__header">
        <div className="sb-detail__author-row">
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
          {idea.status !== 'open' && (
            <span className={`sb-status ${statusInfo.className}`}>{statusInfo.label}</span>
          )}
        </div>
      </div>

      {editing ? (
        <IdeaComposer
          onSubmit={handleEdit}
          initialTitle={idea.title}
          initialBody={idea.body}
          initialCategory={idea.category}
          onCancel={() => setEditing(false)}
          submitLabel="Save Changes"
        />
      ) : (
        <>
          {/* Category + type badge */}
          <div className="sb-detail__badges-row">
            {idea.category && (
              <span className={`sb-cat sb-cat--${idea.category === 'rule-change' ? 'rule' : idea.category}`}>
                <svg className="sb-cat__icon" aria-hidden="true"><use href={`/assets/icons/sprite.svg#${(CATEGORY_LABELS[idea.category] ?? CATEGORY_LABELS['general']).spriteId}`} /></svg>
                {' '}{(CATEGORY_LABELS[idea.category] ?? CATEGORY_LABELS['general']).label}
              </span>
            )}
            {idea.websiteFields && (
              <span className={`sb-ws-type sb-ws-type--${idea.websiteFields.type}`}>
                {idea.websiteFields.type === 'bug' ? '🐛 Bug' : '✨ Feature'}
              </span>
            )}
          </div>

          <h2 className="sb-detail__title">{idea.title}</h2>

          {/* Structured website fields */}
          {idea.websiteFields ? (
            <div className="sb-detail__ws-fields">
              <div className="sb-detail__ws-row">
                <span className="sb-detail__ws-label">Page / Feature</span>
                <span className="sb-detail__ws-value">{idea.websiteFields.pageOrFeature}</span>
              </div>
              <div className="sb-detail__ws-row">
                <span className="sb-detail__ws-label">{idea.websiteFields.type === 'bug' ? "What's Happening" : 'The Problem'}</span>
                <div className="sb-detail__ws-value">{renderBody(idea.websiteFields.problem)}</div>
              </div>
              <div className="sb-detail__ws-row">
                <span className="sb-detail__ws-label">{idea.websiteFields.type === 'bug' ? 'What Should Happen' : 'Desired Behavior'}</span>
                <div className="sb-detail__ws-value">{renderBody(idea.websiteFields.desiredBehavior)}</div>
              </div>
            </div>
          ) : (
            <div className="sb-detail__body">{renderBody(idea.body)}</div>
          )}

          {/* Attached images */}
          {idea.images && idea.images.length > 0 && (
            <ImageGallery images={idea.images} />
          )}

          {/* Reactions on the idea */}
          {isAuthenticated && (
            <ReactionBar
              reactions={idea.reactions}
              userFranchiseId={userFranchiseId}
              teamNames={teamNameMap}
              onToggle={emoji => onIdeaReaction(idea.id, emoji)}
            />
          )}

          {/* Poll */}
          {idea.poll && onVote && (
            <PollCard
              poll={idea.poll}
              userFranchiseId={userFranchiseId}
              teamNameMap={teamNameMap}
              onVote={optionId => onVote(idea.id, optionId)}
              isAuthenticated={isAuthenticated}
            />
          )}

          {/* Admin: create poll */}
          {isAdmin && !idea.poll && onCreatePoll && (
            showPollCreator ? (
              <PollCreator
                onCreatePoll={async (options, anonymous) => {
                  const ok = await onCreatePoll(idea.id, options, anonymous);
                  if (ok) setShowPollCreator(false);
                  return ok;
                }}
                onCancel={() => setShowPollCreator(false)}
              />
            ) : (
              <button
                type="button"
                className="sb-thread__action"
                onClick={() => setShowPollCreator(true)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 20V10M12 20V4M6 20v-6"/>
                </svg>
                {' '}Add Poll
              </button>
            )
          )}

          {/* Admin: remove poll */}
          {isAdmin && idea.poll && onDeletePoll && (
            <button
              type="button"
              className="sb-thread__action sb-thread__action--danger"
              onClick={() => onDeletePoll(idea.id)}
              style={{ marginBottom: '0.5rem' }}
            >
              Remove Poll
            </button>
          )}

          {/* Owner actions: edit */}
          {canModify && !isAdmin && (
            <div className="sb-detail__idea-actions">
              <button className="sb-thread__action" onClick={() => setEditing(true)}>Edit</button>
              <button className="sb-thread__action sb-thread__action--danger" onClick={() => onDelete(idea.id)}>Delete</button>
            </div>
          )}

          {/* Admin toolbar: full moderation */}
          {isAdmin && onSetStatus && onTogglePin && onToggleLock && onToggleArchive && (
            <AdminToolbar
              idea={idea}
              onSetStatus={status => onSetStatus(idea.id, status)}
              onTogglePin={() => onTogglePin(idea.id)}
              onToggleLock={() => onToggleLock(idea.id)}
              onToggleArchive={() => onToggleArchive(idea.id)}
              onDelete={() => onDelete(idea.id)}
            />
          )}
        </>
      )}

      {/* Comments section */}
      <div className="sb-detail__comments-section">
        <div className="sb-section-title">
          Comments
          <span className="sb-detail__comment-count">{comments.length}</span>
        </div>

        {idea.locked && (
          <div className="sb-detail__locked-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Comments are locked on this idea.
          </div>
        )}

        <CommentThread
          comments={comments}
          iconMap={iconMap}
          teamNameMap={teamNameMap}
          isAdmin={isAdmin}
          userFranchiseId={userFranchiseId}
          isAuthenticated={isAuthenticated}
          ideaLocked={idea.locked}
          onAddComment={handleAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentReaction={onCommentReaction}
        />

        {isAuthenticated && !idea.locked && (
          <CommentComposer
            onSubmit={(body, imageUrls) => handleAddComment(body, undefined, imageUrls)}
            placeholder="Share your thoughts..."
          />
        )}
      </div>
    </div>
  );
}
