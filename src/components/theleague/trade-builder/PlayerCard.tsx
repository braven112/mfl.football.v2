import React from 'react';
import type { TradeBuilderPlayer, RookieExtensionSim } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

const DEFAULT_HEADSHOT = 'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

interface Props {
  player: TradeBuilderPlayer;
  rookieExtension?: RookieExtensionSim;
  onRemove: () => void;
  onSimulateExtension: () => void;
}

export default function PlayerCard({
  player,
  rookieExtension,
  onRemove,
  onSimulateExtension,
}: Props) {
  const isDef = player.position.toUpperCase() === 'DEF';
  const avatarSrc = isDef && player.nflLogo ? player.nflLogo : (player.headshot || DEFAULT_HEADSHOT);
  const statusLabel =
    player.normalizedStatus === 'PRACTICE'
      ? 'TAXI'
      : player.normalizedStatus === 'INJURED'
        ? 'IR'
        : null;

  return (
    <div className={`player-card${player.tradeBait ? ' player-card--trade-bait' : ''}`}>
      <div className="player-card__header">
        <div className={`player-card__avatar${isDef ? ' player-card__avatar--def' : ''}`}>
          <img
            src={avatarSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => { (e.target as HTMLImageElement).onerror = null; (e.target as HTMLImageElement).src = DEFAULT_HEADSHOT; }}
          />
        </div>
        <div className="player-card__info">
          <span className="player-card__name">{player.name}</span>
          <div className="player-card__meta">
            {!isDef && player.nflLogo && (
              <img src={player.nflLogo} alt="" className="player-card__nfl-logo" loading="lazy" decoding="async" />
            )}
            <span className="player-card__pos">{player.position}</span>
            {statusLabel && (
              <span className="player-card__status">{statusLabel}</span>
            )}
            {player.tradeBait && (
              <span className="player-card__trade-bait" title="On Trade Block">🏷️</span>
            )}
          </div>
        </div>
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
          background: var(--primary-content-bg-color, #fff);
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.5rem;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .player-card--trade-bait {
          border-left: 3px solid #f59e0b;
          background: #fffbeb;
        }
        .player-card__header {
          display: flex;
          align-items: center;
          gap: 0.625rem;
        }
        .player-card__avatar {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--avatar-bg-color, #f3f4f6);
          border: 1px solid #e2e8f0;
        }
        .player-card__avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }
        .player-card__avatar--def img {
          object-fit: contain;
          object-position: center;
        }
        .player-card__info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .player-card__name {
          display: block;
          font-weight: 600;
          font-size: 0.9375rem;
          color: var(--text-color, #1f2937);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }
        .player-card__meta {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.8125rem;
          color: var(--text-secondary-color, #64748b);
        }
        .player-card__nfl-logo {
          width: 16px;
          height: 16px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .player-card__pos {
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .player-card__status {
          margin-left: 0.25rem;
          padding: 0.0625rem 0.25rem;
          background: #fef3c7;
          color: #92400e;
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
          color: var(--muted-text-color, #6b7280);
          font-size: 1.25rem;
          cursor: pointer;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          line-height: 1;
          flex-shrink: 0;
        }
        .player-card__remove:hover {
          background: #fee2e2;
          color: #dc2626;
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
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
        }
        .player-card__detail-value {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-color, #1f2937);
        }
        .player-card__detail-value--muted {
          font-size: 0.75rem;
          color: var(--muted-text-color, #6b7280);
          font-weight: 500;
        }
        .player-card__rookie-warning {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          padding: 0.375rem 0.5rem;
          background: #fef3c7;
          border-radius: 0.375rem;
        }
        .player-card__rookie-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: #92400e;
        }
        .player-card__rookie-text {
          font-size: 0.6875rem;
          color: #78350f;
          flex: 1;
        }
        .player-card__ext-btn {
          padding: 0.25rem 0.5rem;
          font-size: 0.6875rem;
          font-weight: 600;
          border: 1px solid #92400e;
          border-radius: 0.25rem;
          background: transparent;
          color: #92400e;
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .player-card__ext-btn:hover {
          background: #92400e;
          color: #fff;
        }
        .player-card__ext-btn--edit {
          border-color: #166534;
          color: #166534;
        }
        .player-card__ext-btn--edit:hover {
          background: #166534;
          color: #fff;
        }
        .player-card__extension-applied {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.5rem;
          background: #dcfce7;
          border-radius: 0.375rem;
        }
        .player-card__ext-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: #166534;
          flex: 1;
        }
        .player-card__tag-badge {
          font-size: 0.6875rem;
          font-weight: 700;
          color: #7c3aed;
          background: #ede9fe;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
