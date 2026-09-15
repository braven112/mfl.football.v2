import React, { useCallback, useState, useEffect } from 'react';
import { handleAuthExpiry, takeParkedForSignIn } from '../../utils/signin-resume';

/**
 * Where a whisper-in-progress waits out a sign-in. Keyed per POST, because the
 * feed renders many of these islands at once and a single key would restore
 * one post's draft into another post's box.
 */
const whisperDraftKey = (postId: string) => `signin.whisperDraft.${postId}`;

/**
 * Whisper-back — inline follow-up tip form for rumor cards (Phase 7).
 *
 * Posts the usual `/api/schefter/tip` payload with an extra `repliesToPostId`
 * so the scanner can group the follow-up into a thread. Rate-limit + fuzz
 * rules are identical to a fresh tip; nothing about the parent rumor is
 * surfaced to other readers beyond the thread relationship.
 */

interface Props {
  postId: string;
  /**
   * Server-built sign-in URL carrying the return path. Built by
   * loginUrlForRequest in the rendering .astro component — this island can
   * reach neither the league registry nor Astro.locals, and a `${base}/login`
   * it assembled itself would be exactly the hand-built URL that split this
   * repo's sign-in behavior three ways. REQUIRED for that reason.
   */
  loginHref: string;
  isAuthenticated: boolean;
}

const MAX_CHARS = 500;

export default function SchefterWhisperBack({ postId, isAuthenticated, loginHref }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [topic, setTopic] = useState<'trade' | 'roster' | 'prediction' | 'commish' | 'other'>('other');
  const [status, setStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>(
    { kind: 'idle', message: '' },
  );
  const [loading, setLoading] = useState(false);

  /**
   * The other half of the sign-in park: after the reload, put the whisper they
   * were mid-way through back in the box and open it.
   *
   * Runs once per island, and only for a signed-in reader — the parked draft
   * exists precisely because the session expired, so it is only useful once
   * the new session is live. `takeParkedForSignIn` read-and-clears, so a draft
   * cannot reappear on a later navigation.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    const parked = takeParkedForSignIn<{ text?: string; topic?: typeof topic }>(
      whisperDraftKey(postId),
    );
    if (!parked?.text) return;
    setText(parked.text);
    if (parked.topic) setTopic(parked.topic);
    setOpen(true);
    setStatus({ kind: 'idle', message: 'Signed back in — your whisper is still here.' });
  }, [isAuthenticated, postId]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setStatus({ kind: 'idle', message: 'Sending…' });
    try {
      const res = await fetch('/api/schefter/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          topic,
          franchiseHint: 'league-wide',
          repliesToPostId: postId,
        }),
      });
      // Session died while they were typing: offer a way back in and keep the
      // draft, rather than printing "Please sign in" at someone with no button.
      if (handleAuthExpiry(res, { resume: { key: whisperDraftKey(postId), payload: { postId, text: trimmed, topic } } })) {
        setStatus({ kind: 'error', message: 'Your session expired — sign in and your whisper is still here.' });
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setStatus({ kind: 'success', message: 'Schefter will fold it into the next report.' });
        setText('');
      } else {
        const fallback =
          res.status === 429 ? "You've hit the 3-tips-per-24h cap. Try again tomorrow." :
          res.status === 404 ? 'That rumor is no longer in the feed.' :
          res.status === 400 && data?.code === 'reply_too_old' ? 'That rumor is too old to whisper back on.' :
          'Something went wrong. Try again.';
        setStatus({ kind: 'error', message: data?.error || fallback });
      }
    } catch {
      setStatus({ kind: 'error', message: 'Network error. Try again.' });
    } finally {
      setLoading(false);
    }
  }, [postId, text, topic]);

  if (!isAuthenticated) {
    return (
      <a href={loginHref} className="sfc-whisper__signin">
        Sign in to whisper back
      </a>
    );
  }

  if (!open) {
    return (
      <button type="button" className="sfc-whisper__trigger" onClick={() => setOpen(true)}>
        Whisper back
      </button>
    );
  }

  return (
    <form className="sfc-whisper__form" onSubmit={submit} aria-label="Whisper back on this rumor">
      <textarea
        className="sfc-whisper__textarea"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        maxLength={MAX_CHARS}
        placeholder="Add what you're hearing… Schefter will keep you anonymous."
        rows={3}
        disabled={loading}
        aria-label="Your whisper-back tip"
      />
      <div className="sfc-whisper__meta">
        <label className="sfc-whisper__topic-label">
          Topic
          <select
            className="sfc-whisper__topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value as typeof topic)}
            disabled={loading}
          >
            <option value="trade">Trade interest</option>
            <option value="roster">Roster gripe</option>
            <option value="prediction">Bold prediction</option>
            <option value="commish">Beef</option>
            <option value="other">Other</option>
          </select>
        </label>
        <span className="sfc-whisper__counter">{text.length} / {MAX_CHARS}</span>
      </div>
      <div className="sfc-whisper__actions">
        <button type="button" className="sfc-whisper__cancel" onClick={() => { setOpen(false); setStatus({ kind: 'idle', message: '' }); }} disabled={loading}>
          Cancel
        </button>
        <button type="submit" className="sfc-whisper__submit" disabled={loading || text.trim().length === 0}>
          Send whisper
        </button>
      </div>
      {status.message && (
        <p className={`sfc-whisper__status sfc-whisper__status--${status.kind}`} role="status" aria-live="polite">
          {status.message}
        </p>
      )}
    </form>
  );
}
