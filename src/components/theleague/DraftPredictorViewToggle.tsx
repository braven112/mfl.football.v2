import React, { useState } from 'react';
import type { DraftPrediction } from '../../types/standings';

interface Props {
  predictions: DraftPrediction[];
  actualPicks: DraftPrediction[];
  onViewChange?: (view: 'projected' | 'actual') => void;
}

export default function DraftPredictorViewToggle({ predictions, actualPicks, onViewChange }: Props) {
  const [view, setView] = useState<'projected' | 'actual'>('projected');

  const handleViewChange = (newView: 'projected' | 'actual') => {
    setView(newView);
    onViewChange?.(newView);
  };

  return (
    <div className="draft-predictor-view-toggle">
      <div className="view-toggle-buttons">
        <button
          className={`toggle-button ${view === 'projected' ? 'toggle-button--active' : ''}`}
          onClick={() => handleViewChange('projected')}
        >
          Projected Order
        </button>
        <button
          className={`toggle-button ${view === 'actual' ? 'toggle-button--active' : ''}`}
          onClick={() => handleViewChange('actual')}
        >
          Actual (With Trades)
        </button>
      </div>

      <div className="view-indicator">
        {view === 'projected' ? 'Showing Projected Draft Order' : 'Showing Actual Picks (With Trades)'}
      </div>

      <style>{`
        .draft-predictor-view-toggle {
          display: grid;
          gap: 1.5rem;
        }

        .view-toggle-buttons {
          display: flex;
          gap: 0.75rem;
          justify-content: center;
          flex-wrap: wrap;
        }

        .toggle-button {
          padding: 0.625rem 1.25rem;
          border: 2px solid #e5e7eb;
          border-radius: 0.5rem;
          background: #fff;
          color: #64748b;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .toggle-button:hover {
          border-color: #3b82f6;
          color: #3b82f6;
        }

        .toggle-button--active {
          background: #3b82f6;
          color: #fff;
          border-color: #2563eb;
        }

        .view-indicator {
          text-align: center;
          font-size: 0.875rem;
          color: #64748b;
          font-style: italic;
        }

        @media (max-width: 640px) {
          .view-toggle-buttons {
            gap: 0.5rem;
          }

          .toggle-button {
            padding: 0.5rem 1rem;
            font-size: 0.8rem;
          }
        }
      `}</style>
    </div>
  );
}
