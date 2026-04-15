import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SCHEFTER_REACTIONS } from '../../types/schefter';

/** Human-readable emoji names for screen readers */
const EMOJI_LABELS: Record<string, string> = {
  '❤️': 'like', '🔥': 'fire', '💰': 'money', '💩': 'poop', '🏆': 'trophy',
  '📉': 'down trend', '💯': 'hundred', '🤔': 'thinking', '😂': 'laughing',
  '📈': 'up trend', '💉': 'injection',
};

/** The primary "like" emoji — always visible */
const LIKE_EMOJI = '❤️';

interface Props {
  postId: string;
  initialReactions?: Record<string, number>;
  initialUserReaction?: string | null;
  isAuthenticated?: boolean;
  /** Base reactions that persist even after fetch (e.g. GroupMe likes) */
  baseReactions?: Record<string, number>;
}

export default function SchefterReactionBar({
  postId,
  initialReactions = {},
  initialUserReaction = null,
  isAuthenticated = false,
  baseReactions = {},
}: Props) {
  const [reactions, setReactions] = useState<Record<string, number>>(() => {
    // Merge base reactions (e.g. GroupMe likes) into initial state
    const merged = { ...initialReactions };
    for (const [emoji, count] of Object.entries(baseReactions)) {
      merged[emoji] = (merged[emoji] ?? 0) + count;
    }
    return merged;
  });
  const [userReaction, setUserReaction] = useState<string | null>(initialUserReaction);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Merge base reactions (e.g. GroupMe likes) into fetched site reactions
  const mergeWithBase = useCallback((fetched: Record<string, number>) => {
    if (!baseReactions || Object.keys(baseReactions).length === 0) return fetched;
    const merged = { ...fetched };
    for (const [emoji, count] of Object.entries(baseReactions)) {
      merged[emoji] = (merged[emoji] ?? 0) + count;
    }
    return merged;
  }, [baseReactions]);

  // Fetch initial reaction state when component becomes visible
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schefter-reactions?postId=${encodeURIComponent(postId)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        if (data.reactions) setReactions(mergeWithBase(data.reactions));
        if (data.userReaction !== undefined) setUserReaction(data.userReaction);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [postId, mergeWithBase]);

  // Close picker on Escape and click-outside
  useEffect(() => {
    if (!pickerOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [pickerOpen]);

  // Focus first picker button when opened
  useEffect(() => {
    if (pickerOpen) {
      const firstBtn = pickerRef.current?.querySelector('button') as HTMLButtonElement | null;
      firstBtn?.focus();
    }
  }, [pickerOpen]);

  const handleToggle = useCallback(async (emoji: string) => {
    if (!isAuthenticated || loading) return;

    const prevReactions = { ...reactions };
    const prevUserReaction = userReaction;
    const newReactions = { ...reactions };

    if (userReaction) {
      newReactions[userReaction] = Math.max(0, (newReactions[userReaction] ?? 1) - 1);
      if (newReactions[userReaction] === 0) delete newReactions[userReaction];
    }

    const newUserReaction = emoji === userReaction ? null : emoji;
    if (newUserReaction) {
      newReactions[newUserReaction] = (newReactions[newUserReaction] ?? 0) + 1;
    }

    setReactions(newReactions);
    setUserReaction(newUserReaction);
    setLoading(true);

    try {
      const res = await fetch('/api/schefter-reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, reaction: emoji }),
      });

      if (!res.ok) {
        setReactions(prevReactions);
        setUserReaction(prevUserReaction);
      } else {
        const data = await res.json();
        setReactions(mergeWithBase(data.reactions ?? {}));
        setUserReaction(data.userReaction ?? null);
      }
    } catch {
      setReactions(prevReactions);
      setUserReaction(prevUserReaction);
    } finally {
      setLoading(false);
    }
  }, [postId, reactions, userReaction, isAuthenticated, loading, mergeWithBase]);

  const likeCount = reactions[LIKE_EMOJI] ?? 0;
  const isLiked = userReaction === LIKE_EMOJI;

  // Other active emojis (excluding like, which has its own button)
  const activeEmojis = SCHEFTER_REACTIONS.filter(e => e !== LIKE_EMOJI && (reactions[e] ?? 0) > 0);
  // Picker shows all non-like emojis
  const pickerEmojis = SCHEFTER_REACTIONS.filter(e => e !== LIKE_EMOJI);

  return (
    <div className="sf-reactions">
      {/* Like button — always visible */}
      <button
        type="button"
        className={`sf-reaction-like${isLiked ? ' sf-reaction-like--active' : ''}`}
        onClick={() => handleToggle(LIKE_EMOJI)}
        disabled={!isAuthenticated || loading}
        aria-label={`Like, ${likeCount} like${likeCount === 1 ? '' : 's'}`}
        aria-pressed={isLiked}
      >
        <svg className="sf-reaction-like__icon" width="16" height="16" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        {likeCount > 0 && <span className="sf-reaction-like__count">{likeCount}</span>}
      </button>

      {/* Other active emoji reactions */}
      {activeEmojis.map(emoji => (
        <button
          key={emoji}
          type="button"
          className={`sf-reaction-pill${emoji === userReaction ? ' sf-reaction-pill--active' : ''}`}
          onClick={() => handleToggle(emoji)}
          disabled={!isAuthenticated || loading}
          aria-label={`${EMOJI_LABELS[emoji] ?? emoji}, ${reactions[emoji]} reaction${reactions[emoji] === 1 ? '' : 's'}`}
          aria-pressed={emoji === userReaction}
        >
          <span className="sf-reaction-pill__emoji" aria-hidden="true">{emoji}</span>
          <span className="sf-reaction-pill__count">{reactions[emoji]}</span>
        </button>
      ))}

      {/* Emoji picker for additional reactions */}
      {isAuthenticated && (
        <div className="sf-reaction-add-wrap">
          <button
            ref={triggerRef}
            type="button"
            className="sf-reaction-add"
            onClick={() => setPickerOpen(!pickerOpen)}
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
            aria-haspopup="true"
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
            <div
              ref={pickerRef}
              className="sf-reaction-picker"
              role="toolbar"
              aria-label="Choose a reaction"
              onKeyDown={(e) => {
                const btns = Array.from(pickerRef.current?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
                const idx = btns.indexOf(e.target as HTMLButtonElement);
                if (idx === -1) return;
                let next = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % btns.length;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + btns.length) % btns.length;
                if (next >= 0) { e.preventDefault(); btns[next].focus(); }
              }}
            >
              {pickerEmojis.map((emoji, i) => (
                <button
                  key={emoji}
                  type="button"
                  className={`sf-reaction-picker__btn${emoji === userReaction ? ' sf-reaction-picker__btn--active' : ''}`}
                  tabIndex={i === 0 ? 0 : -1}
                  onClick={() => {
                    handleToggle(emoji);
                    setPickerOpen(false);
                    triggerRef.current?.focus();
                  }}
                  aria-label={EMOJI_LABELS[emoji] ?? emoji}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
