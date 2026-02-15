import React from 'react';
import type { TradeBuilderTeam, TeamTradeImpact } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

interface Props {
  team: TradeBuilderTeam;
  tradeImpact: TeamTradeImpact | null;
  salaryCap: number;
  teamIcon?: string;
}

export default function CapImpactCard({ team, tradeImpact, salaryCap, teamIcon }: Props) {
  const beforeCapSpace = team.currentCapSpace;

  if (!tradeImpact) {
    return (
      <div className="cap-impact">
        <h3 className="cap-impact__title">Cap Situation</h3>
        <div className="cap-impact__row">
          <span className="cap-impact__label">Total Salary</span>
          <span className="cap-impact__value">{formatCurrency(team.totalSalary)}</span>
        </div>
        <div className="cap-impact__row">
          <span className="cap-impact__label">Dead Money</span>
          <span className="cap-impact__value">{formatCurrency(team.deadMoney[0] ?? 0)}</span>
        </div>
        <div className="cap-impact__row cap-impact__row--highlight">
          <span className="cap-impact__label">Cap Space</span>
          <span className={`cap-impact__value ${beforeCapSpace < 0 ? 'cap-impact__value--negative' : 'cap-impact__value--positive'}`}>
            {formatCurrency(beforeCapSpace)}
          </span>
        </div>
        <div className="cap-impact__row">
          <span className="cap-impact__label">Roster</span>
          <span className="cap-impact__value">{team.rosterCount} players</span>
        </div>
        {capStyles}
      </div>
    );
  }

  const afterCapSpace = tradeImpact.postTradeCapSpace[0];
  const delta = tradeImpact.capDelta[0];
  const isOverCap = tradeImpact.isOverCap[0];
  const isGaining = delta > 0;

  return (
    <div className="cap-impact">
      <h3 className="cap-impact__title">Cap Impact</h3>

      <div className="cap-impact__row">
        <span className="cap-impact__label">Before</span>
        <span className="cap-impact__value">{formatCurrency(beforeCapSpace)}</span>
      </div>

      <div className={`cap-impact__row cap-impact__row--highlight ${isOverCap ? 'cap-impact__row--danger' : ''}`}>
        <span className="cap-impact__label">After</span>
        <span className={`cap-impact__value ${isOverCap ? 'cap-impact__value--negative' : 'cap-impact__value--positive'}`}>
          {formatCurrency(afterCapSpace)}
        </span>
      </div>

      <div className="cap-impact__row">
        <span className="cap-impact__label">Delta</span>
        <span className={`cap-impact__delta ${isGaining ? 'cap-impact__delta--gain' : 'cap-impact__delta--loss'}`}>
          {isGaining ? '+' : ''}{formatCurrency(delta)}
          <span className="cap-impact__arrow">{isGaining ? '\u2191' : '\u2193'}</span>
        </span>
      </div>

      {isOverCap && (
        <div className="cap-impact__warning">
          Over cap by {formatCurrency(Math.abs(afterCapSpace))}
        </div>
      )}

      <div className="cap-impact__row">
        <span className="cap-impact__label">Salary traded</span>
        <span className="cap-impact__value">{formatCurrency(tradeImpact.totalSalaryTraded)}</span>
      </div>
      <div className="cap-impact__row">
        <span className="cap-impact__label">Salary received</span>
        <span className="cap-impact__value">{formatCurrency(tradeImpact.totalSalaryReceived)}</span>
      </div>

      {capStyles}
    </div>
  );
}

const capStyles = (
  <style>{`
    .cap-impact {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .cap-impact__title {
      font-size: 0.8125rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted-text-color, #6b7280);
      margin: 0 0 0.25rem;
      padding-bottom: 0.375rem;
      border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
    }
    .cap-impact__row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.25rem 0;
    }
    .cap-impact__row--highlight {
      padding: 0.375rem 0.5rem;
      border-radius: 0.375rem;
      background: var(--primary-light-bg, #f0f4f8);
    }
    .cap-impact__row--danger {
      background: #fef2f2;
    }
    .cap-impact__label {
      font-size: 0.8125rem;
      color: var(--muted-text-color, #6b7280);
    }
    .cap-impact__value {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-color, #1f2937);
    }
    .cap-impact__value--positive {
      color: #166534;
    }
    .cap-impact__value--negative {
      color: #dc2626;
    }
    .cap-impact__delta {
      font-size: 0.875rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .cap-impact__delta--gain {
      color: #166534;
    }
    .cap-impact__delta--loss {
      color: #dc2626;
    }
    .cap-impact__arrow {
      font-size: 0.75rem;
    }
    .cap-impact__warning {
      background: #dc2626;
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      text-align: center;
      padding: 0.375rem 0.5rem;
      border-radius: 0.375rem;
    }
  `}</style>
);
