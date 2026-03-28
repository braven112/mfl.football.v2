/**
 * ScheftnerReplyThread — Interactive reply thread for feed posts.
 *
 * Renders as a collapsible thread below each post. Owners reply with
 * their team icon as avatar. AI characters (Claude Schefter / Ask Roger)
 * respond in real-time via Haiku.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { ScheftnerReply } from '../../types/scheftner-replies';

interface Props {
  postId: string;
  postHeadline: string;
  postAuthorId?: string;
  isAuthenticated: boolean;
  userFranchiseId?: string;
  userTeamName?: string;
  userTeamIcon?: string;
}

function formatRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const CHAT_ICON = (
  <svg className="sfc-reply-toggle__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export default function ScheftnerReplyThread({
  postId,
  postHeadline,
  postAuthorId,
  isAuthenticated,
  userFranchiseId,
  userTeamName,
  userTeamIcon,
}: Props) {
  const isRogerPost = postAuthorId === 'roger';
  const defaultAiName = isRogerPost ? 'Ask Roger' : 'Claude Schefter';
  const defaultAiAvatar = isRogerPost ? '/assets/commissioner-avatar.webp' : '/assets/claude-schefter-avatar.webp';

  const [replies, setReplies] = useState<ScheftnerReply[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [aiTypingName, setAiTypingName] = useState(defaultAiName);
  const [aiTypingAvatar, setAiTypingAvatar] = useState(defaultAiAvatar);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const repliesRegionRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Fetch replies on mount so count badge shows immediately
  const fetchReplies = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheftner-replies/${postId}`);
      if (res.ok) {
        const data = await res.json();
        setReplies(data.replies ?? []);
      }
    } catch {
      // Silently fail — replies are supplementary
    }
    setLoaded(true);
  }, [postId]);

  useEffect(() => {
    fetchReplies();
  }, [fetchReplies]);

  const toggleExpanded = () => {
    setIsExpanded(prev => !prev);
  };

  const handleSubmit = async () => {
    const body = inputValue.trim();
    if (!body || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    // Optimistic insert
    const tempId = `temp-${Date.now()}`;
    const optimisticReply: ScheftnerReply = {
      id: tempId,
      postId,
      parentId: null,
      body,
      author: {
        type: 'owner',
        franchiseId: userFranchiseId,
        name: userTeamName ?? 'My Team',
        avatar: userTeamIcon ?? '',
      },
      createdAt: new Date().toISOString(),
    };

    setReplies(prev => [...prev, optimisticReply]);
    setInputValue('');

    try {
      // 1. Submit user reply
      const replyRes = await fetch(`/api/scheftner-replies/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });

      if (!replyRes.ok) {
        const err = await replyRes.json().catch(() => ({ error: 'Failed to post reply' }));
        throw new Error(err.error);
      }

      const { reply: savedReply } = await replyRes.json();

      // Replace optimistic reply with server reply
      setReplies(prev => prev.map(r => r.id === tempId ? savedReply : r));

      // 2. Trigger AI reply — show typing indicator with pre-resolved character
      setAiTypingName(defaultAiName);
      setAiTypingAvatar(defaultAiAvatar);
      setAiTyping(true);

      const aiRes = await fetch(`/api/scheftner-replies/${postId}/ai-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userReplyId: savedReply.id }),
      });

      if (aiRes.ok) {
        const { reply: aiReply } = await aiRes.json();
        setReplies(prev => [...prev, aiReply]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post reply';
      setError(msg);
      // Remove optimistic reply on failure
      setReplies(prev => prev.filter(r => r.id !== tempId));
    } finally {
      setIsSubmitting(false);
      setAiTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsExpanded(false);
      toggleRef.current?.focus();
    }
  };

  const handleRegionKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsExpanded(false);
      toggleRef.current?.focus();
    }
  };

  const replyCount = replies.length;

  return (
    <div className="sfc-reply-thread">
      <button
        ref={toggleRef}
        className="sfc-reply-toggle"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        aria-controls={`replies-${postId}`}
        aria-label={isExpanded ? 'Hide replies' : `Show replies${replyCount > 0 ? ` (${replyCount})` : ''}`}
      >
        {CHAT_ICON}
        {replyCount > 0 && (
          <span className="sfc-reply-toggle__count">{replyCount}</span>
        )}
      </button>

      {isExpanded && (
        <div
          id={`replies-${postId}`}
          className="sfc-replies"
          role="region"
          aria-label="Replies to this post"
          ref={repliesRegionRef}
          onKeyDown={handleRegionKeyDown}
        >
          {/* Reply list */}
          <div aria-live="polite" aria-relevant="additions" aria-atomic="false">
            {replies.map(reply => (
              <div
                key={reply.id}
                className={`sfc-reply${reply.author.type === 'ai' ? ` sfc-reply--ai${reply.author.aiCharacter === 'roger' ? ' sfc-reply--roger' : ''}` : ' sfc-reply--owner'}`}
              >
                <img
                  className="sfc-reply__avatar"
                  src={reply.author.avatar}
                  alt=""
                  width="24"
                  height="24"
                  loading="lazy"
                />
                <div className="sfc-reply__content">
                  <div className="sfc-reply__header">
                    <span className="sfc-reply__name">{reply.author.name}</span>
                    {reply.author.handle && (
                      <span className="sfc-reply__handle">{reply.author.handle}</span>
                    )}
                    <time className="sfc-reply__time" dateTime={reply.createdAt}>
                      {formatRelTime(reply.createdAt)}
                    </time>
                  </div>
                  <div className="sfc-reply__body">{reply.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Typing indicator */}
          {aiTyping && (
            <div className="sfc-typing" role="status" aria-live="polite">
              <img
                className="sfc-reply__avatar"
                src={aiTypingAvatar}
                alt=""
                width="24"
                height="24"
              />
              <div className="sfc-typing__content">
                <span className="sfc-typing__text">{aiTypingName} is typing</span>
                <span className="sfc-typing__dots" aria-hidden="true">
                  <span className="sfc-typing__dot" />
                  <span className="sfc-typing__dot" />
                  <span className="sfc-typing__dot" />
                </span>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="sfc-reply-error" role="alert" style={{
              fontSize: '0.75rem',
              color: 'var(--color-error, #dc2626)',
              padding: '0.25rem 0',
            }}>
              {error}
            </div>
          )}

          {/* Composer */}
          {isAuthenticated && (
            <div className="sfc-composer">
              {userTeamIcon && (
                <img
                  className="sfc-reply__avatar"
                  src={userTeamIcon}
                  alt=""
                  width="24"
                  height="24"
                />
              )}
              <textarea
                ref={textareaRef}
                className="sfc-composer__input"
                placeholder="Reply..."
                aria-label="Write a reply to this post. Press Ctrl+Enter to submit."
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={500}
                disabled={isSubmitting}
              />
              <button
                className="sfc-composer__submit"
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isSubmitting}
                aria-label="Submit reply"
              >
                {isSubmitting ? '...' : 'Reply'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
