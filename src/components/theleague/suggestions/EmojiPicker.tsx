import React, { useState, useRef, useEffect } from 'react';

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Popular',
    emojis: ['👍', '👎', '🔥', '❤️', '😂', '🤔', '💯', '🎯', '👀', '🙌'],
  },
  {
    label: 'Reactions',
    emojis: ['✅', '❌', '⚠️', '💡', '🏆', '💰', '📈', '📉', '🤝', '💪'],
  },
  {
    label: 'Fun',
    emojis: ['😤', '🤡', '💀', '🧠', '👑', '🐐', '🎉', '🚀', '⭐', '🍿'],
  },
  {
    label: 'Sports',
    emojis: ['🏈', '🏆', '🥇', '🥈', '🥉', '📊', '🎯', '💎', '🔨', '⚡'],
  },
];

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Deduplicate across groups
  const allEmojis = EMOJI_GROUPS.flatMap(g => g.emojis);
  const uniqueEmojis = [...new Set(allEmojis)];

  return (
    <div className="sb-emoji-picker" ref={ref} role="dialog" aria-label="Pick an emoji">
      <div className="sb-emoji-picker__grid">
        {uniqueEmojis.map(emoji => (
          <button
            key={emoji}
            type="button"
            className="sb-emoji-picker__btn"
            onClick={() => { onSelect(emoji); onClose(); }}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
