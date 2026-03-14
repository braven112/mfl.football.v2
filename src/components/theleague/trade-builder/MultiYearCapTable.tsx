import React from 'react';
import type { TeamTradeImpact } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

interface Props {
  teamAName: string;
  teamBName: string;
  teamAIcon: string;
  teamBIcon: string;
  impactA: TeamTradeImpact;
  impactB: TeamTradeImpact;
  salaryYears: number[];
}

export default function MultiYearCapTable({
  teamAName,
  teamBName,
  teamAIcon,
  teamBIcon,
  impactA,
  impactB,
  salaryYears,
}: Props) {
  // Only show years where at least one team has a non-zero delta
  const activeYears = salaryYears.filter(
    (_, i) => impactA.capDelta[i] !== 0 || impactB.capDelta[i] !== 0
  );

  if (activeYears.length === 0) return null;

  return (
    <div className="multiyear-cap">
      <h3 className="multiyear-cap__title">Multi-Year Cap Impact</h3>
      <div className="multiyear-cap__table-wrap">
        <table className="multiyear-cap__table">
          <thead>
            <tr>
              <th className="multiyear-cap__th">Team</th>
              {activeYears.map((year) => (
                <th key={year} className="multiyear-cap__th">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TeamRow
              name={teamAName}
              icon={teamAIcon}
              impact={impactA}
              salaryYears={salaryYears}
              activeYears={activeYears}
            />
            <TeamRow
              name={teamBName}
              icon={teamBIcon}
              impact={impactB}
              salaryYears={salaryYears}
              activeYears={activeYears}
            />
          </tbody>
        </table>
      </div>

      <style>{`
        .multiyear-cap {
          background: var(--content-bg, #fff);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-lg, 1rem);
          padding: 1rem;
          margin-top: 1rem;
        }
        .multiyear-cap__title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0 0 0.75rem;
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
        }
        .multiyear-cap__table-wrap {
          overflow-x: auto;
        }
        .multiyear-cap__table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
        .multiyear-cap__th {
          text-align: center;
          padding: 0.5rem 0.75rem;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--color-gray-500, #6b7280);
          background: var(--color-gray-50, #f9fafb);
          border-bottom: 2px solid var(--content-border, #e2e8f0);
          white-space: nowrap;
        }
        .multiyear-cap__th:first-child {
          text-align: left;
        }
        .multiyear-cap__td {
          padding: 0.5rem 0.75rem;
          text-align: center;
          font-weight: 600;
          white-space: nowrap;
          border-bottom: 1px solid var(--content-border, #e2e8f0);
        }
        .multiyear-cap__td:first-child {
          text-align: left;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
        }
        .multiyear-cap__team-cell {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .multiyear-cap__team-icon {
          width: 24px;
          height: 24px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .multiyear-cap__td--gain {
          color: var(--color-success-dark, #059669);
          background: var(--color-success-light, #d1fae5);
        }
        .multiyear-cap__td--loss {
          color: var(--color-error, #dc2626);
          background: var(--color-error-light, #fee2e2);
        }
        .multiyear-cap__td--over-cap {
          color: #fff;
          background: var(--color-error, #dc2626);
          font-weight: 700;
        }
        .multiyear-cap__sub {
          display: block;
          font-size: 0.6875rem;
          font-weight: 500;
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}

function TeamRow({
  name,
  icon,
  impact,
  salaryYears,
  activeYears,
}: {
  name: string;
  icon: string;
  impact: TeamTradeImpact;
  salaryYears: number[];
  activeYears: number[];
}) {
  return (
    <tr>
      <td className="multiyear-cap__td">
        <span className="multiyear-cap__team-cell">
          {icon && <img src={icon} alt="" className="multiyear-cap__team-icon" loading="lazy" decoding="async" />}
          {name}
        </span>
      </td>
      {activeYears.map((year) => {
        const idx = salaryYears.indexOf(year);
        const delta = impact.capDelta[idx];
        const isOverCap = impact.isOverCap[idx];
        const postCapSpace = impact.postTradeCapSpace[idx];

        let className = 'multiyear-cap__td';
        if (isOverCap) className += ' multiyear-cap__td--over-cap';
        else if (delta > 0) className += ' multiyear-cap__td--gain';
        else if (delta < 0) className += ' multiyear-cap__td--loss';

        return (
          <td key={year} className={className}>
            {delta > 0 ? '+' : ''}
            {formatCurrency(delta)}
            <span className="multiyear-cap__sub">
              {isOverCap ? 'OVER CAP' : formatCurrency(postCapSpace)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
