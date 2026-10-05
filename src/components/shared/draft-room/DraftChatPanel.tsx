/**
 * DraftChatPanel
 * Real-time chat for the draft room powered by PartyKit WebSockets.
 *
 * Features:
 *   - Chat messages with franchise identity
 *   - @mention autocomplete from team list
 *   - GIF search via Giphy (proxied through /api/suggestions/gif-search)
 *   - Emoji reactions on messages
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

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function renderTextWithMentions(text: string, teams: DraftRoomTeam[]): React.ReactNode[] {
  const names = teams.map((t) => t.nameShort || t.name);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return [text];

  const pattern = new RegExp(`(@(?:${escaped.join('|')}))`, 'g');
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (part.startsWith('@') && names.some((n) => part === `@${n}`)) {
      return <strong key={i} className="dr-msg__mention">{part}</strong>;
    }
    return part;
  });
}

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
    <div className="dr-gif-picker" role="dialog" aria-label="GIF search">
      <div className="dr-gif-picker__header">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search GIFs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="dr-gif-search-input"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="dr-gif-close-btn"
        >
          ✕
        </button>
      </div>

      <div className="dr-gif-picker__body">
        {loading ? (
          <div className="dr-gif-picker__status">Searching…</div>
        ) : results.length === 0 && query ? (
          <div className="dr-gif-picker__status">No GIFs found</div>
        ) : (
          <div className="dr-gif-grid">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                title={gif.title}
                className="dr-gif-result-btn"
              >
                <img src={gif.previewUrl} alt={gif.title} loading="lazy" />
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
    <div className="dr-mention-list" role="listbox" aria-label="@mention suggestions">
      {suggestions.map((team) => (
        <button
          key={team.franchiseId}
          type="button"
          role="option"
          onClick={() => onSelect(team.nameShort || team.name)}
          className="dr-mention-btn"
        >
          {team.icon && (
            <img src={team.icon} alt="" className="dr-mention-btn__avatar" />
          )}
          <span className="dr-mention-btn__name">@{team.nameShort || team.name}</span>
          <span className="dr-mention-btn__abbrev">{team.abbrev}</span>
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
    return <div className="dr-msg-system">{msg.text}</div>;
  }

  if (msg.type === 'pick') {
    return (
      <div className="dr-msg-pick">
        <div className="dr-msg-pick__label">📋 Pick Made</div>
        <div className="dr-msg-pick__text">{msg.text}</div>
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <ReactionRow reactions={msg.reactions} messageId={msg.id} onReact={onReact} franchiseId={franchiseId} />
        )}
      </div>
    );
  }

  return (
    <div
      className="dr-msg"
      data-own={isOwn ? 'true' : undefined}
      onMouseEnter={() => setShowReactions(true)}
      onMouseLeave={() => setShowReactions(false)}
    >
      {!isOwn && (
        <img
          src={msg.senderIcon || '/assets/icons/default-team.svg'}
          alt={msg.senderName}
          title={msg.senderName}
          className="dr-msg__avatar"
        />
      )}

      <div className="dr-msg__column">
        {!isOwn && <span className="dr-msg__sender">{msg.senderName}</span>}

        <div className="dr-msg__bubble">
          {renderTextWithMentions(msg.text, teams)}
          {msg.gifUrl && (
            <div className="dr-msg__gif-wrap">
              <img src={msg.gifUrl} alt="GIF" loading="lazy" className="dr-msg__gif" />
            </div>
          )}
        </div>

        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <ReactionRow reactions={msg.reactions} messageId={msg.id} onReact={onReact} franchiseId={franchiseId} />
        )}

        <div className="dr-msg__footer">
          <span className="dr-msg__time">{formatTime(msg.timestamp)}</span>
          {showReactions && (
            <div className="dr-msg__quick-reactions">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(msg.id, emoji)}
                  title={`React ${emoji}`}
                  className="dr-reaction-quick-btn"
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
    <div className="dr-reaction-row">
      {entries.map(([emoji, senders]) => {
        const hasReacted = senders.includes(franchiseId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(messageId, emoji)}
            title={`${senders.length} reaction${senders.length !== 1 ? 's' : ''}`}
            className="dr-reaction-btn"
            data-active={hasReacted ? 'true' : undefined}
          >
            <span>{emoji}</span>
            <span className="dr-reaction-btn__count">{senders.length}</span>
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

  useEffect(() => {
    if (!partyHost || !roomId) return;

    let cancelled = false;
    let socket: PartySocket | null = null;

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

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

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

  useEffect(() => {
    (window as any).__draftChatSendPick = (text: string) => sendPickRef.current?.(text);
    return () => { delete (window as any).__draftChatSendPick; };
  }, []);

  const isConnected = connected;

  return (
    <div className="dr-chat">
      <div className="dr-chat__header">
        <span className="dr-chat__title">Chat</span>
        <div className="dr-chat__status" data-connected={isConnected ? 'true' : undefined}>
          <span className="dr-chat__status-dot" />
          {isConnected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="dr-chat__list"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 && (
          <div className="dr-chat__empty">
            <span className="dr-chat__empty-icon" aria-hidden="true">💬</span>
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

      <div className="dr-chat__footer">
        {mentionSuggestions.length > 0 && (
          <MentionSuggestions suggestions={mentionSuggestions} onSelect={handleMentionSelect} />
        )}

        {showGifPicker && (
          <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />
        )}

        <div className="dr-chat__footer-row">
          <button
            type="button"
            onClick={() => setShowGifPicker((v) => !v)}
            title="Add GIF"
            aria-label="Open GIF picker"
            aria-pressed={showGifPicker}
            className="dr-gif-btn"
          >
            GIF
          </button>

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
          />

          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={!text.trim() || !isConnected}
            aria-label="Send message"
            className="dr-send-btn"
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
