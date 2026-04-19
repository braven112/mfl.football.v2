/**
 * DraftChatPanel
 * Real-time chat for the draft room powered by PartyKit WebSockets.
 *
 * Features:
 *   - Chat messages with franchise identity
 *   - @mention autocomplete from team list
 *   - GIF search via Giphy (proxied through /api/suggestions/gif-search)
 *   - Emoji reactions (👍 🔥 😂 💀) on messages
 *   - Pick announcements auto-posted by DraftRoom
 *   - Message history on connect (PartyKit room storage)
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type PartySocket from 'partysocket';
import type {
  ChatMessage,
  DraftRoomTeam,
  DraftGif,
} from '../../../types/draft-room';
import { REACTION_EMOJIS } from '../../../types/draft-room';

// ── Props ─────────────────────────────────────────────────────────────────────

interface DraftChatPanelProps {
  partyHost: string;
  roomId: string;
  /** The signed-in owner's franchise ID */
  franchiseId: string;
  franchiseName: string;
  franchiseIcon: string;
  teams: DraftRoomTeam[];
  /** Messages come from the reducer (broadcasted + history) */
  messages: ChatMessage[];
  connected: boolean;
  onMessage: (msg: ChatMessage) => void;
  onReaction: (messageId: string, emoji: string, reactions: Record<string, string[]>) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onHistory: (messages: ChatMessage[]) => void;
}

// ── GIF search via existing Giphy route ──────────────────────────────────────

