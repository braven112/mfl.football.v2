import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PendingTrade,
  DraftTrade,
  TradeBuilderTeam,
  TradeBuilderAuthUser,
  TradeSide,
} from '../../../types/trade-builder';
import PendingTradeCard from './PendingTradeCard';

interface Props {
  authUser: TradeBuilderAuthUser;
  teams: TradeBuilderTeam[];
  isOpen: boolean;
  onClose: () => void;
  onLoadIntoBuilder: (trade: PendingTrade, mode: 'counter' | 'view') => void;
  drafts: DraftTrade[];
  onLoadDraft: (draft: DraftTrade) => void;
  onDeleteDraft: (draftId: string) => void;
  onRenameDraft: (draftId: string, name: string) => void;
  onCopyDraftLink: (draft: DraftTrade) => void;
}

type LoadingState = 'loading' | 'loaded' | 'error';

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function DraftSideSummary({
  side,
  teams,
}: {
  side: TradeSide;
  teams: TradeBuilderTeam[];
}) {
  const team = teams.find(t => t.franchiseId === side.franchiseId);
  if (!team) return <span className="ptp-draft-no-team">No team</span>;

  const playerCount = side.playerIds.length;
  const pickCount = side.draftPicks.length;
  const parts: string[] = [];
  if (playerCount > 0) parts.push(`${playerCount} player${playerCount > 1 ? 's' : ''}`);
  if (pickCount > 0) parts.push(`${pickCount} pick${pickCount > 1 ? 's' : ''}`);

  return (
    <span className="ptp-draft-side">
      {team.icon && <img src={team.icon} alt="" className="ptp-draft-icon" />}
      <span className="ptp-draft-team">{team.abbrev}</span>
      {parts.length > 0 && (
        <span className="ptp-draft-assets">({parts.join(', ')})</span>
      )}
    </span>
  );
}

