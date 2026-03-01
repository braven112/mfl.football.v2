import React, { useReducer, useMemo, useCallback, useEffect } from 'react';
import type {
  TradeBuilderPageData,
  TradeState,
  TradeAction,
  TradeSide,
  DraftPickKey,
} from '../../../types/trade-builder';
import {
  computeTeamTradeImpact,
  serializeTradeToParams,
  deserializeTradeFromParams,
} from '../../../utils/trade-calculations';
import TeamPanel from './TeamPanel';
import TradeBaitMarketplace from './TradeBaitMarketplace';
import MultiYearCapTable from './MultiYearCapTable';
import TradeAnalysisSummary from './TradeAnalysisSummary';
import TradeValueAnalysis from './TradeValueAnalysis';
import RookieExtensionModal from './RookieExtensionModal';

const EMPTY_SIDE: TradeSide = {
  franchiseId: null,
  playerIds: [],
  draftPicks: [],
  rookieExtensions: {},
};

function tradeReducer(state: TradeState, action: TradeAction): TradeState {
  const getSide = (side: 'A' | 'B') =>
    side === 'A' ? state.teamA : state.teamB;
  const setSide = (side: 'A' | 'B', data: TradeSide) =>
    side === 'A' ? { ...state, teamA: data } : { ...state, teamB: data };

  switch (action.type) {
    case 'SET_TEAM': {
      const otherSide = action.side === 'A' ? 'B' : 'A';
      const otherFranchise = getSide(otherSide).franchiseId;
      if (action.franchiseId === otherFranchise) return state;
      return setSide(action.side, {
        ...EMPTY_SIDE,
        franchiseId: action.franchiseId,
      });
    }
    case 'ADD_PLAYER': {
      const side = getSide(action.side);
      if (side.playerIds.includes(action.playerId)) return state;
      return setSide(action.side, {
        ...side,
        playerIds: [...side.playerIds, action.playerId],
      });
    }
    case 'REMOVE_PLAYER': {
      const side = getSide(action.side);
      const { [action.playerId]: _, ...remainingExtensions } =
        side.rookieExtensions;
      return setSide(action.side, {
        ...side,
        playerIds: side.playerIds.filter((id) => id !== action.playerId),
        rookieExtensions: remainingExtensions,
      });
    }
    case 'ADD_DRAFT_PICK': {
      const side = getSide(action.side);
      const exists = side.draftPicks.some(
        (p) =>
          p.year === action.pick.year &&
          p.round === action.pick.round &&
          p.originalPickFor === action.pick.originalPickFor
      );
      if (exists) return state;
      return setSide(action.side, {
        ...side,
        draftPicks: [...side.draftPicks, action.pick],
      });
    }
    case 'REMOVE_DRAFT_PICK': {
      const side = getSide(action.side);
      return setSide(action.side, {
        ...side,
        draftPicks: side.draftPicks.filter(
          (p) =>
            !(
              p.year === action.pick.year &&
              p.round === action.pick.round &&
              p.originalPickFor === action.pick.originalPickFor
            )
        ),
      });
    }
    case 'SET_ROOKIE_EXTENSION': {
      const side = getSide(action.side);
      return setSide(action.side, {
        ...side,
        rookieExtensions: {
          ...side.rookieExtensions,
          [action.playerId]: action.sim,
        },
      });
    }
    case 'CLEAR_ROOKIE_EXTENSION': {
      const side = getSide(action.side);
      const { [action.playerId]: _, ...rest } = side.rookieExtensions;
      return setSide(action.side, { ...side, rookieExtensions: rest });
    }
    case 'SHOW_ROOKIE_MODAL':
      return {
        ...state,
        rookieModalTarget: {
          playerId: action.playerId,
          side: action.side,
        },
      };
    case 'HIDE_ROOKIE_MODAL':
      return { ...state, rookieModalTarget: null };
    case 'SWAP_TEAMS':
      return { ...state, teamA: state.teamB, teamB: state.teamA };
    case 'RESET':
      return {
        teamA: { ...EMPTY_SIDE, franchiseId: state.teamA.franchiseId },
        teamB: { ...EMPTY_SIDE, franchiseId: state.teamB.franchiseId },
        rookieModalTarget: null,
      };
    case 'START_TRADE_FOR_PLAYER': {
      // If the clicked player's team is already Team A, swap so it becomes B
      const targetFranchise = action.franchiseId;
      const currentA = state.teamA.franchiseId;
      const currentB = state.teamB.franchiseId;

      if (targetFranchise === currentA) {
        // Swap teams so this franchise moves to B side, then add player
        return {
          ...state,
          teamA: { ...state.teamB },
          teamB: {
            ...state.teamA,
            playerIds: state.teamA.playerIds.includes(action.playerId)
              ? state.teamA.playerIds
              : [...state.teamA.playerIds, action.playerId],
          },
          rookieModalTarget: null,
        };
      }

      // If it's already Team B, just add the player
      if (targetFranchise === currentB) {
        return {
          ...state,
          teamB: {
            ...state.teamB,
            playerIds: state.teamB.playerIds.includes(action.playerId)
              ? state.teamB.playerIds
              : [...state.teamB.playerIds, action.playerId],
          },
        };
      }

      // New team — set as Team B, reset that side, add the player
      return {
        ...state,
        teamB: {
          ...EMPTY_SIDE,
          franchiseId: targetFranchise,
          playerIds: [action.playerId],
        },
        rookieModalTarget: null,
      };
    }
    default:
      return state;
  }
}

