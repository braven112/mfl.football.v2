import React from 'react';
import type {
  TradeBuilderTeam,
  TradeSide,
  TeamTradeImpact,
  TradeAction,
} from '../../../types/trade-builder';
import PlayerSelector from './PlayerSelector';
import PlayerCard from './PlayerCard';
import CapImpactCard from './CapImpactCard';
import DraftPickSelector from './DraftPickSelector';

interface Props {
  side: 'A' | 'B';
  teams: TradeBuilderTeam[];
  selectedTeam: TradeBuilderTeam | null;
  tradeSide: TradeSide;
  otherSideFranchiseId: string | null;
  tradeImpact: TeamTradeImpact | null;
  salaryYears: number[];
  salaryCap: number;
  dispatch: React.Dispatch<TradeAction>;
}

export default function TeamPanel({
  side,
  teams,
  selectedTeam,
  tradeSide,
  otherSideFranchiseId,
  tradeImpact,
  salaryYears,
  salaryCap,
  dispatch,
}: Props) {
  const selectedPlayers =
    selectedTeam?.players.filter((p) =>
      tradeSide.playerIds.includes(p.id)
    ) ?? [];

  const tradeBaitCount = selectedTeam?.players.filter((p) => p.tradeBait).length ?? 0;

  return (
    <div className="team-panel">
      <div className="team-panel__selector">
        <label className="team-panel__label" htmlFor={`team-${side}`}>
          {side === 'A' ? 'Team A' : 'Team B'}
        </label>
        <div className="team-panel__select-row">
          {selectedTeam?.icon && (
            <img src={selectedTeam.icon} alt="" className="team-panel__team-icon" />
          )}
          <select
            id={`team-${side}`}
            className="team-panel__select"
            value={tradeSide.franchiseId ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'SET_TEAM',
                side,
                franchiseId: e.target.value,
              })
            }
          >
            <option value="">Select a team...</option>
            {teams.map((team) => {
              const baitCount = team.players.filter((p) => p.tradeBait).length;
              return (
                <option
                  key={team.franchiseId}
                  value={team.franchiseId}
                  disabled={team.franchiseId === otherSideFranchiseId}
                >
                  {team.name}{baitCount > 0 ? ` (${baitCount} on trade block)` : ''}
                </option>
              );
            })}
          </select>
        </div>
        {tradeBaitCount > 0 && (
          <div className="team-panel__trade-bait-hint">
            🏷️ {tradeBaitCount} player{tradeBaitCount !== 1 ? 's' : ''} on the trade block
          </div>
        )}
      </div>

      {selectedTeam && (
        <>
          <PlayerSelector
            team={selectedTeam}
            selectedPlayerIds={tradeSide.playerIds}
            onAdd={(playerId) =>
              dispatch({ type: 'ADD_PLAYER', side, playerId })
            }
          />

          {selectedPlayers.length > 0 && (
            <div className="team-panel__selected">
              <h3 className="team-panel__section-title">In This Trade</h3>
              {selectedPlayers.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  rookieExtension={tradeSide.rookieExtensions[player.id]}
                  onRemove={() =>
                    dispatch({ type: 'REMOVE_PLAYER', side, playerId: player.id })
                  }
                  onSimulateExtension={() =>
                    dispatch({
                      type: 'SHOW_ROOKIE_MODAL',
                      playerId: player.id,
                      side,
                    })
                  }
                />
              ))}
            </div>
          )}

          <DraftPickSelector
            draftPicks={selectedTeam.draftPicks}
            selectedPicks={tradeSide.draftPicks}
            onAdd={(pick) =>
              dispatch({ type: 'ADD_DRAFT_PICK', side, pick })
            }
            onRemove={(pick) =>
              dispatch({ type: 'REMOVE_DRAFT_PICK', side, pick })
            }
          />

          <CapImpactCard
            team={selectedTeam}
            tradeImpact={tradeImpact}
            salaryCap={salaryCap}
            teamIcon={selectedTeam.icon}
          />
        </>
      )}

      <style>{`
        .team-panel {
          background: var(--primary-content-bg-color, #fff);
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.75rem;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .team-panel__selector {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .team-panel__label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
        }
        .team-panel__select-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .team-panel__team-icon {
          width: 36px;
          height: 36px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .team-panel__select {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border: 2px solid var(--primary-content-border-color, #e5e7eb);
          border-radius: 0.5rem;
          font-size: 0.9375rem;
          font-weight: 600;
          background: var(--primary-content-bg-color, #fff);
          color: var(--text-color, #1f2937);
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .team-panel__select:focus {
          outline: none;
          border-color: var(--primary-color, #1c497c);
          box-shadow: 0 0 0 3px rgba(28, 73, 124, 0.1);
        }
        .team-panel__trade-bait-hint {
          font-size: 0.75rem;
          font-weight: 600;
          color: #92400e;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 0.375rem;
          padding: 0.375rem 0.5rem;
          margin-top: 0.25rem;
        }
        .team-panel__section-title {
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
          margin: 0 0 0.5rem;
          padding-bottom: 0.375rem;
          border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
        }
        .team-panel__selected {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
      `}</style>
    </div>
  );
}
