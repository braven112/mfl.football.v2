/**
 * LineupActionBar — sticky bottom bar for lineup submission.
 * State machine: idle → selecting → submitting → success/error
 */

import { useCallback } from 'react';
import type { LineupUIState } from './lineup-utils';

interface LineupActionBarProps {
  uiState: LineupUIState;
  changeCount: number;
  onUndo: () => void;
  onCancelSelection: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  mflFallbackUrl?: string;
}

export default function LineupActionBar({
  uiState,
  changeCount,
  onUndo,
  onCancelSelection,
  onSubmit,
  onRetry,
  mflFallbackUrl,
}: LineupActionBarProps) {
  const mode = uiState.mode;

  // Hide bar when no changes and idle
  if (mode === 'idle' && changeCount === 0) return null;

  const handleSubmit = useCallback(() => {
    if (mode !== 'idle' && mode !== 'error') return;
    onSubmit();
  }, [mode, onSubmit]);

  // Success state — auto-hides via parent after 2s
  if (mode === 'success') {
    return (
      <div className="lineup-action-bar lineup-action-bar--success" role="status" aria-live="polite">
        <div className="lineup-action-bar__inner">
          <span />
          <span className="lineup-action-bar__center">
            <svg className="lineup-action-bar__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Lineup set!
          </span>
          <span />
        </div>
      </div>
    );
  }

  // Error state
  if (mode === 'error') {
    const retryCount = uiState.retryCount;
    const showFallback = retryCount >= 3 && mflFallbackUrl;

    return (
      <div className="lineup-action-bar lineup-action-bar--error" role="alert" aria-live="assertive">
        <div className="lineup-action-bar__inner">
          <button className="lineup-action-bar__btn" onClick={onRetry}>
            Retry
          </button>
          <span className="lineup-action-bar__center lineup-action-bar__center--error">
            {uiState.message || 'Submission failed'}
          </span>
          <button
            className="lineup-action-bar__btn lineup-action-bar__btn--primary"
            onClick={onRetry}
          >
            Try Again
          </button>
        </div>
        {showFallback && (
          <div className="lineup-fallback-banner" role="complementary">
            <p>Having trouble? You can also set your lineup on MFL directly.</p>
            <a
              href={mflFallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="lineup-fallback-banner__link"
            >
              Open MFL Lineup Page →
            </a>
          </div>
        )}
      </div>
    );
  }

  // Submitting state
  if (mode === 'submitting') {
    return (
      <div className="lineup-action-bar" role="status" aria-live="polite" aria-busy="true">
        <div className="lineup-action-bar__inner">
          <span />
          <span className="lineup-action-bar__center">
            <span className="lineup-action-bar__spinner" aria-hidden="true" />
            Submitting…
          </span>
          <span />
        </div>
      </div>
    );
  }

  // Selecting state (user tapped a swap icon)
  if (mode === 'selecting') {
    return (
      <div className="lineup-action-bar" role="status" aria-live="polite">
        <div className="lineup-action-bar__inner">
          <button className="lineup-action-bar__btn" onClick={onCancelSelection}>
            Cancel
          </button>
          <span className="lineup-action-bar__center">
            Selecting…
          </span>
          <span />
        </div>
      </div>
    );
  }

  // Idle with changes
  return (
    <div className="lineup-action-bar" role="toolbar" aria-label="Lineup actions">
      <div className="lineup-action-bar__inner">
        <button
          className="lineup-action-bar__btn"
          onClick={onUndo}
          disabled={changeCount === 0}
          aria-label="Undo last change"
        >
          Undo
        </button>
        <span className="lineup-action-bar__center">
          {changeCount} {changeCount === 1 ? 'change' : 'changes'}
        </span>
        <button
          className="lineup-action-bar__btn lineup-action-bar__btn--primary"
          onClick={handleSubmit}
          disabled={changeCount === 0}
        >
          Set Lineup
        </button>
      </div>
    </div>
  );
}
