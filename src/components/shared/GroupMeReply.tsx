/**
 * GroupMeReply — Inline reply button + expandable compose field for GroupMe messages.
 *
 * When clicked, expands a compact text input below the message.
 * Sends reply via the bot API with the original message quoted.
 * React island (client:visible) on each GroupMe post card.
 */
import { useState, useRef } from 'react';

interface Props {
  /** Original message text to quote in the reply */
  originalText: string;
  /** Original author name for display */
  originalAuthor: string;
  /** Authenticated user's team name */
  teamName: string;
}

export default function GroupMeReply({ originalText, originalAuthor, teamName }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleOpen() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSend() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/groupme/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          replyTo: `${originalAuthor}: ${originalText.slice(0, 200)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error ?? 'Failed to send' });
        return;
      }
      setMessage('');
      setOpen(false);
      setFeedback({ type: 'success', text: 'Reply sent!' });
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback({ type: 'error', text: 'Failed to send reply' });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setMessage('');
    }
  }

  return (
    <div className="gm-reply">
      {feedback && (
        <div className={`gm-reply__feedback gm-reply__feedback--${feedback.type}`}>
          {feedback.text}
        </div>
      )}

      {!open ? (
        <button
          className="gm-reply__trigger"
          onClick={handleOpen}
          aria-label="Reply to this message"
        >
          Reply
        </button>
      ) : (
        <div className="gm-reply__compose">
          <span className="gm-reply__label">Reply as {teamName}</span>
          <div className="gm-reply__row">
            <input
              ref={inputRef}
              className="gm-reply__input"
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Reply to ${originalAuthor}...`}
              maxLength={900}
              disabled={sending}
            />
            <button
              className="gm-reply__send"
              onClick={handleSend}
              disabled={!message.trim() || sending}
              aria-label="Send reply"
            >
              {sending ? '...' : '↑'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
