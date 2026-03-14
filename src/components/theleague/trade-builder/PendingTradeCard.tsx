import React, { useState } from 'react';
import type { PendingTrade, TradeBuilderTeam } from '../../../types/trade-builder';
import { parseAssets, formatPickCode, formatRelativeTime } from '../../../utils/trade-asset-parsing';
import { chooseTeamName } from '../../../utils/team-names';

interface Props {
  trade: PendingTrade;
  direction: 'received' | 'sent';
  counterpartyTeam: TradeBuilderTeam | undefined;
  userFranchiseId: string;
  allTeams: TradeBuilderTeam[];
  onAccept: (tradeId: string) => Promise<void>;
  onReject: (tradeId: string) => Promise<void>;
  onWithdraw: (tradeId: string) => Promise<void>;
  onCounter: (trade: PendingTrade) => void;
  onViewDetails: (trade: PendingTrade) => void;
}

type ConfirmAction = 'accept' | 'reject' | 'withdraw' | null;

export default function PendingTradeCard({
  trade,
  direction,
  counterpartyTeam,
  userFranchiseId,
  allTeams,
  onAccept,
  onReject,
  onWithdraw,
  onCounter,
  onViewDetails,
}: Props) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Determine what the user gives/receives based on perspective
  const isOfferedBy = trade.offeredBy === userFranchiseId;
  const userGivesUp = isOfferedBy ? trade.willGiveUp : trade.willReceive;
  const userReceives = isOfferedBy ? trade.willReceive : trade.willGiveUp;

  const giveParsed = parseAssets(userGivesUp);
  const receiveParsed = parseAssets(userReceives);

  const handleConfirm = async () => {
    setProcessing(true);
    setActionError(null);
    try {
      if (confirmAction === 'accept') await onAccept(trade.tradeId);
      else if (confirmAction === 'reject') await onReject(trade.tradeId);
      else if (confirmAction === 'withdraw') await onWithdraw(trade.tradeId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setProcessing(false);
      setConfirmAction(null);
    }
  };

  const resolvePlayerName = (playerId: string): string => {
    for (const team of allTeams) {
      const player = team.players.find(p => p.id === playerId);
      if (player) return player.name;
    }
    return `Unknown Player (${playerId})`;
  };

  const teamDisplayName = counterpartyTeam
    ? chooseTeamName({
        fullName: counterpartyTeam.name,
        nameMedium: counterpartyTeam.nameMedium,
        nameShort: counterpartyTeam.nameShort,
        abbrev: counterpartyTeam.abbrev,
      }, 'short')
    : 'Unknown';

  const renderAssetList = (parsed: ReturnType<typeof parseAssets>, label: string, labelClass: string) => (
    <div className="ptc-assets-col">
      <span className={`ptc-assets-label ${labelClass}`}>{label}</span>
      <ul className="ptc-asset-list" role="list">
        {parsed.playerIds.map(id => (
          <li key={id} className="ptc-asset-item">{resolvePlayerName(id)}</li>
        ))}
        {parsed.draftPicks.map((code, i) => (
          <li key={`pick-${i}`} className="ptc-asset-item ptc-asset-item--pick">
            {formatPickCode(code, allTeams)}
          </li>
        ))}
        {parsed.blindBid !== null && (
          <li className="ptc-asset-item ptc-asset-item--pick">
            ${parsed.blindBid} BBID
          </li>
        )}
        {parsed.playerIds.length === 0 && parsed.draftPicks.length === 0 && parsed.blindBid === null && (
          <li className="ptc-asset-item ptc-asset-item--empty">None</li>
        )}
      </ul>
    </div>
  );

  const actionPrompts: Record<string, string> = {
    accept: 'Accept this trade?',
    reject: 'Reject this trade?',
    withdraw: 'Withdraw this trade?',
  };

  return (
    <div className="ptc">
      <div className="ptc-header">
        <div className="ptc-header-left">
          {counterpartyTeam?.icon && (
            <img src={counterpartyTeam.icon} alt="" className="ptc-team-icon" />
          )}
          <span className="ptc-team-name">{teamDisplayName}</span>
        </div>
        <span className="ptc-timestamp">{formatRelativeTime(trade.timestamp)}</span>
      </div>

      <div className="ptc-assets-grid">
        {renderAssetList(receiveParsed, 'You receive', 'ptc-assets-label--receive')}
        {renderAssetList(giveParsed, 'You give', 'ptc-assets-label--give')}
      </div>

      {trade.comments && (
        <div className="ptc-message">
          <em>{trade.comments.length > 80 ? trade.comments.slice(0, 80) + '...' : trade.comments}</em>
        </div>
      )}

      {actionError && (
        <div className="ptc-error" role="alert">
          {actionError}
          <button
            className="ptc-error-dismiss"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      <div className="ptc-actions">
        {confirmAction ? (
          <div className="ptc-confirm-row" role="alert" aria-live="assertive">
            <span className="ptc-confirm-text">{actionPrompts[confirmAction]}</span>
            <button
              className={`ptc-btn ptc-btn--confirm-${confirmAction}`}
              onClick={handleConfirm}
              disabled={processing}
            >
              {processing ? '...' : 'Confirm'}
            </button>
            <button
              className="ptc-btn ptc-btn--cancel"
              onClick={() => setConfirmAction(null)}
              disabled={processing}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {direction === 'received' && (
              <>
                <button className="ptc-btn ptc-btn--accept" onClick={() => setConfirmAction('accept')}>Accept</button>
                <button className="ptc-btn ptc-btn--reject" onClick={() => setConfirmAction('reject')}>Reject</button>
                <button className="ptc-btn ptc-btn--counter" onClick={() => onCounter(trade)}>Counter</button>
              </>
            )}
            {direction === 'sent' && (
              <button className="ptc-btn ptc-btn--reject" onClick={() => setConfirmAction('withdraw')}>Withdraw</button>
            )}
            <button className="ptc-btn ptc-btn--view" onClick={() => onViewDetails(trade)}>View</button>
          </>
        )}
      </div>

      <style>{`
        .ptc {
          background: var(--content-bg, #fff);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.875rem;
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
        }
        .ptc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ptc-header-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .ptc-team-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .ptc-team-name {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--color-gray-900, #111827);
        }
        .ptc-timestamp {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--color-gray-500, #6b7280);
        }
        .ptc-assets-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
        }
        .ptc-assets-col {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .ptc-assets-label {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.125rem;
        }
        .ptc-assets-label--receive { color: var(--color-success-dark, #059669); }
        .ptc-assets-label--give { color: var(--color-error, #dc2626); }
        .ptc-asset-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .ptc-asset-item {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--color-gray-900, #111827);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ptc-asset-item--pick {
          font-weight: 400;
          font-size: 0.75rem;
          color: var(--color-gray-600, #4b5563);
        }
        .ptc-asset-item--empty {
          color: var(--color-gray-500, #6b7280);
          font-style: italic;
        }
        .ptc-message {
          font-size: 0.8125rem;
          color: var(--color-gray-600, #4b5563);
          border-left: 2px solid var(--color-gray-200, #e5e7eb);
          padding-left: 0.5rem;
          line-height: 1.4;
        }
        .ptc-actions {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .ptc-btn {
          padding: 0.375rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: var(--radius-sm, 0.25rem);
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.1s ease;
        }
        .ptc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ptc-btn:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .ptc-btn--accept {
          background: var(--color-success-dark, #059669);
          color: #fff;
        }
        .ptc-btn--accept:hover:not(:disabled) { background: var(--color-success-darker, #047857); }
        .ptc-btn--reject {
          background: transparent;
          border-color: var(--color-error, #dc2626);
          color: var(--color-error, #dc2626);
        }
        .ptc-btn--reject:hover:not(:disabled) { background: var(--color-error-light, #fee2e2); }
        .ptc-btn--counter {
          background: var(--color-gray-100, #f3f4f6);
          color: var(--color-gray-700, #374151);
        }
        .ptc-btn--counter:hover:not(:disabled) { background: var(--color-gray-200, #e5e7eb); }
        .ptc-btn--view {
          background: transparent;
          color: var(--color-gray-500, #6b7280);
          text-decoration: underline;
          border: none;
          padding: 0.375rem 0.5rem;
        }
        .ptc-btn--view:hover { color: var(--color-gray-700, #374151); }
        .ptc-confirm-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }
        .ptc-confirm-text {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--color-gray-700, #374151);
          flex: 1;
        }
        .ptc-btn--confirm-accept {
          background: var(--color-success-dark, #059669);
          color: #fff;
        }
        .ptc-btn--confirm-reject, .ptc-btn--confirm-withdraw {
          background: var(--color-error, #dc2626);
          color: #fff;
        }
        .ptc-btn--cancel {
          background: transparent;
          color: var(--color-gray-500, #6b7280);
          border: none;
        }
        .ptc-error {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: var(--color-error, #dc2626);
          background: var(--color-error-light, #fee2e2);
          border: 1px solid var(--color-error-border, #fecaca);
          border-radius: var(--radius-sm, 0.25rem);
          padding: 0.375rem 0.5rem;
        }
        .ptc-error-dismiss {
          background: none;
          border: none;
          color: var(--color-error, #dc2626);
          cursor: pointer;
          font-size: 1.25rem;
          line-height: 1;
          padding: 0.25rem;
          margin-left: auto;
          min-width: 2rem;
          min-height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ptc-error-dismiss:focus-visible {
          outline: 2px solid var(--color-error, #dc2626);
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .ptc-btn { transition: none; }
        }
      `}</style>
    </div>
  );
}
