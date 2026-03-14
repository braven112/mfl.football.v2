import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PendingTrade,
  TradeBuilderTeam,
  TradeBuilderAuthUser,
} from '../../../types/trade-builder';
import PendingTradeCard from './PendingTradeCard';

interface Props {
  authUser: TradeBuilderAuthUser;
  teams: TradeBuilderTeam[];
  isOpen: boolean;
  onClose: () => void;
  onLoadIntoBuilder: (trade: PendingTrade, mode: 'counter' | 'view') => void;
}

type LoadingState = 'loading' | 'loaded' | 'error';

export default function PendingTradesPanel({
  authUser,
  teams,
  isOpen,
  onClose,
  onLoadIntoBuilder,
}: Props) {
  const [trades, setTrades] = useState<PendingTrade[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

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
        </div>
      </aside>

      <style>{`
        .ptp-overlay {
          position: fixed;
          inset: 0;
          z-index: 1001;
          background: rgba(15, 23, 42, 0.3);
          backdrop-filter: blur(1px);
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
          border-radius: 0.5rem;
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
          border-radius: 0.375rem;
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
