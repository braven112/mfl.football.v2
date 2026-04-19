import React, { useMemo } from 'react';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';
import { chooseTeamName } from '../../../utils/team-names';
import { BoardCell } from './BoardCell';

interface DraftBoardPanelProps {
  picks: DraftRoomPick[];
  teams: DraftRoomTeam[];
  players: Map<string, DraftRoomPlayer>;
  totalRounds: number;
  picksPerRound: number;
  currentPickNumber: number;
  userTeamId: string;
  activeRound: number;
  onRoundChange: (round: number) => void;
}

export function DraftBoardPanel({
  picks,
  teams,
  players,
  totalRounds,
  picksPerRound,
  currentPickNumber,
  userTeamId,
  activeRound,
  onRoundChange,
}: DraftBoardPanelProps) {
  // Build team lookup
  const teamMap = useMemo(
    () => new Map(teams.map((t) => [t.franchiseId, t])),
    [teams]
  );

  // One column per pick slot in the active round, ordered by pick number
  const roundPicks = useMemo(
    () => picks.filter((p) => p.round === activeRound).sort((a, b) => a.pickInRound - b.pickInRound),
    [picks, activeRound]
  );

  const roundNumbers = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Round selector pills */}
      <div className="dr-board-toolbar">
        <span className="dr-board-toolbar__title">Draft Board</span>
        {roundNumbers.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRoundChange(r)}
            className="dr-round-pill"
            aria-pressed={activeRound === r}
          >
            Rd {r}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ overflow: 'auto' }} role="region" aria-label="Draft board">
        <table
          role="grid"
          aria-label={`Round ${activeRound} draft picks`}
          style={{
            width: 'max-content',
            minWidth: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
          }}
        >
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <tr>
              {roundPicks.map((pick) => {
                const team = teamMap.get(pick.franchiseId);
                return (
                  <th key={pick.overallPickNumber} scope="col" className="dr-board-head">
                    <div className="dr-board-head__stack">
                      {team?.icon && (
                        <div className="dr-board-head__avatar">
                          <img src={team.icon} alt="" loading="lazy" />
                        </div>
                      )}
                      <span className="dr-board-head__abbrev">
                        {team ? chooseTeamName({ fullName: team.name, nameMedium: team.nameMedium, nameShort: team.nameShort, abbrev: team.abbrev }, 'abbrev') : '—'}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* One column per pick slot — each cell is exactly one pick */}
            <tr>
              {roundPicks.map((pick) => {
                const team = teamMap.get(pick.franchiseId);
                const player = pick.playerId ? players.get(pick.playerId) : undefined;
                return (
                  <td key={pick.overallPickNumber} role="gridcell" style={{ padding: 0, verticalAlign: 'top' }}>
                    <BoardCell
                      pick={pick}
                      player={player}
                      team={team}
                      teams={teams}
                      isCurrentPick={pick.overallPickNumber === currentPickNumber}
                      isUserTeam={pick.franchiseId === userTeamId}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>

        {/* Mobile list view — shown at smaller screens */}
        <div className="dr-mobile-list" style={{ display: 'none' }}>
          {roundPicks.map((pick) => {
            const team = teamMap.get(pick.franchiseId);
            const player = pick.playerId ? players.get(pick.playerId) : undefined;
            const isOtc = pick.overallPickNumber === currentPickNumber;
            const posColor = player ? POSITION_COLORS[player.position] || POSITION_COLORS.DEF : undefined;
            const posClass = player
              ? ` dr-board-row__meta--pos-${player.position.toLowerCase()}`
              : '';

            return (
              <div
                key={pick.overallPickNumber}
                className="dr-board-row"
                data-otc={isOtc ? 'true' : undefined}
                style={posColor ? { borderLeftColor: posColor } : undefined}
              >
                <span className="dr-board-row__pick">
                  {pick.round}.{String(pick.pickInRound).padStart(2, '0')}
                </span>
                {team?.icon && (
                  <div className="dr-board-row__avatar">
                    <img src={team.icon} alt="" loading="lazy" />
                  </div>
                )}
                <div className="dr-board-row__body">
                  <div className="dr-board-row__team">
                    {team ? chooseTeamName({ fullName: team.name, nameMedium: team.nameMedium, nameShort: team.nameShort, abbrev: team.abbrev }, 'short') : 'TBD'}
                  </div>
                  {player ? (
                    <div className={`dr-board-row__meta${posClass}`}>
                      {player.name} · {player.position}
                    </div>
                  ) : (
                    <div className="dr-board-row__meta dr-board-row__meta--empty">
                      {isOtc ? 'On the clock' : '—'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 767px) {
          .dr-mobile-list { display: block !important; }
          table[role="grid"] { display: none !important; }
        }
      `}</style>
    </div>
  );
}
