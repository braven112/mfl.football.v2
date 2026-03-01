/**
 * TradeValueAnalysis — shows surplus value per player and draft pick,
 * with net balance per side.
 *
 * Only renders when surplusMap is non-empty (admin users only).
 * Draft pick values use TheLeague's slotted salary schedule.
 */

import React, { useMemo } from 'react';
import type { TradeBuilderPlayer, PlayerSurplusData, DraftPickKey, DraftPickValueData } from '../../../types/trade-builder';
import { formatCompactNumber } from '../../../utils/formatters';

interface Props {
  teamAName: string;
  teamBName: string;
  teamAIcon: string;
  teamBIcon: string;
  teamAPlayers: TradeBuilderPlayer[];
  teamBPlayers: TradeBuilderPlayer[];
  teamADraftPicks: DraftPickKey[];
  teamBDraftPicks: DraftPickKey[];
  surplusMap: Record<string, PlayerSurplusData>;
  pickValueMap?: Record<string, DraftPickValueData>;
}

function formatSurplus(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${formatCompactNumber(Math.abs(value))}`;
}

function pickKey(pick: DraftPickKey): string {
  return `${pick.year}-${pick.round}-${pick.originalPickFor}`;
}

export default function TradeValueAnalysis({
  teamAName,
  teamBName,
  teamAIcon,
  teamBIcon,
  teamAPlayers,
  teamBPlayers,
  teamADraftPicks,
  teamBDraftPicks,
  surplusMap,
  pickValueMap,
}: Props) {
  const analysis = useMemo(() => {
    const sumPlayerSurplus = (players: TradeBuilderPlayer[]) =>
      players.reduce((sum, p) => sum + (surplusMap[p.id]?.surplusValue ?? 0), 0);

    const sumPickSurplus = (picks: DraftPickKey[]) =>
      picks.reduce((sum, p) => {
        const val = pickValueMap?.[pickKey(p)];
        return sum + (val?.surplusValue ?? 0);
      }, 0);

    const teamAPlayerSurplus = sumPlayerSurplus(teamAPlayers);
    const teamBPlayerSurplus = sumPlayerSurplus(teamBPlayers);
    const teamAPickSurplus = sumPickSurplus(teamADraftPicks);
    const teamBPickSurplus = sumPickSurplus(teamBDraftPicks);

    const teamAGivesSurplus = teamAPlayerSurplus + teamAPickSurplus;
    const teamBGivesSurplus = teamBPlayerSurplus + teamBPickSurplus;

    return {
      teamAGivesSurplus,
      teamBGivesSurplus,
      netSurplusA: teamBGivesSurplus - teamAGivesSurplus,
      netSurplusB: teamAGivesSurplus - teamBGivesSurplus,
    };
  }, [teamAPlayers, teamBPlayers, teamADraftPicks, teamBDraftPicks, surplusMap, pickValueMap]);

  if (Object.keys(surplusMap).length === 0) return null;

  const renderPlayerSurplus = (player: TradeBuilderPlayer) => {
    const data = surplusMap[player.id];
    if (!data) {
      return (
        <div key={player.id} className="tva__player">
          <span className="tva__player-name">{player.name}</span>
          <span className="tva__player-value tva__player-value--na">n/a</span>
        </div>
      );
    }
    const isPositive = data.surplusValue >= 0;
    return (
      <div key={player.id} className="tva__player">
        <span className="tva__player-name">{player.name}</span>
        <span
          className={`tva__player-value ${
            isPositive ? 'tva__player-value--positive' : 'tva__player-value--negative'
          }`}
        >
          {formatSurplus(data.surplusValue)}
        </span>
      </div>
    );
  };

  const renderDraftPick = (pick: DraftPickKey) => {
    const val = pickValueMap?.[pickKey(pick)];
    const hasPkValue = val && val.surplusValue !== 0;

    return (
      <div key={pickKey(pick)} className="tva__player">
        <span className="tva__player-name">
          {pick.year} Rd {pick.round}
        </span>
        {hasPkValue ? (
          <span className="tva__player-value tva__player-value--positive">
            {formatSurplus(val.surplusValue)}
            <span className="tva__pick-detail">/yr</span>
          </span>
        ) : (
          <span className="tva__player-value tva__player-value--na">n/a</span>
        )}
      </div>
    );
  };

  const hasTeamAAssets = teamAPlayers.length > 0 || teamADraftPicks.length > 0;
  const hasTeamBAssets = teamBPlayers.length > 0 || teamBDraftPicks.length > 0;

  // Determine which team the admin is (Team A perspective is "you")
  const netForDisplay = analysis.netSurplusA;
  const netIsPositive = netForDisplay >= 0;

  return (
    <div className="tva">
      <h3 className="tva__title">Value Analysis</h3>

      <div className="tva__columns">
        {/* Team A gives (these players go to Team B) */}
        <div className="tva__column">
          <div className="tva__column-header">
            {teamAIcon && (
              <img src={teamAIcon} alt="" className="tva__team-icon" />
            )}
            <span>{teamAName} sends</span>
          </div>
          <div className="tva__player-list">
            {teamAPlayers.map(renderPlayerSurplus)}
            {teamADraftPicks.map(renderDraftPick)}
            {!hasTeamAAssets && (
              <div className="tva__empty">No assets</div>
            )}
          </div>
          {hasTeamAAssets && (
            <div className="tva__total">
              <span>Total surplus</span>
              <span
                className={
                  analysis.teamAGivesSurplus >= 0
                    ? 'tva__player-value--positive'
                    : 'tva__player-value--negative'
                }
              >
                {formatSurplus(analysis.teamAGivesSurplus)}
              </span>
            </div>
          )}
        </div>

        {/* Team B gives (these players go to Team A) */}
        <div className="tva__column">
          <div className="tva__column-header">
            {teamBIcon && (
              <img src={teamBIcon} alt="" className="tva__team-icon" />
            )}
            <span>{teamBName} sends</span>
          </div>
          <div className="tva__player-list">
            {teamBPlayers.map(renderPlayerSurplus)}
            {teamBDraftPicks.map(renderDraftPick)}
            {!hasTeamBAssets && (
              <div className="tva__empty">No assets</div>
            )}
          </div>
          {hasTeamBAssets && (
            <div className="tva__total">
              <span>Total surplus</span>
              <span
                className={
                  analysis.teamBGivesSurplus >= 0
                    ? 'tva__player-value--positive'
                    : 'tva__player-value--negative'
                }
              >
                {formatSurplus(analysis.teamBGivesSurplus)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Net surplus balance */}
      {(hasTeamAAssets || hasTeamBAssets) && (
        <div
          className={`tva__net ${
            netIsPositive ? 'tva__net--positive' : 'tva__net--negative'
          }`}
        >
          <strong>Net:</strong>{' '}
          {teamAName} {netIsPositive ? 'receives' : 'gives up'}{' '}
          {formatSurplus(Math.abs(netForDisplay))} in surplus value
        </div>
      )}

      <style>{`
        .tva {
          margin-top: 1.5rem;
          background: var(--primary-content-bg-color, #fff);
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.5rem;
          padding: 1rem;
        }
        .tva__title {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-color, #1f2937);
          margin: 0 0 0.75rem;
        }
        .tva__columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .tva__column {
          display: flex;
          flex-direction: column;
        }
        .tva__column-header {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary-color, #64748b);
          margin-bottom: 0.5rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
        }
        .tva__team-icon {
          width: 16px;
          height: 16px;
          object-fit: contain;
        }
        .tva__player-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .tva__player {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8rem;
          padding: 0.2rem 0;
        }
        .tva__player-name {
          color: var(--text-color, #1f2937);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-right: 0.5rem;
        }
        .tva__player-value {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .tva__player-value--positive {
          color: #059669;
        }
        .tva__player-value--negative {
          color: #dc2626;
        }
        .tva__player-value--na {
          color: var(--text-secondary-color, #64748b);
          font-style: italic;
          font-weight: 400;
        }
        .tva__pick-detail {
          font-weight: 400;
          font-size: 0.7rem;
          opacity: 0.7;
          margin-left: 1px;
        }
        .tva__empty {
          font-size: 0.8rem;
          color: var(--text-secondary-color, #64748b);
          font-style: italic;
          padding: 0.25rem 0;
        }
        .tva__total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8rem;
          font-weight: 600;
          padding-top: 0.35rem;
          margin-top: 0.35rem;
          border-top: 1px solid var(--primary-content-border-color, #e2e8f0);
          color: var(--text-color, #1f2937);
        }
        .tva__net {
          margin-top: 0.75rem;
          padding: 0.6rem 0.75rem;
          border-radius: 6px;
          font-size: 0.85rem;
          text-align: center;
        }
        .tva__net--positive {
          background: rgba(5, 150, 105, 0.08);
          color: #059669;
        }
        .tva__net--negative {
          background: rgba(220, 38, 38, 0.06);
          color: #dc2626;
        }
        @media (max-width: 640px) {
          .tva__columns {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
