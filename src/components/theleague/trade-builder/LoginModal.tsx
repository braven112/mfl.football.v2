import React, { useState, useEffect, useRef } from 'react';
import type { TradeBuilderAuthUser } from '../../../types/trade-builder';

interface Props {
  onClose: () => void;
  onLoginSuccess: (user: TradeBuilderAuthUser) => void;
}

export default function LoginModal({ onClose, onLoginSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Focus trap + ESC — focus username input on mount
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const modal = contentRef.current;
        if (!modal) return;
        const focusable = modal.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    usernameRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Login failed');
      }

      // Map API response to TradeBuilderAuthUser
      onLoginSuccess({
        name: data.user.username,
        franchiseId: data.user.franchiseId,
        leagueId: data.user.leagueId,
        role: data.user.role,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="lm-overlay" onClick={onClose}>
      <div
        className="lm-content"
        ref={contentRef}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lm-title"
        tabIndex={-1}
      >
        <button
          className="lm-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (ESC)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="lm-body">
          <div className="lm-hero">
            <div className="lm-hero__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                <circle cx="12" cy="16" r="1"/>
              </svg>
            </div>
            <h2 id="lm-title" className="lm-hero__name">Sign In</h2>
            <p className="lm-hero__meta">Sign in with your MFL account to submit trades</p>
          </div>

          <form className="lm-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="lm-error" role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                </svg>
                {error}
              </div>
            )}

            <div className="lm-section-header">
              <h3 className="lm-section-title">Credentials</h3>
            </div>

            <div className="lm-field">
              <label htmlFor="lm-username" className="lm-label">Username</label>
              <input
                ref={usernameRef}
                id="lm-username"
                type="text"
                className="lm-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Your MFL username"
                required
                disabled={isSubmitting}
                autoComplete="username"
              />
            </div>

            <div className="lm-field">
              <label htmlFor="lm-password" className="lm-label">Password</label>
              <input
                id="lm-password"
                type="password"
                className="lm-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your MFL password"
                required
                disabled={isSubmitting}
                autoComplete="current-password"
              />
            </div>

            <div className="lm-footer">
              <p className="lm-security">
                Your credentials are securely transmitted and validated only with MyFantasyLeague.com. We never store your password.
              </p>
              <div className="lm-footer__actions">
                <button
                  type="button"
                  className="lm-btn-cancel"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lm-submit"
                  disabled={isSubmitting || !username.trim() || !password.trim()}
                >
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <style>{`
        .lm-overlay {
          position: fixed;
          inset: 0;
          z-index: 1001;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .lm-content {
          position: relative;
          background: var(--color-white, #fff);
          border-radius: var(--radius-lg, 1rem);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          width: 100%;
          max-width: 440px;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: lm-enter 0.22s ease-out;
        }
        .lm-content:focus { outline: none; }
        @keyframes lm-enter {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .lm-close {
          position: absolute;
          top: 0.875rem;
          right: 0.875rem;
          z-index: 2;
          background: var(--color-gray-100, #f3f4f6);
          border: none;
          border-radius: var(--radius-full, 9999px);
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--color-gray-500, #6b7280);
          transition: background 0.15s ease, color 0.15s ease;
        }
        .lm-close:hover {
          background: var(--color-gray-200, #dddedf);
          color: var(--color-gray-800, #1f2937);
        }
        .lm-close:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .lm-body {
          overflow-y: auto;
          padding: 1.75rem;
          flex: 1;
        }

        /* Hero — replaces CDM player hero */
        .lm-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.375rem;
          margin-bottom: 1.5rem;
        }
        .lm-hero__icon {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-full, 9999px);
          background: var(--color-gray-100, #f3f4f6);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-gray-500, #6b7280);
          margin-bottom: 0.25rem;
        }
        .lm-hero__name {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
          margin: 0;
          line-height: 1.2;
        }
        .lm-hero__meta {
          font-size: 0.8125rem;
          color: var(--color-gray-500, #6b7280);
          margin: 0;
        }

        /* Form */
        .lm-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .lm-section-header {
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
          margin-bottom: -0.25rem;
        }
        .lm-section-title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0;
        }
        .lm-field {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .lm-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--color-gray-500, #6b7280);
        }
        .lm-input {
          padding: 0.75rem;
          font-size: 0.875rem;
          font-family: inherit;
          color: var(--text-color, #1f2937);
          background: var(--color-gray-50, #f9fafb);
          border: 1px solid var(--content-border, #e2e8f0);
          border-left: 2px solid var(--color-gray-300, #d1d5db);
          border-radius: var(--radius-sm, 0.25rem);
          box-sizing: border-box;
          width: 100%;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .lm-input::placeholder {
          color: var(--color-gray-400, #9ca3af);
        }
        .lm-input:focus-visible {
          outline: none;
          border-color: var(--color-primary, #1c497c);
          border-left-color: var(--color-primary, #1c497c);
          box-shadow: 0 0 0 3px rgba(28, 73, 124, 0.1);
          background: var(--color-white, #fff);
        }
        .lm-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        /* Error */
        .lm-error {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.625rem 0.75rem;
          background: var(--color-error-light, #fef2f2);
          border: 1px solid var(--color-error-border, #fecaca);
          border-radius: var(--radius-sm, 0.25rem);
          color: var(--color-error, #dc2626);
          font-size: 0.8125rem;
        }

        /* Footer */
        .lm-footer {
          margin-top: 0.5rem;
        }
        .lm-security {
          font-size: 0.6875rem;
          color: var(--color-gray-400, #9ca3af);
          text-align: center;
          margin: 0 0 1rem 0;
          line-height: 1.4;
        }
        .lm-footer__actions {
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }
        .lm-btn-cancel {
          appearance: none;
          background: transparent;
          border: none;
          color: var(--color-gray-500, #6b7280);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0.625rem 0;
          transition: color 0.15s ease;
        }
        .lm-btn-cancel:hover {
          color: var(--color-gray-800, #1f2937);
        }
        .lm-btn-cancel:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .lm-btn-cancel:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .lm-submit {
          appearance: none;
          border: none;
          background: var(--color-primary, #1c497c);
          color: #fff;
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.75rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, opacity 0.15s ease;
          flex: 1;
        }
        .lm-submit:hover:not(:disabled) {
          background: var(--color-primary-dark, #164066);
        }
        .lm-submit:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .lm-submit:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }

        /* Mobile — bottom sheet */
        @media (max-width: 600px) {
          .lm-overlay {
            align-items: flex-end;
            padding: 0;
          }
          .lm-content {
            max-height: 92vh;
            max-width: 100%;
            border-radius: 1rem 1rem 0 0;
            animation: lm-slide-up 0.25s ease-out;
          }
          @keyframes lm-slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          .lm-body {
            padding: 1.25rem;
          }
          .lm-hero__icon {
            width: 48px;
            height: 48px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lm-content { animation: none; }
          .lm-input { transition: none; }
          .lm-submit { transition: none; }
          .lm-close { transition: none; }
          .lm-btn-cancel { transition: none; }
        }
      `}</style>
    </div>
  );
}
