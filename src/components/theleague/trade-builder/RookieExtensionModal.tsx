import React, { useState, useMemo } from 'react';
import type {
  TradeBuilderPlayer,
  PositionSalaryAverages,
  RookieExtensionSim,
} from '../../../types/trade-builder';
import { simulateRookieExtension } from '../../../utils/trade-calculations';
import { formatCurrency } from '../../../utils/formatters';

interface Props {
  player: TradeBuilderPlayer;
  side: 'A' | 'B';
  positionAverages: PositionSalaryAverages;
  onApply: (sim: RookieExtensionSim) => void;
  onClose: () => void;
}

export default function RookieExtensionModal({
  player,
  positionAverages,
  onApply,
  onClose,
}: Props) {
  const [extensionYears, setExtensionYears] = useState(2);

  const sim = useMemo(
    () =>
      simulateRookieExtension(
        {
          salary: player.salary,
          contractYears: player.contractYears,
          position: player.position,
        },
        extensionYears,
        positionAverages
      ),
    [player, extensionYears, positionAverages]
  );

  const top5Avg =
    positionAverages[player.position]?.top5Average ?? 0;

  return (
    <div className="rookie-modal__overlay" onClick={onClose}>
      <div
        className="rookie-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rookie-modal-title"
      >
        <div className="rookie-modal__header">
          <h2 id="rookie-modal-title" className="rookie-modal__title">
            Rookie Extension Simulator
          </h2>
          <button
            className="rookie-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="rookie-modal__player">
          <span className="rookie-modal__name">{player.name}</span>
          <span className="rookie-modal__pos">{player.position} - {player.nflTeam}</span>
        </div>

        <div className="rookie-modal__current">
          <h3 className="rookie-modal__subtitle">Current Contract</h3>
          <div className="rookie-modal__row">
            <span>Salary</span>
            <span>{formatCurrency(player.salary)}</span>
          </div>
          <div className="rookie-modal__row">
            <span>Years Remaining</span>
            <span>{player.contractYears}</span>
          </div>
          <div className="rookie-modal__row">
            <span>{player.position} Top-5 Avg</span>
            <span>{formatCurrency(top5Avg)}</span>
          </div>
        </div>

        <div className="rookie-modal__extension">
          <h3 className="rookie-modal__subtitle">Extension</h3>
          <div className="rookie-modal__years-select">
            <label htmlFor="ext-years">Extension Years:</label>
            <select
              id="ext-years"
              value={extensionYears}
              onChange={(e) => setExtensionYears(parseInt(e.target.value, 10))}
            >
              {[1, 2, 3].map((y) => (
                <option key={y} value={y}>
                  {y} year{y > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="rookie-modal__formula">
            <span className="rookie-modal__formula-label">Formula:</span>
            <span className="rookie-modal__formula-text">
              (Top-5 Avg x {extensionYears}) / ({player.contractYears} + {extensionYears}) + Current Salary
            </span>
          </div>
        </div>

        <div className="rookie-modal__result">
          <h3 className="rookie-modal__subtitle">Result</h3>
          <div className="rookie-modal__row rookie-modal__row--highlight">
            <span>New Salary</span>
            <span className="rookie-modal__value-lg">{formatCurrency(sim.newSalary)}</span>
          </div>
          <div className="rookie-modal__row">
            <span>Total Years</span>
            <span>{sim.newContractYears}</span>
          </div>

          <div className="rookie-modal__cap-preview">
            <span className="rookie-modal__cap-label">Cap Hit By Year (10% escalation):</span>
            <div className="rookie-modal__cap-years">
              {sim.capHitByYear.map((hit, i) =>
                hit > 0 ? (
                  <div key={i} className="rookie-modal__cap-year">
                    <span className="rookie-modal__cap-yr-label">
                      Yr {i + 1}
                    </span>
                    <span className="rookie-modal__cap-yr-value">
                      {formatCurrency(hit)}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          </div>
        </div>

        <div className="rookie-modal__actions">
          <button className="rookie-modal__btn rookie-modal__btn--cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rookie-modal__btn rookie-modal__btn--apply"
            onClick={() => onApply(sim)}
          >
            Apply Extension
          </button>
        </div>

        <style>{`
          .rookie-modal__overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 1rem;
          }
          .rookie-modal {
            background: var(--primary-content-bg-color, #fff);
            border-radius: 0.75rem;
            padding: 1.5rem;
            max-width: 480px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          }
          .rookie-modal__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .rookie-modal__title {
            font-size: 1.125rem;
            font-weight: 700;
            color: var(--text-color, #1f2937);
            margin: 0;
          }
          .rookie-modal__close {
            background: none;
            border: none;
            font-size: 1.5rem;
            color: var(--muted-text-color, #6b7280);
            cursor: pointer;
            padding: 0.25rem;
            line-height: 1;
          }
          .rookie-modal__close:hover {
            color: var(--text-color, #1f2937);
          }
          .rookie-modal__player {
            display: flex;
            flex-direction: column;
            gap: 0.125rem;
          }
          .rookie-modal__name {
            font-size: 1rem;
            font-weight: 700;
            color: var(--text-color, #1f2937);
          }
          .rookie-modal__pos {
            font-size: 0.8125rem;
            color: var(--muted-text-color, #6b7280);
          }
          .rookie-modal__subtitle {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted-text-color, #6b7280);
            margin: 0 0 0.375rem;
          }
          .rookie-modal__row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.875rem;
            padding: 0.25rem 0;
          }
          .rookie-modal__row--highlight {
            background: var(--primary-light-bg, #f0f4f8);
            padding: 0.5rem;
            border-radius: 0.375rem;
          }
          .rookie-modal__value-lg {
            font-size: 1rem;
            font-weight: 700;
            color: var(--primary-color, #1c497c);
          }
          .rookie-modal__years-select {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.875rem;
          }
          .rookie-modal__years-select select {
            padding: 0.375rem 0.625rem;
            border: 1px solid var(--primary-content-border-color, #e2e8f0);
            border-radius: 0.375rem;
            font-size: 0.875rem;
            background: var(--primary-content-bg-color, #fff);
          }
          .rookie-modal__formula {
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #f8fafc;
            border-radius: 0.375rem;
            border: 1px solid var(--primary-content-border-color, #e2e8f0);
          }
          .rookie-modal__formula-label {
            font-size: 0.6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted-text-color, #6b7280);
            display: block;
            margin-bottom: 0.25rem;
          }
          .rookie-modal__formula-text {
            font-size: 0.8125rem;
            color: var(--text-color, #1f2937);
            font-family: var(--font-family-mono);
          }
          .rookie-modal__cap-preview {
            margin-top: 0.5rem;
          }
          .rookie-modal__cap-label {
            font-size: 0.6875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted-text-color, #6b7280);
            display: block;
            margin-bottom: 0.375rem;
          }
          .rookie-modal__cap-years {
            display: flex;
            gap: 0.375rem;
            flex-wrap: wrap;
          }
          .rookie-modal__cap-year {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.125rem;
            padding: 0.375rem 0.5rem;
            background: var(--primary-light-bg, #f0f4f8);
            border-radius: 0.375rem;
            min-width: 4rem;
          }
          .rookie-modal__cap-yr-label {
            font-size: 0.625rem;
            font-weight: 600;
            color: var(--muted-text-color, #6b7280);
            text-transform: uppercase;
          }
          .rookie-modal__cap-yr-value {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--text-color, #1f2937);
          }
          .rookie-modal__actions {
            display: flex;
            gap: 0.75rem;
            justify-content: flex-end;
            padding-top: 0.5rem;
            border-top: 1px solid var(--primary-content-border-color, #e2e8f0);
          }
          .rookie-modal__btn {
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.15s ease;
          }
          .rookie-modal__btn--cancel {
            background: var(--primary-content-bg-color, #fff);
            border-color: var(--primary-content-border-color, #e2e8f0);
            color: var(--muted-text-color, #6b7280);
          }
          .rookie-modal__btn--cancel:hover {
            border-color: var(--text-color, #1f2937);
            color: var(--text-color, #1f2937);
          }
          .rookie-modal__btn--apply {
            background: var(--primary-color, #1c497c);
            color: #fff;
          }
          .rookie-modal__btn--apply:hover {
            opacity: 0.9;
          }
        `}</style>
      </div>
    </div>
  );
}