export default function PendingTradesPanel({
  authUser,
  teams,
  isOpen,
  onClose,
  onLoadIntoBuilder,
  drafts,
  onLoadDraft,
  onDeleteDraft,
  onRenameDraft,
  onCopyDraftLink,
}: Props) {
  const [trades, setTrades] = useState<PendingTrade[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editDraftName, setEditDraftName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    setLoadingState('loading');
    setErrorMessage('');
    try {
      const res = await fetch('/api/trades/pending', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setTrades(data.trades);
        setLoadingState('loaded');
      } else {
        setErrorMessage(data.message || 'Failed to load trades');
        setLoadingState('error');
      }
    } catch {
      setErrorMessage('Network error. Please try again.');
      setLoadingState('error');
    }
  }, []);

  // Lock body scroll + store trigger for focus return + close nav drawer to prevent overlap
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // Close the nav drawer if open to prevent z-index overlap
      // Uses the exposed window.navDrawer API to properly clean up state
      const navApi = (window as any).navDrawer;
      if (navApi?.isOpen?.()) {
        navApi.close();
      }
      fetchTrades();
      closeRef.current?.focus();
      return () => {
        document.body.style.overflow = prev;
      };
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen, fetchTrades]);

  // ESC + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleTradeAction = async (
    tradeId: string,
    action: 'accept' | 'reject' | 'revoke'
  ) => {
    const res = await fetch('/api/trades/respond', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, response: action }),
    });
    const data = await res.json();
    if (data.success) {
      // Remove the trade from the list
      setTrades(prev => prev.filter(t => t.tradeId !== tradeId));
    } else {
      throw new Error(data.message || 'Action failed');
    }
  };

  const handleCounter = (trade: PendingTrade) => {
    onClose();
    onLoadIntoBuilder(trade, 'counter');
  };

  const handleViewDetails = (trade: PendingTrade) => {
    onClose();
    onLoadIntoBuilder(trade, 'view');
  };

  const handleStartDraftRename = (draft: DraftTrade) => {
    setEditingDraftId(draft.id);
    setEditDraftName(draft.name);
  };

  const handleCommitDraftRename = () => {
    if (editingDraftId && editDraftName.trim()) {
      onRenameDraft(editingDraftId, editDraftName.trim());
    }
    setEditingDraftId(null);
    setEditDraftName('');
  };

  const handleDeleteDraft = (id: string) => {
    if (confirmDeleteId === id) {
      onDeleteDraft(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  if (!isOpen) return null;

  const received = trades.filter(t => t.offeredTo === authUser.franchiseId);
  const sent = trades.filter(t => t.offeredBy === authUser.franchiseId);

  return (
    <div className="ptp-overlay" onClick={onClose}>
      <aside
        ref={panelRef}
        className="ptp-panel"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pending trades"
      >
        <div className="ptp-header">
          <h2 className="ptp-title">My Trades</h2>
          <button
            ref={closeRef}
            className="ptp-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (ESC)"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="ptp-body" aria-busy={loadingState === 'loading'}>
          {loadingState === 'loading' && (
            <div className="ptp-skeletons">
              <span className="visually-hidden">Loading trades...</span>
              <div className="ptp-skeleton" />
              <div className="ptp-skeleton" />
              <div className="ptp-skeleton" />
            </div>
          )}

          {loadingState === 'error' && (
            <div className="ptp-error-state">
              <p className="ptp-error-text">{errorMessage}</p>
              <button className="ptp-retry-btn" onClick={fetchTrades}>Retry</button>
            </div>
          )}

          {loadingState === 'loaded' && (
            <>
              <div className="ptp-section">
                <div className="ptp-section-header">
                  <h3 className="ptp-section-title">Received</h3>
                  <p className="ptp-section-sub">Trades offered to you</p>
                </div>
                {received.length > 0 ? (
                  <div className="ptp-card-list">
                    {received.map(trade => (
                      <PendingTradeCard
                        key={trade.tradeId}
                        trade={trade}
                        direction="received"
                        counterpartyTeam={teams.find(t => t.franchiseId === trade.offeredBy)}
                        userFranchiseId={authUser.franchiseId}
                        allTeams={teams}
                        onAccept={id => handleTradeAction(id, 'accept')}
                        onReject={id => handleTradeAction(id, 'reject')}
                        onWithdraw={id => handleTradeAction(id, 'revoke')}
                        onCounter={handleCounter}
                        onViewDetails={handleViewDetails}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="ptp-empty">No pending trades</div>
                )}
              </div>

              <div className="ptp-section">
                <div className="ptp-section-header">
                  <h3 className="ptp-section-title">Sent</h3>
                  <p className="ptp-section-sub">Trades you proposed</p>
                </div>
                {sent.length > 0 ? (
                  <div className="ptp-card-list">
                    {sent.map(trade => (
                      <PendingTradeCard
                        key={trade.tradeId}
                        trade={trade}
                        direction="sent"
                        counterpartyTeam={teams.find(t => t.franchiseId === trade.offeredTo)}
                        userFranchiseId={authUser.franchiseId}
                        allTeams={teams}
                        onAccept={id => handleTradeAction(id, 'accept')}
                        onReject={id => handleTradeAction(id, 'reject')}
                        onWithdraw={id => handleTradeAction(id, 'revoke')}
                        onCounter={handleCounter}
                        onViewDetails={handleViewDetails}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="ptp-empty">No active proposals</div>
                )}
              </div>
            </>
          )}

          {/* Draft Trades — always shown, sourced from localStorage */}
          <div className="ptp-section ptp-drafts-section">
            <div className="ptp-section-header">
              <h3 className="ptp-section-title">Drafts</h3>
              <p className="ptp-section-sub">Saved trade templates</p>
            </div>
            {drafts.length > 0 ? (
              <div className="ptp-card-list">
                {[...drafts].sort((a, b) => b.updatedAt - a.updatedAt).map(draft => {
                  const isEditing = editingDraftId === draft.id;
                  const isConfirmingDelete = confirmDeleteId === draft.id;
                  return (
                    <div key={draft.id} className="ptp-draft-card">
                      <div className="ptp-draft-header">
                        {isEditing ? (
                          <input
                            className="ptp-draft-rename"
                            value={editDraftName}
                            onChange={e => setEditDraftName(e.target.value)}
                            onBlur={handleCommitDraftRename}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCommitDraftRename();
                              if (e.key === 'Escape') { setEditingDraftId(null); setEditDraftName(''); }
                            }}
                            autoFocus
                            maxLength={60}
                          />
                        ) : (
                          <button
                            className="ptp-draft-name"
                            onClick={() => handleStartDraftRename(draft)}
                            title="Click to rename"
                          >
                            {draft.name}
                          </button>
                        )}
                        <span className="ptp-draft-time">{formatRelativeTime(draft.updatedAt)}</span>
                      </div>
                      <div className="ptp-draft-trade">
                        <DraftSideSummary side={draft.teamA} teams={teams} />
                        <span className="ptp-draft-arrow">&#8644;</span>
                        <DraftSideSummary side={draft.teamB} teams={teams} />
                      </div>
                      <div className="ptp-draft-actions">
                        <button
                          className="ptp-draft-btn ptp-draft-btn--load"
                          onClick={() => {
                            onLoadDraft(draft);
                            onClose();
                          }}
                        >
                          Load
                        </button>
                        <button
                          className="ptp-draft-btn ptp-draft-btn--copy"
                          onClick={() => {
                            onCopyDraftLink(draft);
                            setCopiedDraftId(draft.id);
                            setTimeout(() => setCopiedDraftId(null), 2000);
                          }}
                        >
                          {copiedDraftId === draft.id ? 'Copied!' : 'Copy Link'}
                        </button>
                      </div>
                      <div className="ptp-draft-meta-row">
                        {isConfirmingDelete ? (
                          <>
                            <span className="ptp-draft-delete-prompt">Delete this draft?</span>
                            <button
                              className="ptp-draft-link ptp-draft-link--danger"
                              onClick={() => { onDeleteDraft(draft.id); setConfirmDeleteId(null); }}
                            >
                              Yes, delete
                            </button>
                            <button
                              className="ptp-draft-link"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="ptp-draft-link"
                            onClick={() => setConfirmDeleteId(draft.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ptp-empty">
                No saved drafts. Build a trade and click "Save Draft" to reuse it later.
              </div>
            )}
          </div>
        </div>
      </aside>

      <style>{`
        .ptp-overlay {
          position: fixed;
          inset: 0;
          z-index: 1001;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
        }
        .ptp-panel {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 400px;
          max-width: 100%;
          background: var(--color-white, #fff);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
          animation: ptp-slide-in 0.26s ease-out;
        }
        @keyframes ptp-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .ptp-header {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--content-border, #e2e8f0);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .ptp-title {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
          margin: 0;
        }
        .ptp-close {
          background: var(--color-gray-100, #f3f4f6);
          border: none;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--color-gray-500, #6b7280);
        }
        .ptp-close:hover { background: var(--color-gray-200, #e5e7eb); }
        .ptp-close:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .ptp-body {
          overflow-y: auto;
          flex: 1;
          padding: 1.25rem 1.5rem;
        }
        .ptp-section {
          margin-bottom: 1.5rem;
        }
        .ptp-section:last-child { margin-bottom: 0; }
        .ptp-section-header {
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
          margin-bottom: 0.75rem;
        }
        .ptp-section-title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0;
        }
        .ptp-section-sub {
          font-size: 0.8125rem;
          color: var(--color-gray-500, #6b7280);
          margin: 0.25rem 0 0 0;
        }
        .ptp-card-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .ptp-empty {
          font-size: 0.8125rem;
          color: var(--color-gray-500, #6b7280);
          padding: 1rem;
          text-align: center;
          background: var(--color-gray-50, #f9fafb);
          border-radius: var(--radius-md, 0.5rem);
        }
        .ptp-skeletons {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .ptp-skeleton {
          background: var(--color-gray-100, #f3f4f6);
          border-radius: var(--radius-md, 0.5rem);
          height: 5rem;
          animation: ptp-pulse 1.5s ease-in-out infinite;
        }
        @keyframes ptp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .ptp-error-state {
          text-align: center;
          padding: 2rem 1rem;
        }
        .ptp-error-text {
          color: var(--color-error, #dc2626);
          font-size: 0.875rem;
          margin: 0 0 0.75rem 0;
        }
        .ptp-retry-btn {
          background: var(--btn-primary-bg, #1c497c);
          color: #fff;
          border: none;
          border-radius: var(--radius-sm, 0.25rem);
          padding: 0.5rem 1rem;
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
        }
        .ptp-retry-btn:hover { background: var(--btn-primary-bg-hover, #164066); }
        .ptp-retry-btn:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border-width: 0;
        }
        /* Draft trades section */
        .ptp-drafts-section {
          border-top: 1px solid var(--content-border, #e2e8f0);
          padding-top: 1.5rem;
        }
        .ptp-draft-card {
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.875rem;
          background: var(--content-bg, #fff);
        }
        .ptp-draft-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .ptp-draft-name {
          background: none;
          border: none;
          padding: 0;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--color-gray-900, #111827);
          cursor: pointer;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 70%;
        }
        .ptp-draft-name:hover { color: var(--color-primary, #1c497c); }
        .ptp-draft-name:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .ptp-draft-rename {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--color-gray-900, #111827);
          border: 1px solid var(--color-primary, #1c497c);
          border-radius: var(--radius-sm, 0.25rem);
          padding: 0.125rem 0.375rem;
          flex: 1;
          max-width: 70%;
          background: var(--color-white, #fff);
        }
        .ptp-draft-rename:focus {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 1px;
        }
        .ptp-draft-time {
          font-size: 0.75rem;
          color: var(--color-gray-400, #9ca3af);
          white-space: nowrap;
        }
        .ptp-draft-trade {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8125rem;
          color: var(--color-gray-700, #374151);
          margin-bottom: 0.625rem;
          flex-wrap: wrap;
        }
        .ptp-draft-side {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
        }
        .ptp-draft-icon {
          width: 18px;
          height: 18px;
          border-radius: 2px;
        }
        .ptp-draft-team { font-weight: 600; }
        .ptp-draft-assets {
          color: var(--color-gray-500, #6b7280);
          font-size: 0.75rem;
        }
        .ptp-draft-no-team {
          color: var(--color-gray-400, #9ca3af);
          font-style: italic;
        }
        .ptp-draft-arrow {
          color: var(--color-gray-400, #9ca3af);
          font-size: 1rem;
        }
        .ptp-draft-actions {
          display: flex;
          gap: 0.5rem;
        }
        .ptp-draft-btn {
          padding: 0.375rem 0.75rem;
          border-radius: var(--radius-sm, 0.25rem);
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--content-border, #e2e8f0);
          transition: all 0.15s ease;
        }
        .ptp-draft-btn:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .ptp-draft-btn--load {
          background: var(--btn-primary-bg, #1c497c);
          color: #fff;
          border-color: var(--btn-primary-bg, #1c497c);
        }
        .ptp-draft-btn--load:hover {
          background: var(--btn-primary-bg-hover, #164066);
        }
        .ptp-draft-btn--copy {
          background: var(--content-bg, #fff);
          color: var(--color-gray-700, #374151);
        }
        .ptp-draft-btn--copy:hover {
          border-color: var(--color-primary, #1c497c);
          color: var(--color-primary, #1c497c);
        }
        .ptp-draft-meta-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--color-gray-100, #f3f4f6);
        }
        .ptp-draft-delete-prompt {
          font-size: 0.75rem;
          color: var(--color-error, #dc2626);
          font-weight: 500;
        }
        .ptp-draft-link {
          background: none;
          border: none;
          padding: 0;
          font-size: 0.6875rem;
          color: var(--color-gray-400, #9ca3af);
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .ptp-draft-link:hover { color: var(--color-gray-600, #4b5563); }
        .ptp-draft-link--danger { color: var(--color-error, #dc2626); font-weight: 600; }
        .ptp-draft-link--danger:hover { color: #b91c1c; }
        .ptp-draft-link:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        @media (max-width: 640px) {
          .ptp-panel { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ptp-panel { animation: none; }
          .ptp-skeleton { animation: none; }
        }
      `}</style>
    </div>
  );
}
