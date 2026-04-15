/**
 * GroupMeChatPanel — Compose bar with Schefter rewrite preview.
 *
 * Flow: Owner types message → Claude rewrites in Schefter's voice →
 * Owner previews → Approves → Posts to GroupMe via bot.
 *
 * React island (client:visible) on the GroupMe tab of the news page.
 */
import { useState, useRef } from 'react';

interface Props {
  teamName: string;
  teamIcon: string;
}

type Phase = 'compose' | 'rewriting' | 'preview' | 'sending';

export default function GroupMeChatPanel({ teamName, teamIcon }: Props) {
  const [message, setMessage] = useState('');
  const [rewritten, setRewritten] = useState('');
  const [phase, setPhase] = useState<Phase>('compose');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleRewrite() {
    const text = message.trim();
    if (!text || phase !== 'compose') return;
    setPhase('rewriting');
    setFeedback(null);
    try {
      const res = await fetch('/api/groupme/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error ?? 'Failed to rewrite' });
        setPhase('compose');
        return;
      }
      setRewritten(data.rewritten);
      setPhase('preview');
    } catch {
      setFeedback({ type: 'error', text: 'Failed to rewrite message' });
      setPhase('compose');
    }
  }

  async function handleSend() {
    if (!rewritten || phase !== 'preview') return;
    setPhase('sending');
    setFeedback(null);
    try {
      const res = await fetch('/api/groupme/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rewritten, raw: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error ?? 'Failed to send' });
        setPhase('preview');
        return;
      }
      setMessage('');
      setRewritten('');
      setPhase('compose');
      setFeedback({ type: 'success', text: 'Schefter has reported your take to GroupMe!' });
      setTimeout(() => setFeedback(null), 4000);
    } catch {
      setFeedback({ type: 'error', text: 'Failed to send message' });
      setPhase('preview');
    }
  }

  function handleCancel() {
    setRewritten('');
    setPhase('compose');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRewrite();
    }
  }

  const isWorking = phase === 'rewriting' || phase === 'sending';

  return (
    <div className="gmc-panel">
      {feedback && (
        <div className={`gmc-feedback gmc-feedback--${feedback.type}`}>
          {feedback.text}
        </div>
      )}

      {phase === 'preview' ? (
        <div className="gmc-preview">
          <div className="gmc-preview__label">Schefter's version:</div>
          <div className="gmc-preview__text">{rewritten}</div>
          <div className="gmc-preview__actions">
            <button
              className="gmc-preview__btn gmc-preview__btn--cancel"
              onClick={handleCancel}
            >
              Edit
            </button>
            <button
              className="gmc-preview__btn gmc-preview__btn--retry"
              onClick={() => { setPhase('compose'); handleRewrite(); }}
            >
              Retry
            </button>
            <button
              className="gmc-preview__btn gmc-preview__btn--send"
              onClick={handleSend}
            >
              Send to GroupMe
            </button>
          </div>
        </div>
      ) : (
        <div className="gmc-compose">
          <div className="gmc-compose__header">
            {teamIcon && (
              <img src={teamIcon} alt="" width="20" height="20" className="gmc-compose__avatar" />
            )}
            <span className="gmc-compose__label">
              Post as <strong>{teamName}</strong> <span className="gmc-compose__via">via Schefter</span>
            </span>
          </div>
          <div className="gmc-compose__input-row">
            <textarea
              ref={inputRef}
              className="gmc-compose__textarea"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's your take? Schefter will report it..."
              maxLength={600}
              rows={2}
              disabled={isWorking}
            />
            <button
              className="gmc-compose__send"
              onClick={handleRewrite}
              disabled={!message.trim() || isWorking}
              aria-label="Preview Schefter rewrite"
            >
              {phase === 'rewriting' ? '...' : '→'}
            </button>
          </div>
          <div className="gmc-compose__meta">
            <span className="gmc-compose__charcount">{message.length}/600</span>
            <span className="gmc-compose__hint">Enter to preview, Schefter rewrites before posting</span>
          </div>
        </div>
      )}
    </div>
  );
}
