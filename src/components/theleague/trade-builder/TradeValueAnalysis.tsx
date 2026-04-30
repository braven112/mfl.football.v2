/**
 * TradeValueAnalysis — shows surplus value per player and draft pick,
 * with net balance per side.
 *
 * Only renders when surplusMap is non-empty (admin users only).
 * Draft pick values use TheLeague's slotted salary schedule.
 */

import React, { useMemo } from 'react';
import type { TradeBuilderPlayer, TradeBuilderTeam, PlayerSurplusData, DraftPickKey, DraftPickValueData } from '../../../types/trade-builder';
import { formatCompactNumber } from '../../../utils/formatters';
import type { RankingLookup } from '../../../utils/rankings-lookup';
import { getPlayerRank, COMPOSITE_IMPORT_ID } from '../../../utils/rankings-lookup';

interface Props {
  teamAName: string;
  teamBName: string;
  teamAIcon: string;
  teamBIcon: string;
  teamAPlayers: TradeBuilderPlayer[];
  teamBPlayers: TradeBuilderPlayer[];
  teamADraftPicks: DraftPickKey[];
  teamBDraftPicks: DraftPickKey[];
  /** Used to resolve `pickInRound` for current-year picks. */
  allTeams: TradeBuilderTeam[];
  surplusMap: Record<string, PlayerSurplusData>;
  pickValueMap?: Record<string, DraftPickValueData>;
  rankingLookup?: RankingLookup | null;
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
  allTeams,
  surplusMap,
  pickValueMap,
  rankingLookup,
}: Props) {
  // Resolve a pick's pre-computed pickInRound (set only for current-year picks)
  // by matching against any team's draftPicks list.
  const lookupPickInRound = (pick: DraftPickKey): number | undefined => {
    for (const t of allTeams) {
      const dp = t.draftPicks.find(
        d =>
          d.year === pick.year &&
          d.round === pick.round &&
          d.originalPickFor === pick.originalPickFor,
      );
      if (dp) return dp.pickInRound;
    }
    return undefined;
  };
  const analysis = useMemo(() => {
    const sumPlayerSurplus = (players: TradeBuilderPlayer[]) =>
      players.reduce((sum, p) => sum + (surplusMap[p.id]?.surplusValue ?? 0), 0);

    const sumPickSurplus = (picks: DraftPickKey[]) =>
      picks.reduce((sum, p) => {
        const val = pickValueMap?.[pickKey(p)];
        return sum + (val?.surplusValue ?? 0);
      }, 0);

    const avgRank = (players: TradeBuilderPlayer[]) => {
      if (!rankingLookup) return null;
      const ranks = players
        .map((p) => getPlayerRank(rankingLookup, p.id, COMPOSITE_IMPORT_ID))
        .filter((r): r is number => r !== null);
      if (ranks.length === 0) return null;
      return Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length);
    };

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
      avgRankA: avgRank(teamAPlayers),
      avgRankB: avgRank(teamBPlayers),
    };
  }, [teamAPlayers, teamBPlayers, teamADraftPicks, teamBDraftPicks, surplusMap, pickValueMap, rankingLookup]);

  if (Object.keys(surplusMap).length === 0) return null;

  const renderPlayerSurplus = (player: TradeBuilderPlayer) => {
    const data = surplusMap[player.id];
    const rank = rankingLookup ? getPlayerRank(rankingLookup, player.id, COMPOSITE_IMPORT_ID) : null;
    if (!data) {
      return (
        <div key={player.id} className="tva__player">
          <span className="tva__player-name">{player.name}</span>
          {rank != null && <span className="tva__rank">#{rank}</span>}
          <span className="tva__player-value tva__player-value--na">n/a</span>
        </div>
      );
    }
    const isPositive = data.surplusValue >= 0;
    return (
      <div key={player.id} className="tva__player">
        <span className="tva__player-name">{player.name}</span>
        {rank != null && <span className="tva__rank">#{rank}</span>}
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
    const pickInRound = lookupPickInRound(pick);
    const roundLabel = pickInRound != null
      ? `${pick.round}.${String(pickInRound).padStart(2, '0')}`
      : `Rd ${pick.round}`;

    return (
      <div key={pickKey(pick)} className="tva__player">
        <span className="tva__player-name">
          {pick.year} {roundLabel}
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

      {/* Rank summary */}
      {(analysis.avgRankA != null || analysis.avgRankB != null) && (
        <div className="tva__rank-summary">
          {analysis.avgRankA != null && (
            <span className="tva__rank-summary-item">
              Avg rank sent: <strong>#{analysis.avgRankA}</strong>
            </span>
          )}
          {analysis.avgRankA != null && analysis.avgRankB != null && (
            <span className="tva__rank-summary-sep">|</span>
          )}
          {analysis.avgRankB != null && (
            <span className="tva__rank-summary-item">
              Avg rank received: <strong>#{analysis.avgRankB}</strong>
            </span>
          )}
        </div>
      )}

      <style>{`
        .tva {
          margin-top: 1.5rem;
          background: var(--content-bg, #fff);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          padding: 1rem;
        }
        .tva__title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0 0 0.75rem;
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
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
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-gray-600, #4b5563);
          margin-bottom: 0.5rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid var(--content-border, #e2e8f0);
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
          color: var(--color-gray-900, #111827);
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
          color: var(--color-success-dark, #059669);
        }
        .tva__player-value--negative {
          color: var(--color-error, #dc2626);
        }
        .tva__player-value--na {
          color: var(--color-gray-600, #4b5563);
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
          color: var(--color-gray-600, #4b5563);
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
          border-top: 1px solid var(--content-border, #e2e8f0);
          color: var(--color-gray-900, #111827);
        }
        .tva__net {
          margin-top: 0.75rem;
          padding: 0.6rem 0.75rem;
          border-radius: var(--radius-sm, 0.25rem);
          font-size: 0.85rem;
          text-align: center;
        }
        .tva__net--positive {
          background: var(--color-success-light, #d1fae5);
          color: var(--color-success-dark, #059669);
        }
        .tva__net--negative {
          background: var(--color-error-light, #fee2e2);
          color: var(--color-error, #dc2626);
        }
        .tva__rank {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--color-gray-400, #9ca3af);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .tva__rank-summary {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          font-size: 0.75rem;
          color: var(--color-gray-600, #4b5563);
          font-variant-numeric: tabular-nums;
        }
        .tva__rank-summary-item strong {
          color: var(--color-primary, #1c497c);
        }
        .tva__rank-summary-sep {
          color: var(--color-gray-300, #d1d5db);
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
