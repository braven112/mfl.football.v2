/**
 * GroupMeChatPanel — Compose bar for posting new messages to GroupMe via the bot.
 *
 * Posts are attributed with the team name (e.g. "Pacific Pigskins:\n{message}").
 * Rendered as a React island (client:visible) on the GroupMe tab of the news page.
 */
import { useState, useRef } from 'react';

interface Props {
  teamName: string;
  teamIcon: string;
}

export default function GroupMeChatPanel({ teamName, teamIcon }: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/groupme/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error ?? 'Failed to send' });
        return;
      }
      setMessage('');
      setFeedback({ type: 'success', text: 'Sent to GroupMe!' });
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback({ type: 'error', text: 'Failed to send message' });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="gmc-panel">
      {feedback && (
        <div className={`gmc-feedback gmc-feedback--${feedback.type}`}>
          {feedback.text}
        </div>
      )}

      <div className="gmc-compose">
        <div className="gmc-compose__header">
          {teamIcon && (
            <img src={teamIcon} alt="" width="20" height="20" className="gmc-compose__avatar" />
          )}
          <span className="gmc-compose__label">Post as <strong>{teamName}</strong></span>
        </div>
        <div className="gmc-compose__input-row">
          <textarea
            ref={inputRef}
            className="gmc-compose__textarea"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message to the group chat..."
            maxLength={900}
            rows={2}
          />
          <button
            className="gmc-compose__send"
            onClick={handleSend}
            disabled={!message.trim() || sending}
            aria-label="Send message"
          >
            {sending ? '...' : '↑'}
          </button>
        </div>
        <div className="gmc-compose__meta">
          <span className="gmc-compose__charcount">{message.length}/900</span>
          <span className="gmc-compose__hint">Enter to send, Shift+Enter for new line</span>
        </div>
      </div>
    </div>
  );
}