async function searchGifs(query: string): Promise<DraftGif[]> {
  try {
    const res = await fetch(`/api/suggestions/gif-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json() as { results: { id: string; url: string; preview: string; alt: string }[] };
    return (data.results || []).map((r) => ({
      id: r.id,
      title: r.alt,
      previewUrl: r.preview,
      fullUrl: r.url,
    }));
  } catch {
    return [];
  }
}

// ── Message ID generator ──────────────────────────────────────────────────────

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Mention parser ────────────────────────────────────────────────────────────

/**
 * Render message text with @mentions highlighted.
 */
function renderTextWithMentions(text: string, teams: DraftRoomTeam[]): React.ReactNode[] {
  const names = teams.map((t) => t.nameShort || t.name);
  // Build a regex that matches @AnyTeamName
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return [text];

  const pattern = new RegExp(`(@(?:${escaped.join('|')}))`, 'g');
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (part.startsWith('@') && names.some((n) => part === `@${n}`)) {
      return (
        <strong
          key={i}
          style={{ color: 'var(--dr-chat-mention-color, #1c497c)', fontWeight: 600 }}
        >
          {part}
        </strong>
      );
    }
    return part;
  });
}

// ── Timestamp formatter ───────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── GIF Picker ────────────────────────────────────────────────────────────────

interface GifPickerProps {
  onSelect: (gif: DraftGif) => void;
  onClose: () => void;
}

function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DraftGif[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const gifs = await searchGifs(query);
      setResults(gifs);
      setLoading(false);
    }, 350);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 0.5rem)',
        left: 0,
        right: 0,
        background: 'var(--dr-chat-bg, #ffffff)',
        border: '1px solid var(--dr-chat-border, #e2e8f0)',
        borderRadius: 'var(--radius-md, 0.5rem)',
        boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15))',
        zIndex: 20,
        overflow: 'hidden',
        maxHeight: '280px',
        display: 'flex',
        flexDirection: 'column',
      }}
      role="dialog"
      aria-label="GIF search"
    >
      <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--dr-chat-border, #e2e8f0)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="search"
          placeholder="Search GIFs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="dr-gif-search-input"
          style={{
            flex: 1,
            padding: '0.375rem 0.5rem',
            border: '1px solid var(--dr-chat-input-border, #e2e8f0)',
            borderRadius: 'var(--radius-sm, 0.25rem)',
            fontSize: '0.8125rem',
            background: 'var(--dr-chat-input-bg, #f9fafb)',
          }}
        />
        <button
          onClick={onClose}
          aria-label="Close GIF picker"
          className="dr-gif-close-btn"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--color-gray-400, #9ca3af)', fontSize: '1rem', lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0.375rem' }}>
        {loading ? (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-gray-400, #9ca3af)' }}>
            Searching…
          </div>
        ) : results.length === 0 && query ? (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-gray-400, #9ca3af)' }}>
            No GIFs found
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.25rem' }}>
            {results.map((gif) => (
              <button
                key={gif.id}
                onClick={() => onSelect(gif)}
                title={gif.title}
                className="dr-gif-result-btn"
                style={{
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  borderRadius: 'var(--dr-chat-gif-radius, 0.5rem)',
                  overflow: 'hidden',
                  aspectRatio: '16/9',
                }}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mention Autocomplete ──────────────────────────────────────────────────────

interface MentionSuggestionsProps {
  suggestions: DraftRoomTeam[];
  onSelect: (name: string) => void;
}

function MentionSuggestions({ suggestions, onSelect }: MentionSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 0.25rem)',
        left: 0,
        right: 0,
        background: 'var(--dr-chat-bg, #ffffff)',
        border: '1px solid var(--dr-chat-border, #e2e8f0)',
        borderRadius: 'var(--radius-sm, 0.25rem)',
        boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1))',
        zIndex: 15,
        overflow: 'hidden',
        maxHeight: '160px',
        overflowY: 'auto',
      }}
      role="listbox"
      aria-label="@mention suggestions"
    >
      {suggestions.map((team) => (
        <button
          key={team.franchiseId}
          role="option"
          onClick={() => onSelect(team.nameShort || team.name)}
          className="dr-mention-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            width: '100%',
            padding: '0.375rem 0.625rem',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '0.8125rem',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-gray-50, #f9fafb)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        >
          {team.icon && (
            <img src={team.icon} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          )}
          <span style={{ fontWeight: 600, color: 'var(--color-gray-900, #111827)' }}>@{team.nameShort || team.name}</span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-gray-400, #9ca3af)' }}>{team.abbrev}</span>
        </button>
      ))}
    </div>
  );
}

// ── Single Message ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage;
  isOwn: boolean;
  teams: DraftRoomTeam[];
  onReact: (messageId: string, emoji: string) => void;
  franchiseId: string;
}

function MessageBubble({ msg, isOwn, teams, onReact, franchiseId }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);

  if (msg.type === 'system') {
    return (
      <div style={{
        textAlign: 'center',
        padding: '0.25rem 0.5rem',
        fontSize: '0.6875rem',
        color: 'var(--dr-chat-system-text, #9ca3af)',
        fontStyle: 'italic',
      }}>
        {msg.text}
      </div>
    );
  }

  if (msg.type === 'pick') {
    return (
      <div style={{
        margin: '0.375rem 0.625rem',
        padding: '0.5rem 0.75rem',
        background: 'var(--dr-chat-pick-bg, rgba(28, 73, 124, 0.05))',
        borderLeft: '3px solid var(--dr-chat-pick-border, #1c497c)',
        borderRadius: '0 var(--radius-sm, 0.25rem) var(--radius-sm, 0.25rem) 0',
        fontSize: '0.75rem',
      }}>
        <div style={{ fontWeight: 700, color: 'var(--color-primary, #1c497c)', fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.125rem' }}>
          📋 Pick Made
        </div>
        <div style={{ color: 'var(--color-gray-800, #1f2937)', fontWeight: 500 }}>{msg.text}</div>
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <ReactionRow reactions={msg.reactions} messageId={msg.id} onReact={onReact} franchiseId={franchiseId} />
        )}
      </div>
    );
  }

  // Regular chat message
  const bubbleBg = isOwn
    ? 'var(--dr-chat-bubble-user-bg, #1c497c)'
    : 'var(--dr-chat-bubble-other-bg, #f3f4f6)';
  const bubbleText = isOwn
    ? 'var(--dr-chat-bubble-user-text, #ffffff)'
    : 'var(--dr-chat-bubble-other-text, #111827)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: '0.375rem',
        padding: '0.25rem 0.625rem',
      }}
      onMouseEnter={() => setShowReactions(true)}
      onMouseLeave={() => setShowReactions(false)}
    >
      {/* Avatar (other side only) */}
      {!isOwn && (
        <img
          src={msg.senderIcon || '/assets/icons/default-team.svg'}
          alt={msg.senderName}
          title={msg.senderName}
          style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginBottom: 2 }}
        />
      )}

      <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start', gap: '0.125rem' }}>
        {/* Sender name (other side only) */}
        {!isOwn && (
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-gray-500, #6b7280)', paddingLeft: '0.375rem' }}>
            {msg.senderName}
          </span>
        )}

        {/* Bubble */}
        <div
          style={{
            background: bubbleBg,
            color: bubbleText,
            padding: '0.4375rem 0.625rem',
            borderRadius: isOwn
              ? '1rem 1rem 0.25rem 1rem'
              : '1rem 1rem 1rem 0.25rem',
            fontSize: '0.8125rem',
            lineHeight: 1.4,
            wordBreak: 'break-word',
            position: 'relative',
          }}
        >
          {renderTextWithMentions(msg.text, teams)}
          {msg.gifUrl && (
            <div style={{ marginTop: '0.375rem' }}>
              <img
                src={msg.gifUrl}
                alt="GIF"
                loading="lazy"
                style={{
                  maxWidth: '100%',
                  borderRadius: 'var(--dr-chat-gif-radius, 0.5rem)',
                  display: 'block',
                }}
              />
            </div>
          )}
        </div>

        {/* Reactions row */}
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <ReactionRow reactions={msg.reactions} messageId={msg.id} onReact={onReact} franchiseId={franchiseId} />
        )}

        {/* Timestamp + react button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', paddingLeft: isOwn ? 0 : '0.25rem', paddingRight: isOwn ? '0.25rem' : 0 }}>
          <span style={{ fontSize: '0.5625rem', color: 'var(--color-gray-400, #9ca3af)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(msg.timestamp)}
          </span>
          {showReactions && (
            <div style={{ display: 'flex', gap: '0.125rem' }}>
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => onReact(msg.id, emoji)}
                  title={`React ${emoji}`}
                  className="dr-reaction-quick-btn"
                  style={{
                    background: 'var(--dr-chat-reaction-bg, #f3f4f6)',
                    border: 'none',
                    borderRadius: 'var(--radius-full, 9999px)',
                    padding: '0.0625rem 0.25rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    lineHeight: 1.4,
                    transition: 'transform 0.1s ease',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.2)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reaction Row ──────────────────────────────────────────────────────────────

interface ReactionRowProps {
  reactions: Record<string, string[]>;
  messageId: string;
  onReact: (messageId: string, emoji: string) => void;
  franchiseId: string;
}

function ReactionRow({ reactions, messageId, onReact, franchiseId }: ReactionRowProps) {
  const entries = Object.entries(reactions).filter(([, senders]) => senders.length > 0);
  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.125rem' }}>
      {entries.map(([emoji, senders]) => {
        const hasReacted = senders.includes(franchiseId);
        return (
          <button
            key={emoji}
            onClick={() => onReact(messageId, emoji)}
            title={`${senders.length} reaction${senders.length !== 1 ? 's' : ''}`}
            className="dr-reaction-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.125rem 0.375rem',
              borderRadius: 'var(--radius-full, 9999px)',
              border: hasReacted
                ? '1px solid var(--dr-chat-reaction-active-border, #1c497c)'
                : '1px solid var(--dr-chat-border, #e2e8f0)',
              background: hasReacted
                ? 'var(--dr-chat-reaction-active-bg, rgba(28, 73, 124, 0.1))'
                : 'var(--dr-chat-reaction-bg, #f3f4f6)',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: hasReacted ? 700 : 400,
            }}
          >
            <span>{emoji}</span>
            <span style={{ fontSize: '0.625rem', color: 'var(--color-gray-600, #4b5563)' }}>{senders.length}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function DraftChatPanel({
  partyHost,
  roomId,
  franchiseId,
  franchiseName,
  franchiseIcon,
  teams,
  messages,
  connected,
  onMessage,
  onReaction,
  onConnected,
  onDisconnected,
  onHistory,
}: DraftChatPanelProps) {
  const [text, setText] = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSuggestions, setMentionSuggestions] = useState<DraftRoomTeam[]>([]);
  const socketRef = useRef<PartySocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottomRef = useRef(true);

  // ── WebSocket setup ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!partyHost || !roomId) return;

    let cancelled = false;
    let socket: PartySocket | null = null;

    // Dynamic import defers partysocket (~12 KB) until chat actually mounts.
    import('partysocket').then((mod) => {
      if (cancelled) return;
      const PartySocketCtor = mod.default;

      const params = new URLSearchParams({
        franchiseId,
        name: franchiseName,
        icon: franchiseIcon,
      });

      socket = new PartySocketCtor({
        host: partyHost,
        room: roomId,
        query: Object.fromEntries(params),
      });

      socket.addEventListener('open', () => onConnected());
      socket.addEventListener('close', () => onDisconnected());

      socket.addEventListener('message', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data as string);
          if (data.type === '__history') {
            onHistory(data.messages || []);
            return;
          }
          if (data.type === 'reaction') {
            onReaction(data.targetId, data.emoji, data.reactions || {});
            return;
          }
          onMessage(data as ChatMessage);
        } catch {
          // ignore malformed messages
        }
      });

      socketRef.current = socket;
    });

    return () => {
      cancelled = true;
      if (socket) socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyHost, roomId, franchiseId]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // ── Mention detection ──────────────────────────────────────────────────────

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @mention being typed
    const cursor = e.target.selectionStart;
    const textUpToCursor = val.slice(0, cursor);
    const mentionMatch = textUpToCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      setMentionQuery(query);
      const suggestions = teams.filter((t) =>
        (t.nameShort || t.name).toLowerCase().startsWith(query) ||
        t.abbrev.toLowerCase().startsWith(query)
      ).slice(0, 5);
      setMentionSuggestions(suggestions);
    } else {
      setMentionSuggestions([]);
      setMentionQuery('');
    }
  }, [teams]);

  const handleMentionSelect = useCallback((name: string) => {
    const cursor = inputRef.current?.selectionStart || text.length;
    const textUpToCursor = text.slice(0, cursor);
    const mentionMatch = textUpToCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      const before = textUpToCursor.slice(0, textUpToCursor.lastIndexOf('@'));
      const after = text.slice(cursor);
      setText(`${before}@${name} ${after}`);
    }

    setMentionSuggestions([]);
    setMentionQuery('');
    inputRef.current?.focus();
  }, [text]);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback((gifUrl?: string) => {
    const trimmed = text.trim();
    if (!trimmed && !gifUrl) return;
    if (!socketRef.current) return;

    const msg: ChatMessage = {
      id: makeId(),
      type: 'chat',
      senderId: franchiseId,
      senderName: franchiseName,
      senderIcon: franchiseIcon,
      text: trimmed,
      timestamp: Date.now(),
      gifUrl,
    };

    socketRef.current.send(JSON.stringify(msg));
    setText('');
    setShowGifPicker(false);
  }, [text, franchiseId, franchiseName, franchiseIcon]);

  const handleGifSelect = useCallback((gif: DraftGif) => {
    sendMessage(gif.fullUrl);
  }, [sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mentionSuggestions.length > 0) {
        handleMentionSelect(mentionSuggestions[0].nameShort || mentionSuggestions[0].name);
        return;
      }
      sendMessage();
    }
    if (e.key === 'Escape') {
      setMentionSuggestions([]);
      setShowGifPicker(false);
    }
  }, [sendMessage, mentionSuggestions, handleMentionSelect]);

  // ── React to message ───────────────────────────────────────────────────────

  const handleReact = useCallback((messageId: string, emoji: string) => {
    if (!socketRef.current) return;

    const msg: ChatMessage = {
      id: makeId(),
      type: 'reaction',
      senderId: franchiseId,
      senderName: franchiseName,
      senderIcon: franchiseIcon,
      text: '',
      timestamp: Date.now(),
      emoji,
      targetId: messageId,
    };

    socketRef.current.send(JSON.stringify(msg));
  }, [franchiseId, franchiseName, franchiseIcon]);

  // ── Expose send for external pick announcements ────────────────────────────

  // Allow DraftRoom to call sendPickAnnouncement via a stable ref
  const sendPickRef = useRef<((text: string) => void) | null>(null);
  sendPickRef.current = useCallback((pickText: string) => {
    if (!socketRef.current) return;
    const msg: ChatMessage = {
      id: makeId(),
      type: 'pick',
      senderId: 'system',
      senderName: 'Draft',
      senderIcon: '',
      text: pickText,
      timestamp: Date.now(),
    };
    socketRef.current.send(JSON.stringify(msg));
  }, []);

  // Expose sendPick via window for DraftRoom to call (avoids prop drilling)
  useEffect(() => {
    (window as any).__draftChatSendPick = (text: string) => sendPickRef.current?.(text);
    return () => { delete (window as any).__draftChatSendPick; };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isConnected = connected;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--dr-chat-bg, #ffffff)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--dr-chat-border, #e2e8f0)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-gray-900, #111827)',
          paddingLeft: '0.625rem',
          borderLeft: '2px solid var(--color-primary, #1c497c)',
          lineHeight: 1.4,
        }}>
          Chat
        </span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          fontSize: '0.625rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: isConnected ? 'var(--color-success, #16a34a)' : 'var(--color-gray-400, #9ca3af)',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isConnected ? 'var(--color-success, #16a34a)' : 'var(--color-gray-300, #d1d5db)',
            flexShrink: 0,
          }} />
          {isConnected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: 'auto', paddingTop: '0.375rem', paddingBottom: '0.375rem' }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 && (
          <div style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'var(--color-gray-400, #9ca3af)',
            fontSize: '0.8125rem',
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💬</div>
            No messages yet. Say something!
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isOwn={msg.senderId === franchiseId}
            teams={teams}
            onReact={handleReact}
            franchiseId={franchiseId}
          />
        ))}
      </div>

      {/* Input area */}
      <div style={{
        borderTop: '1px solid var(--dr-chat-border, #e2e8f0)',
        padding: '0.5rem 0.625rem',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* Mention suggestions */}
        {mentionSuggestions.length > 0 && (
          <MentionSuggestions suggestions={mentionSuggestions} onSelect={handleMentionSelect} />
        )}

        {/* GIF picker */}
        {showGifPicker && (
          <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
        )}

        <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'flex-end' }}>
          {/* GIF button */}
          <button
            onClick={() => setShowGifPicker((v) => !v)}
            title="Add GIF"
            aria-label="Open GIF picker"
            className="dr-gif-btn"
            style={{
              flexShrink: 0,
              padding: '0.375rem 0.5rem',
              border: '1px solid var(--dr-chat-input-border, #e2e8f0)',
              borderRadius: 'var(--radius-sm, 0.25rem)',
              background: showGifPicker ? 'var(--color-primary, #1c497c)' : 'var(--dr-chat-input-bg, #f9fafb)',
              color: showGifPicker ? '#ffffff' : 'var(--color-gray-500, #6b7280)',
              fontSize: '0.625rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              lineHeight: 1.4,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            GIF
          </button>

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Message… (@mention a team)"
            rows={1}
            disabled={!isConnected}
            aria-label="Chat message"
            className="dr-chat-input"
            style={{
              flex: 1,
              padding: '0.375rem 0.5rem',
              border: '1px solid var(--dr-chat-input-border, #e2e8f0)',
              borderRadius: 'var(--radius-sm, 0.25rem)',
              fontSize: '0.8125rem',
              background: 'var(--dr-chat-input-bg, #f9fafb)',
              resize: 'none',
              lineHeight: 1.5,
              maxHeight: '6rem',
              overflowY: 'auto',
              fontFamily: 'inherit',
              color: 'var(--color-gray-900, #111827)',
            }}
          />

          {/* Send button */}
          <button
            onClick={() => sendMessage()}
            disabled={!text.trim() || !isConnected}
            aria-label="Send message"
            className="dr-send-btn"
            style={{
              flexShrink: 0,
              padding: '0.375rem 0.625rem',
              border: 'none',
              borderRadius: 'var(--radius-sm, 0.25rem)',
              background: text.trim() && isConnected ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-200, #e5e7eb)',
              color: text.trim() && isConnected ? '#ffffff' : 'var(--color-gray-400, #9ca3af)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: text.trim() && isConnected ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Utility for DraftRoom to broadcast a pick announcement to chat.
 * Called via window.__draftChatSendPick if panel is mounted.
 */
export function broadcastPickToChat(text: string): void {
  (window as any).__draftChatSendPick?.(text);
}
