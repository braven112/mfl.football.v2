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

  // Get picks for the active round
  const roundPicks = useMemo(
    () => picks.filter((p) => p.round === activeRound),
    [picks, activeRound]
  );

  // All teams as columns (preserves full pick count even with trades)
  const columns = teams;

  // Build a map from franchiseId → picks in this round (can be 0, 1, or 2+)
  const teamPicksMap = useMemo(() => {
    const map = new Map<string, DraftRoomPick[]>();
    for (const pick of roundPicks) {
      const existing = map.get(pick.franchiseId) ?? [];
      map.set(pick.franchiseId, [...existing, pick]);
    }
    return map;
  }, [roundPicks]);

  const roundNumbers = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Round selector pills */}
      <div style={{
        display: 'flex',
        gap: '0.375rem',
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--content-border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
          color: 'var(--color-gray-900, #111827)',
          paddingLeft: '0.625rem',
          borderLeft: '2px solid var(--color-primary, #1c497c)',
          marginRight: '0.5rem',
          lineHeight: '1.8',
        }}>
          Draft Board
        </span>
        {roundNumbers.map((r) => (
          <button
            key={r}
            onClick={() => onRoundChange(r)}
            className="dr-round-pill"
            style={{
              padding: '0.25rem 0.75rem',
              borderRadius: 'var(--radius-full, 9999px)',
              border: 'none',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: activeRound === r
                ? 'var(--color-primary, #1c497c)'
                : 'var(--color-gray-100, #f3f4f6)',
              color: activeRound === r
                ? '#ffffff'
                : 'var(--color-gray-600, #4b5563)',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
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
              <th style={{
                width: 40,
                padding: '0.375rem 0.25rem',
                background: 'var(--dr-header-bg, #f9fafb)',
                fontSize: '0.625rem',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.06em',
                color: 'var(--dr-header-text, #6b7280)',
                textAlign: 'center',
                borderBottom: '1px solid var(--content-border, #e2e8f0)',
              }}>
                #
              </th>
              {columns.map((team) => (
                <th
                  key={team.franchiseId}
                  scope="col"
                  style={{
                    padding: '0.375rem 0.25rem',
                    background: 'var(--dr-header-bg, #f9fafb)',
                    borderBottom: '1px solid var(--content-border, #e2e8f0)',
                    textAlign: 'center',
                    minWidth: 'var(--dr-cell-width, 140px)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.125rem' }}>
                    {team.icon && (
                      <img
                        src={team.icon}
                        alt=""
                        style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    )}
                    <span style={{
                      fontSize: '0.5625rem',
                      fontWeight: 700,
                      textTransform: 'uppercase' as const,
                      letterSpacing: '0.04em',
                      color: 'var(--dr-header-text, #6b7280)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}>
                      {chooseTeamName({ fullName: team.name, nameMedium: team.nameMedium, nameShort: team.nameShort, abbrev: team.abbrev }, 'abbrev')}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Single row for this round — each column is that team's pick(s) */}
            <tr>
              <td style={{
                padding: '0.25rem',
                fontSize: '0.625rem',
                fontWeight: 600,
                color: 'var(--color-gray-400, #9ca3af)',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
                verticalAlign: 'top',
                borderBottom: '1px solid var(--dr-cell-border, #e2e8f0)',
              }}>
                {activeRound}
              </td>
              {columns.map((team) => {
                const teamPicks = teamPicksMap.get(team.franchiseId) ?? [];
                if (teamPicks.length === 0) {
                  // Team traded away their pick — show empty traded indicator
                  return (
                    <td key={team.franchiseId} role="gridcell" style={{ padding: 0 }}>
                      <div style={{
                        padding: '0.375rem 0.5rem',
                        minHeight: 'var(--dr-cell-height, 56px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderBottom: '1px solid var(--dr-cell-border, #e2e8f0)',
                        borderLeft: '3px solid transparent',
                      }}>
                        <span style={{ fontSize: '0.5625rem', color: 'var(--color-gray-300, #d1d5db)', fontStyle: 'italic' }}>traded</span>
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={team.franchiseId} role="gridcell" style={{ padding: 0 }}>
                    {teamPicks.map((pick) => {
                      const player = pick.playerId ? players.get(pick.playerId) : undefined;
                      return (
                        <BoardCell
                          key={pick.overallPickNumber}
                          pick={pick}
                          player={player}
                          team={team}
                          teams={teams}
                          isCurrentPick={pick.overallPickNumber === currentPickNumber}
                          isUserTeam={pick.franchiseId === userTeamId}
                        />
                      );
                    })}
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

            return (
              <div
                key={pick.overallPickNumber}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.5rem 0.75rem',
                  borderBottom: '1px solid var(--color-gray-50, #f9fafb)',
                  borderLeft: posColor ? `3px solid ${posColor}` : '3px solid transparent',
                  background: isOtc ? 'var(--dr-otc-bg, #fef3c7)' : undefined,
                }}
              >
                <span style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: 'var(--color-gray-400, #9ca3af)',
                  fontVariantNumeric: 'tabular-nums',
                  width: '2.5rem',
                  flexShrink: 0,
                }}>
                  {pick.round}.{String(pick.pickInRound).padStart(2, '0')}
                </span>
                {team?.icon && (
                  <img src={team.icon} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} loading="lazy" />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-gray-700, #374151)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {team ? chooseTeamName({ fullName: team.name, nameMedium: team.nameMedium, nameShort: team.nameShort, abbrev: team.abbrev }, 'short') : 'TBD'}
                  </div>
                  {player ? (
                    <div style={{ fontSize: '0.6875rem', color: posColor || 'var(--color-gray-500, #6b7280)' }}>
                      {player.name} · {player.position}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-gray-400, #9ca3af)', fontStyle: 'italic' }}>
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
