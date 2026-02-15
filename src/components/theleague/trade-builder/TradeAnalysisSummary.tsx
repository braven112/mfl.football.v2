import React from 'react';
import type { TradeBuilderPlayer, TeamTradeImpact } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';
import { calculateCutPenalty } from '../../../utils/salary-calculations';

interface Props {
  teamAName: string;
  teamBName: string;
  teamAIcon: string;
  teamBIcon: string;
  teamAPlayers: TradeBuilderPlayer[];
  teamBPlayers: TradeBuilderPlayer[];
  impactA: TeamTradeImpact;
  impactB: TeamTradeImpact;
  salaryCap: number;
}

export default function TradeAnalysisSummary({
  teamAName,
  teamBName,
  teamAIcon,
  teamBIcon,
  teamAPlayers,
  teamBPlayers,
  impactA,
  impactB,
  salaryCap,
}: Props) {
  // Position depth changes
  const hasPositionChanges =
    impactA.positionBreakdown.length > 0 || impactB.positionBreakdown.length > 0;

  // Contract expirations for received players
  const teamAReceives = teamBPlayers; // Team A receives Team B's players
  const teamBReceives = teamAPlayers; // Team B receives Team A's players

  return (
    <div className="trade-analysis">
      <h3 className="trade-analysis__title">Trade Analysis</h3>

      <div className="trade-analysis__grid">
        {/* Position Depth Changes */}
        {hasPositionChanges && (
          <div className="trade-analysis__card">
            <h4 className="trade-analysis__card-title">Position Changes</h4>
            <div className="trade-analysis__columns">
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamAIcon && <img src={teamAIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamAName}
                </span>
                {impactA.positionBreakdown.length > 0 ? (
                  impactA.positionBreakdown.map((pc) => (
                    <span
                      key={pc.position}
                      className={`trade-analysis__change ${pc.netChange > 0 ? 'trade-analysis__change--gain' : 'trade-analysis__change--loss'}`}
                    >
                      {pc.position}: {pc.netChange > 0 ? '+' : ''}{pc.netChange}
                    </span>
                  ))
                ) : (
                  <span className="trade-analysis__change--none">No change</span>
                )}
              </div>
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamBIcon && <img src={teamBIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamBName}
                </span>
                {impactB.positionBreakdown.length > 0 ? (
                  impactB.positionBreakdown.map((pc) => (
                    <span
                      key={pc.position}
                      className={`trade-analysis__change ${pc.netChange > 0 ? 'trade-analysis__change--gain' : 'trade-analysis__change--loss'}`}
                    >
                      {pc.position}: {pc.netChange > 0 ? '+' : ''}{pc.netChange}
                    </span>
                  ))
                ) : (
                  <span className="trade-analysis__change--none">No change</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Contract Expirations */}
        {(teamAReceives.length > 0 || teamBReceives.length > 0) && (
          <div className="trade-analysis__card">
            <h4 className="trade-analysis__card-title">Contract Expirations</h4>
            <div className="trade-analysis__columns">
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamAIcon && <img src={teamAIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamAName} receives
                </span>
                {teamAReceives.map((p) => (
                  <span key={p.id} className="trade-analysis__expiry">
                    {p.name}: {p.contractYears}yr left
                  </span>
                ))}
              </div>
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamBIcon && <img src={teamBIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamBName} receives
                </span>
                {teamBReceives.map((p) => (
                  <span key={p.id} className="trade-analysis__expiry">
                    {p.name}: {p.contractYears}yr left
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dead Money If Cut */}
        {(teamAReceives.length > 0 || teamBReceives.length > 0) && (
          <div className="trade-analysis__card">
            <h4 className="trade-analysis__card-title">Dead Money If Cut Later</h4>
            <div className="trade-analysis__columns">
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamAIcon && <img src={teamAIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamAName}
                </span>
                {teamAReceives.map((p) => {
                  const penalty = calculateCutPenalty(p.salary, p.contractYears);
                  return (
                    <div key={p.id} className="trade-analysis__dead-money">
                      <span className="trade-analysis__dm-name">{p.name}</span>
                      <span className="trade-analysis__dm-value">
                        {formatCurrency(penalty.currentPenalty)} current
                        {penalty.futurePenalty > 0 && (
                          <> + {formatCurrency(penalty.futurePenalty)} future</>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="trade-analysis__column">
                <span className="trade-analysis__team-label">
                  {teamBIcon && <img src={teamBIcon} alt="" className="trade-analysis__team-icon" />}
                  {teamBName}
                </span>
                {teamBReceives.map((p) => {
                  const penalty = calculateCutPenalty(p.salary, p.contractYears);
                  return (
                    <div key={p.id} className="trade-analysis__dead-money">
                      <span className="trade-analysis__dm-name">{p.name}</span>
                      <span className="trade-analysis__dm-value">
                        {formatCurrency(penalty.currentPenalty)} current
                        {penalty.futurePenalty > 0 && (
                          <> + {formatCurrency(penalty.futurePenalty)} future</>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Roster Count Impact */}
        <div className="trade-analysis__card">
          <h4 className="trade-analysis__card-title">Roster Impact</h4>
          <div className="trade-analysis__columns">
            <div className="trade-analysis__column">
              <span className="trade-analysis__team-label">
                {teamAIcon && <img src={teamAIcon} alt="" className="trade-analysis__team-icon" />}
                {teamAName}
              </span>
              <span className="trade-analysis__roster-delta">
                {impactA.rosterCountDelta > 0 ? '+' : ''}{impactA.rosterCountDelta} players
              </span>
            </div>
            <div className="trade-analysis__column">
              <span className="trade-analysis__team-label">
                {teamBIcon && <img src={teamBIcon} alt="" className="trade-analysis__team-icon" />}
                {teamBName}
              </span>
              <span className="trade-analysis__roster-delta">
                {impactB.rosterCountDelta > 0 ? '+' : ''}{impactB.rosterCountDelta} players
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .trade-analysis {
          background: var(--primary-content-bg-color, #fff);
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.75rem;
          padding: 1rem;
          margin-top: 1rem;
        }
        .trade-analysis__title {
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
          margin: 0 0 0.75rem;
        }
        .trade-analysis__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 0.75rem;
        }
        .trade-analysis__card {
          padding: 0.75rem;
          background: var(--primary-light-bg, #f8fafc);
          border-radius: 0.5rem;
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
        }
        .trade-analysis__card-title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-color, #1f2937);
          margin: 0 0 0.5rem;
        }
        .trade-analysis__columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .trade-analysis__column {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .trade-analysis__team-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
          margin-bottom: 0.125rem;
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .trade-analysis__team-icon {
          width: 20px;
          height: 20px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .trade-analysis__change {
          font-size: 0.8125rem;
          font-weight: 600;
        }
        .trade-analysis__change--gain {
          color: #166534;
        }
        .trade-analysis__change--loss {
          color: #dc2626;
        }
        .trade-analysis__change--none {
          font-size: 0.75rem;
          color: var(--muted-text-color, #6b7280);
        }
        .trade-analysis__expiry {
          font-size: 0.8125rem;
          color: var(--text-color, #1f2937);
        }
        .trade-analysis__dead-money {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }
        .trade-analysis__dm-name {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-color, #1f2937);
        }
        .trade-analysis__dm-value {
          font-size: 0.6875rem;
          color: #dc2626;
        }
        .trade-analysis__roster-delta {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-color, #1f2937);
        }
      `}</style>
    </div>
  );
}
