import React from 'react';
import type { Comment } from '../../../types/suggestions';
import CommentComposer from './CommentComposer';
import ReactionBar from './ReactionBar';
import ImageGallery from './ImageGallery';

interface Props {
  comments: Comment[];
  iconMap: Record<string, string>;
  teamNameMap?: Record<string, string>;
  isAdmin?: boolean;
  userFranchiseId?: string;
  isAuthenticated: boolean;
  ideaLocked?: boolean;
  onAddComment: (body: string, parentId?: string) => Promise<boolean>;
  onEditComment: (commentId: string, body: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  onCommentReaction?: (commentId: string, emoji: string) => void;
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

interface CommentNodeData extends Comment {
  children: CommentNodeData[];
}

function buildTree(comments: Comment[]): CommentNodeData[] {
  const map = new Map<string, CommentNodeData>();
  const roots: CommentNodeData[] = [];

  for (const c of comments) {
    map.set(c.id, { ...c, children: [] });
  }

  for (const c of comments) {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function CommentNode({
  comment,
  depth,
  iconMap,
  teamNameMap,
  isAdmin,
  userFranchiseId,
  isAuthenticated,
  ideaLocked,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentReaction,
}: {
  comment: CommentNodeData;
  depth: number;
  iconMap: Record<string, string>;
  teamNameMap?: Record<string, string>;
  isAdmin?: boolean;
  userFranchiseId?: string;
  isAuthenticated: boolean;
  ideaLocked?: boolean;
  onAddComment: (body: string, parentId?: string) => Promise<boolean>;
  onEditComment: (commentId: string, body: string) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  onCommentReaction?: (commentId: string, emoji: string) => void;
}) {
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editBody, setEditBody] = React.useState(comment.body);

  const isOwner = comment.author.franchiseId === userFranchiseId;
  const canModify = (isOwner || isAdmin) && !comment.deletedAt;
  const isDeleted = !!comment.deletedAt;
  const teamIcon = iconMap[comment.author.franchiseId];

  const handleReply = async (body: string) => {
    const ok = await onAddComment(body, comment.id);
    if (ok) setReplyOpen(false);
    return ok;
  };

  const handleSaveEdit = async () => {
    if (editBody.trim().length < 1) return;
    const ok = await onEditComment(comment.id, editBody.trim());
    if (ok) setEditing(false);
  };

  // Cap nesting depth for readability
  const maxDepth = 4;
  const effectiveDepth = Math.min(depth, maxDepth);

  return (
    <div className="sb-thread__node" style={{ marginLeft: effectiveDepth > 0 ? '1.5rem' : 0 }}>
      <div className={`sb-thread__comment${isDeleted ? ' sb-thread__comment--deleted' : ''}`}>
        <div className="sb-thread__header">
          <div className={`sb-thread__avatar${teamIcon ? ' sb-thread__avatar--has-icon' : ''}`}>
            {teamIcon ? (
              <img src={teamIcon} alt="" width="24" height="24" className="sb-thread__team-icon" />
            ) : (
              <span>{comment.author.teamName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <span className="sb-thread__author">{isDeleted ? '[deleted]' : comment.author.teamName}</span>
          <span className="sb-thread__time">{timeAgo(comment.createdAt)}</span>
          {comment.editedAt && !isDeleted && <span className="sb-thread__edited">(edited)</span>}
        </div>

        {editing ? (
          <div className="sb-thread__edit">
            <textarea
              className="sb-thread__edit-input"
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              rows={2}
              maxLength={3000}
            />
            <div className="sb-thread__edit-actions">
              <button className="sb-btn sb-btn--small" onClick={handleSaveEdit}>Save</button>
              <button className="sb-btn sb-btn--small sb-btn--ghost" onClick={() => { setEditing(false); setEditBody(comment.body); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="sb-thread__body">{comment.body}</div>
            {comment.images && comment.images.length > 0 && (
              <ImageGallery images={comment.images} />
            )}
          </>
        )}

        {/* Reactions on comment */}
        {!isDeleted && isAuthenticated && onCommentReaction && (
          <ReactionBar
            reactions={comment.reactions}
            userFranchiseId={userFranchiseId}
            teamNames={teamNameMap}
            onToggle={emoji => onCommentReaction(comment.id, emoji)}
          />
        )}

        {!isDeleted && !editing && (
          <div className="sb-thread__actions">
            {isAuthenticated && !ideaLocked && (
              <button className="sb-thread__action" onClick={() => setReplyOpen(!replyOpen)}>Reply</button>
            )}
            {canModify && (
              <>
                <button className="sb-thread__action" onClick={() => { setEditing(true); setEditBody(comment.body); }}>Edit</button>
                <button className="sb-thread__action sb-thread__action--danger" onClick={() => onDeleteComment(comment.id)}>Delete</button>
              </>
            )}
          </div>
        )}
      </div>

      {replyOpen && (
        <div className="sb-thread__reply" style={{ marginLeft: '1.5rem' }}>
          <CommentComposer
            onSubmit={handleReply}
            placeholder={`Reply to ${comment.author.teamName}...`}
            onCancel={() => setReplyOpen(false)}
          />
        </div>
      )}

      {comment.children.map(child => (
        <CommentNode
          key={child.id}
          comment={child}
          depth={depth + 1}
          iconMap={iconMap}
          teamNameMap={teamNameMap}
          isAdmin={isAdmin}
          userFranchiseId={userFranchiseId}
          isAuthenticated={isAuthenticated}
          ideaLocked={ideaLocked}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentReaction={onCommentReaction}
        />
      ))}
    </div>
  );
}

export default function CommentThread({
  comments,
  iconMap,
  teamNameMap,
  isAdmin,
  userFranchiseId,
  isAuthenticated,
  ideaLocked,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentReaction,
}: Props) {
  const tree = buildTree(comments);

  if (tree.length === 0) {
    return <div className="sb-thread__empty">No comments yet. Be the first to weigh in.</div>;
  }

  return (
    <div className="sb-thread">
      {tree.map(node => (
        <CommentNode
          key={node.id}
          comment={node}
          depth={0}
          iconMap={iconMap}
          teamNameMap={teamNameMap}
          isAdmin={isAdmin}
          userFranchiseId={userFranchiseId}
          isAuthenticated={isAuthenticated}
          ideaLocked={ideaLocked}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onCommentReaction={onCommentReaction}
        />
      ))}
    </div>
  );
}
