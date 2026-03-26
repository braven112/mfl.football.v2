import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SCHEFTNER_REACTIONS } from '../../types/scheftner';

/** Human-readable emoji names for screen readers */
const EMOJI_LABELS: Record<string, string> = {
  '🔥': 'fire', '💰': 'money', '💩': 'poop', '🏆': 'trophy', '📉': 'down trend',
  '💯': 'hundred', '🤔': 'thinking', '😂': 'laughing', '📈': 'up trend', '💉': 'injection',
};

interface Props {
  postId: string;
  initialReactions?: Record<string, number>;
  initialUserReaction?: string | null;
  isAuthenticated?: boolean;
}

export default function ScheftnerReactionBar({
  postId,
  initialReactions = {},
  initialUserReaction = null,
  isAuthenticated = false,
}: Props) {
  const [reactions, setReactions] = useState<Record<string, number>>(initialReactions);
  const [userReaction, setUserReaction] = useState<string | null>(initialUserReaction);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fetch initial reaction state when component becomes visible
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scheftner-reactions?postId=${encodeURIComponent(postId)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        if (data.reactions) setReactions(data.reactions);
        if (data.userReaction !== undefined) setUserReaction(data.userReaction);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [postId]);

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
      const res = await fetch('/api/scheftner-reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, reaction: emoji }),
      });

      if (!res.ok) {
        setReactions(prevReactions);
        setUserReaction(prevUserReaction);
      } else {
        const data = await res.json();
        setReactions(data.reactions ?? {});
        setUserReaction(data.userReaction ?? null);
      }
    } catch {
      setReactions(prevReactions);
      setUserReaction(prevUserReaction);
    } finally {
      setLoading(false);
    }
  }, [postId, reactions, userReaction, isAuthenticated, loading]);

  const activeEmojis = SCHEFTNER_REACTIONS.filter(e => (reactions[e] ?? 0) > 0);
  const inactiveEmojis = SCHEFTNER_REACTIONS.filter(e => !activeEmojis.includes(e));

  return (
    <div className="sf-reactions">
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
            <div ref={pickerRef} className="sf-reaction-picker" role="group" aria-label="Choose a reaction">
              {[...inactiveEmojis, ...activeEmojis].map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  className={`sf-reaction-picker__btn${emoji === userReaction ? ' sf-reaction-picker__btn--active' : ''}`}
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