interface Props {
  pageData: string;
  defaultTeamId: string;
}

export default function TradeBuilder({ pageData, defaultTeamId }: Props) {
  const data: TradeBuilderPageData = useMemo(
    () => JSON.parse(pageData),
    [pageData]
  );

  // Initialize from URL params or defaults
  const initialState = useMemo((): TradeState => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const restored = deserializeTradeFromParams(params);
      if (restored.teamAId && restored.teamBId) {
        return {
          teamA: {
            franchiseId: restored.teamAId,
            playerIds: restored.teamAPlayerIds,
            draftPicks: restored.teamADraftPicks,
            rookieExtensions: {},
          },
          teamB: {
            franchiseId: restored.teamBId,
            playerIds: restored.teamBPlayerIds,
            draftPicks: restored.teamBDraftPicks,
            rookieExtensions: {},
          },
          rookieModalTarget: null,
        };
      }
    }

    // No user preference — pick the 2 teams with the most cap room
    if (!defaultTeamId && data.teams.length >= 2) {
      const byCapSpace = [...data.teams].sort(
        (a, b) => b.currentCapSpace - a.currentCapSpace
      );
      return {
        teamA: { ...EMPTY_SIDE, franchiseId: byCapSpace[0].franchiseId },
        teamB: { ...EMPTY_SIDE, franchiseId: byCapSpace[1].franchiseId },
        rookieModalTarget: null,
      };
    }

    return {
      teamA: { ...EMPTY_SIDE, franchiseId: defaultTeamId || null },
      teamB: { ...EMPTY_SIDE },
      rookieModalTarget: null,
    };
  }, [defaultTeamId, data.teams]);

  const [state, dispatch] = useReducer(tradeReducer, initialState);

  // Team data lookups
  const teamA = useMemo(
    () => data.teams.find((t) => t.franchiseId === state.teamA.franchiseId),
    [data, state.teamA.franchiseId]
  );
  const teamB = useMemo(
    () => data.teams.find((t) => t.franchiseId === state.teamB.franchiseId),
    [data, state.teamB.franchiseId]
  );

  // Get selected players
  const teamAPlayers = useMemo(
    () =>
      teamA?.players.filter((p) => state.teamA.playerIds.includes(p.id)) ?? [],
    [teamA, state.teamA.playerIds]
  );
  const teamBPlayers = useMemo(
    () =>
      teamB?.players.filter((p) => state.teamB.playerIds.includes(p.id)) ?? [],
    [teamB, state.teamB.playerIds]
  );

  // Compute trade impact
  const tradeImpactA = useMemo(() => {
    if (!teamA || (teamAPlayers.length === 0 && teamBPlayers.length === 0))
      return null;
    // Team A sends teamAPlayers, receives teamBPlayers
    // For incoming players (teamBPlayers), check if the OTHER side has rookie extensions
    return computeTeamTradeImpact(
      teamA,
      teamAPlayers,
      teamBPlayers,
      state.teamA.rookieExtensions
    );
  }, [teamA, teamAPlayers, teamBPlayers, state.teamA.rookieExtensions]);

  const tradeImpactB = useMemo(() => {
    if (!teamB || (teamAPlayers.length === 0 && teamBPlayers.length === 0))
      return null;
    // Team B sends teamBPlayers, receives teamAPlayers
    return computeTeamTradeImpact(
      teamB,
      teamBPlayers,
      teamAPlayers,
      state.teamB.rookieExtensions
    );
  }, [teamB, teamAPlayers, teamBPlayers, state.teamB.rookieExtensions]);

  const hasTrade =
    teamAPlayers.length > 0 ||
    teamBPlayers.length > 0 ||
    state.teamA.draftPicks.length > 0 ||
    state.teamB.draftPicks.length > 0;

  // Copy share link
  const handleCopyLink = useCallback(() => {
    const params = serializeTradeToParams({
      teamAId: state.teamA.franchiseId,
      teamBId: state.teamB.franchiseId,
      teamAPlayerIds: state.teamA.playerIds,
      teamBPlayerIds: state.teamB.playerIds,
      teamADraftPicks: state.teamA.draftPicks,
      teamBDraftPicks: state.teamB.draftPicks,
    });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url);
  }, [state]);

  // Update URL when trade changes
  useEffect(() => {
    if (!hasTrade) return;
    const params = serializeTradeToParams({
      teamAId: state.teamA.franchiseId,
      teamBId: state.teamB.franchiseId,
      teamAPlayerIds: state.teamA.playerIds,
      teamBPlayerIds: state.teamB.playerIds,
      teamADraftPicks: state.teamA.draftPicks,
      teamBDraftPicks: state.teamB.draftPicks,
    });
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [state.teamA, state.teamB, hasTrade]);

  // Rookie modal target player
  const rookieModalPlayer = useMemo(() => {
    if (!state.rookieModalTarget) return null;
    const { playerId, side } = state.rookieModalTarget;
    const team = side === 'A' ? teamA : teamB;
    return team?.players.find((p) => p.id === playerId) ?? null;
  }, [state.rookieModalTarget, teamA, teamB]);

  return (
    <div className="trade-builder">
      <div className="trade-builder__header">
        <h1>Trade Builder</h1>
        <div className="trade-builder__actions">
          <button
            className="btn btn--secondary"
            onClick={() => dispatch({ type: 'RESET' })}
            disabled={!hasTrade}
          >
            Reset
          </button>
          <button
            className="btn btn--secondary"
            onClick={handleCopyLink}
            disabled={!hasTrade}
          >
            Copy Link
          </button>
        </div>
      </div>

      <div className="trade-builder__panels">
        <TeamPanel
          side="A"
          teams={data.teams}
          selectedTeam={teamA ?? null}
          tradeSide={state.teamA}
          otherSideFranchiseId={state.teamB.franchiseId}
          tradeImpact={tradeImpactA}
          salaryYears={data.salaryYears}
          salaryCap={data.salaryCap}
          dispatch={dispatch}
        />

        <div className="trade-builder__divider">
          <button
            className="trade-builder__swap"
            onClick={() => dispatch({ type: 'SWAP_TEAMS' })}
            title="Swap teams"
            aria-label="Swap teams"
          >
            &#8644;
          </button>
        </div>

        <TeamPanel
          side="B"
          teams={data.teams}
          selectedTeam={teamB ?? null}
          tradeSide={state.teamB}
          otherSideFranchiseId={state.teamA.franchiseId}
          tradeImpact={tradeImpactB}
          salaryYears={data.salaryYears}
          salaryCap={data.salaryCap}
          dispatch={dispatch}
        />
      </div>

      {hasTrade && tradeImpactA && tradeImpactB && teamA && teamB && (
        <>
          {data.surplusMap && Object.keys(data.surplusMap).length > 0 && (
            <TradeValueAnalysis
              teamAName={teamA.nameMedium}
              teamBName={teamB.nameMedium}
              teamAIcon={teamA.icon}
              teamBIcon={teamB.icon}
              teamAPlayers={teamAPlayers}
              teamBPlayers={teamBPlayers}
              teamADraftPicks={state.teamA.draftPicks}
              teamBDraftPicks={state.teamB.draftPicks}
              surplusMap={data.surplusMap}
            />
          )}
          <MultiYearCapTable
            teamAName={teamA.nameMedium}
            teamBName={teamB.nameMedium}
            teamAIcon={teamA.icon}
            teamBIcon={teamB.icon}
            impactA={tradeImpactA}
            impactB={tradeImpactB}
            salaryYears={data.salaryYears}
          />
          <TradeAnalysisSummary
            teamAName={teamA.nameMedium}
            teamBName={teamB.nameMedium}
            teamAIcon={teamA.icon}
            teamBIcon={teamB.icon}
            teamAPlayers={teamAPlayers}
            teamBPlayers={teamBPlayers}
            impactA={tradeImpactA}
            impactB={tradeImpactB}
            salaryCap={data.salaryCap}
          />
        </>
      )}

      <TradeBaitMarketplace
        teams={data.teams}
        leagueYear={data.leagueYear}
        onStartTrade={(franchiseId, playerId) =>
          dispatch({ type: 'START_TRADE_FOR_PLAYER', franchiseId, playerId })
        }
      />

      {state.rookieModalTarget && rookieModalPlayer && (
        <RookieExtensionModal
          player={rookieModalPlayer}
          side={state.rookieModalTarget.side}
          positionAverages={data.positionAverages}
          onApply={(sim) => {
            dispatch({
              type: 'SET_ROOKIE_EXTENSION',
              side: state.rookieModalTarget!.side,
              playerId: state.rookieModalTarget!.playerId,
              sim,
            });
            dispatch({ type: 'HIDE_ROOKIE_MODAL' });
          }}
          onClose={() => dispatch({ type: 'HIDE_ROOKIE_MODAL' })}
        />
      )}

      <style>{`
        .trade-builder {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        .trade-builder__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        .trade-builder__header h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-color, #1f2937);
          margin: 0;
        }
        .trade-builder__actions {
          display: flex;
          gap: 0.5rem;
        }
        .btn {
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          transition: all 0.15s ease;
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn--secondary {
          background: var(--primary-content-bg-color, #fff);
          color: var(--text-color, #1f2937);
        }
        .btn--secondary:not(:disabled):hover {
          border-color: var(--primary-color, #1c497c);
          background: var(--primary-light-bg, #f0f4f8);
        }
        .trade-builder__panels {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 0.75rem;
          align-items: start;
        }
        .trade-builder__divider {
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 2.5rem;
        }
        .trade-builder__swap {
          background: var(--primary-color, #1c497c);
          color: #fff;
          border: none;
          border-radius: 50%;
          width: 2.5rem;
          height: 2.5rem;
          font-size: 1.25rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease;
        }
        .trade-builder__swap:hover {
          transform: scale(1.1);
        }
        @media (max-width: 768px) {
          .trade-builder__panels {
            grid-template-columns: 1fr;
          }
          .trade-builder__divider {
            padding: 0.5rem 0;
          }
          .trade-builder__swap {
            transform: rotate(90deg);
          }
          .trade-builder__swap:hover {
            transform: rotate(90deg) scale(1.1);
          }
        }
      `}</style>
    </div>
  );
}
