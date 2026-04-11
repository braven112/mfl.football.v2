import React from 'react';
import type { TradeBuilderPlayer, RookieExtensionSim } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';
import { PlayerCell } from '../PlayerCell';


interface Props {
  player: TradeBuilderPlayer;
  rookieExtension?: RookieExtensionSim;
  onRemove: () => void;
  onSimulateExtension: () => void;
  compositeRank?: number | null;
}

export default function PlayerCard({
  player,
  rookieExtension,
  onRemove,
  onSimulateExtension,
  compositeRank,
}: Props) {
  const statusLabel =
    player.normalizedStatus === 'PRACTICE'
      ? 'TAXI'
      : player.normalizedStatus === 'INJURED'
        ? 'IR'
        : null;

  return (
    <div className={`player-card${player.tradeBait ? ' player-card--trade-bait' : ''}`}>
      <div className="player-card__header">
        <PlayerCell
          className="player-card__lockup"
          name={player.name}
          headshot={player.headshot}
          position={player.position}
          nflTeam={player.nflTeam}
          nflLogo={player.nflLogo}
          metaSlot={<>
            {statusLabel && <span className="player-card__status">{statusLabel}</span>}
            {player.tradeBait && <span className="player-card__trade-bait" title="On Trade Block">🏷️</span>}
          </>}
        />
        <button
          className="player-card__remove"
          onClick={onRemove}
          title={`Remove ${player.name}`}
          aria-label={`Remove ${player.name}`}
        >
          &times;
        </button>
      </div>

      <div className="player-card__details">
        <div className="player-card__detail">
          <span className="player-card__detail-label">Salary</span>
          <span className="player-card__detail-value">
            {rookieExtension
              ? formatCurrency(rookieExtension.newSalary)
              : formatCurrency(player.salary)}
          </span>
        </div>
        <div className="player-card__detail">
          <span className="player-card__detail-label">Years</span>
          <span className="player-card__detail-value">
            {rookieExtension
              ? rookieExtension.newContractYears
              : player.contractYears}
          </span>
        </div>
        {compositeRank != null && (
          <div className="player-card__detail">
            <span className="player-card__detail-label">My Rank</span>
            <span className="player-card__detail-value player-card__detail-value--rank">#{compositeRank}</span>
          </div>
        )}
        {player.normalizedStatus === 'PRACTICE' && (
          <div className="player-card__detail">
            <span className="player-card__detail-label">Cap Hit</span>
            <span className="player-card__detail-value player-card__detail-value--muted">
              50% current yr
            </span>
          </div>
        )}
      </div>

      {player.isRookie && !rookieExtension && (
        <div className="player-card__rookie-warning">
          <span className="player-card__rookie-badge">Rookie Contract</span>
          <span className="player-card__rookie-text">
            Must extend if traded
          </span>
          <button
            className="player-card__ext-btn"
            onClick={onSimulateExtension}
          >
            Simulate Extension
          </button>
        </div>
      )}

      {player.isRookie && rookieExtension && (
        <div className="player-card__extension-applied">
          <span className="player-card__ext-badge">
            Extension: +{rookieExtension.extensionYears}yr
          </span>
          <button
            className="player-card__ext-btn player-card__ext-btn--edit"
            onClick={onSimulateExtension}
          >
            Edit
          </button>
        </div>
      )}

      {player.isFranchiseTagged && (
        <div className="player-card__tag-badge">Franchise Tagged</div>
      )}

      <style>{`
        .player-card {
          background: var(--content-bg, #fff);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .player-card--trade-bait {
          border-left: 3px solid var(--color-warning, #f59e0b);
          background: var(--color-warning-light, #fef3c7);
        }
        .player-card__header {
          display: flex;
          align-items: center;
          gap: 0.625rem;
        }
        .player-card__lockup {
          flex: 1;
          min-width: 0;
        }
        .player-card__status {
          margin-left: 0.25rem;
          padding: 0.0625rem 0.25rem;
          background: var(--color-warning-light, #fef3c7);
          color: var(--color-warning-dark, #d97706);
          font-size: 0.625rem;
          font-weight: 700;
          border-radius: 0.1875rem;
        }
        .player-card__trade-bait {
          font-size: 0.75rem;
          cursor: default;
        }
        .player-card__remove {
          background: none;
          border: none;
          color: var(--color-gray-500, #6b7280);
          font-size: 1.25rem;
          cursor: pointer;
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm, 0.25rem);
          line-height: 1;
          flex-shrink: 0;
        }
        .player-card__remove:hover {
          background: var(--color-error-light, #fee2e2);
          color: var(--color-error, #dc2626);
        }
        .player-card__details {
          display: flex;
          gap: 1rem;
          padding-left: calc(40px + 0.625rem);
        }
        .player-card__detail {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }
        .player-card__detail-label {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-500, #6b7280);
        }
        .player-card__detail-value {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--color-gray-900, #111827);
          font-variant-numeric: tabular-nums;
        }
        .player-card__detail-value--muted {
          font-size: 0.75rem;
          color: var(--color-gray-500, #6b7280);
          font-weight: 500;
        }
        .player-card__detail-value--rank {
          color: var(--color-primary, #1c497c);
        }
        .player-card__rookie-warning {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          padding: 0.375rem 0.5rem;
          background: var(--color-warning-light, #fef3c7);
          border-radius: var(--radius-sm, 0.25rem);
        }
        .player-card__rookie-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--color-warning-dark, #d97706);
        }
        .player-card__rookie-text {
          font-size: 0.6875rem;
          color: var(--color-warning-dark, #d97706);
          flex: 1;
        }
        .player-card__ext-btn {
          padding: 0.25rem 0.5rem;
          font-size: 0.6875rem;
          font-weight: 600;
          border: 1px solid var(--color-warning-dark, #d97706);
          border-radius: var(--radius-sm, 0.25rem);
          background: transparent;
          color: var(--color-warning-dark, #d97706);
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .player-card__ext-btn:hover {
          background: var(--color-warning-dark, #d97706);
          color: #fff;
        }
        .player-card__ext-btn--edit {
          border-color: var(--color-success-dark, #059669);
          color: var(--color-success-dark, #059669);
        }
        .player-card__ext-btn--edit:hover {
          background: var(--color-success-dark, #059669);
          color: #fff;
        }
        .player-card__ext-btn:focus-visible,
        .player-card__remove:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .player-card__extension-applied {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.5rem;
          background: var(--color-success-light, #d1fae5);
          border-radius: var(--radius-sm, 0.25rem);
        }
        .player-card__ext-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--color-success-dark, #059669);
          flex: 1;
        }
        .player-card__tag-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--color-franchise-tag, #7c3aed);
          background: var(--color-franchise-tag-light, #ede9fe);
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm, 0.25rem);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
