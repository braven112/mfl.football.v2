import React, { useState } from 'react';
import type { TradeBuilderDraftPick, DraftPickKey } from '../../../types/trade-builder';

interface Props {
  draftPicks: TradeBuilderDraftPick[];
  selectedPicks: DraftPickKey[];
  onAdd: (pick: DraftPickKey) => void;
  onRemove: (pick: DraftPickKey) => void;
}

function pickMatches(a: DraftPickKey, b: DraftPickKey): boolean {
  return (
    a.year === b.year &&
    a.round === b.round &&
    a.originalPickFor === b.originalPickFor
  );
}

export default function DraftPickSelector({
  draftPicks,
  selectedPicks,
  onAdd,
  onRemove,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const availablePicks = draftPicks.filter(
    (dp) =>
      !selectedPicks.some((sp) =>
        pickMatches(sp, {
          year: dp.year,
          round: dp.round,
          originalPickFor: dp.originalPickFor,
        })
      )
  );

  const selectedPickDetails = selectedPicks.map((sp) => {
    const detail = draftPicks.find((dp) =>
      pickMatches(sp, {
        year: dp.year,
        round: dp.round,
        originalPickFor: dp.originalPickFor,
      })
    );
    return { ...sp, originalTeamName: detail?.originalTeamName ?? sp.originalPickFor };
  });

  const formatRound = (round: string) => {
    const num = parseInt(round, 10);
    if (num === 1) return '1st';
    if (num === 2) return '2nd';
    if (num === 3) return '3rd';
    return `${num}th`;
  };

  return (
    <div className="draft-picks">
      <div className="draft-picks__header">
        <h3 className="draft-picks__title">Draft Picks</h3>
        {draftPicks.length > 0 && (
          <button
            className="draft-picks__toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide' : `+ Add Pick`}
          </button>
        )}
      </div>

      {selectedPickDetails.length > 0 && (
        <div className="draft-picks__selected">
          {selectedPickDetails.map((pick) => (
            <div
              key={`${pick.year}-${pick.round}-${pick.originalPickFor}`}
              className="draft-picks__badge"
            >
              <span>
                {pick.year} {formatRound(pick.round)}
                {pick.originalPickFor !== pick.originalPickFor && (
                  <span className="draft-picks__via"> via {pick.originalTeamName}</span>
                )}
              </span>
              <button
                className="draft-picks__remove"
                onClick={() => onRemove(pick)}
                aria-label={`Remove ${pick.year} round ${pick.round} pick`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {expanded && availablePicks.length > 0 && (
        <div className="draft-picks__available">
          {availablePicks.map((dp) => {
            const key = { year: dp.year, round: dp.round, originalPickFor: dp.originalPickFor };
            return (
              <button
                key={`${dp.year}-${dp.round}-${dp.originalPickFor}`}
                className="draft-picks__option"
                onClick={() => onAdd(key)}
              >
                {dp.year} {formatRound(dp.round)}
                {dp.originalPickFor !== dp.originalPickFor && (
                  <span className="draft-picks__via"> (via {dp.originalTeamName})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {draftPicks.length === 0 && (
        <div className="draft-picks__empty">No draft picks available</div>
      )}

      <style>{`
        .draft-picks__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .draft-picks__title {
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
          margin: 0;
        }
        .draft-picks__toggle {
          background: none;
          border: none;
          color: var(--primary-color, #1c497c);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0.25rem;
        }
        .draft-picks__toggle:hover {
          text-decoration: underline;
        }
        .draft-picks__selected {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: 0.5rem;
        }
        .draft-picks__badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.5rem;
          background: #ede9fe;
          color: #5b21b6;
          border-radius: 0.375rem;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .draft-picks__via {
          font-weight: 500;
          opacity: 0.8;
        }
        .draft-picks__remove {
          background: none;
          border: none;
          color: #5b21b6;
          font-size: 1rem;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .draft-picks__remove:hover {
          color: #dc2626;
        }
        .draft-picks__available {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: 0.5rem;
        }
        .draft-picks__option {
          padding: 0.25rem 0.625rem;
          border: 1px dashed var(--primary-content-border-color, #d1d5db);
          border-radius: 0.375rem;
          background: transparent;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--text-color, #1f2937);
          transition: all 0.1s ease;
        }
        .draft-picks__option:hover {
          border-color: var(--primary-color, #1c497c);
          background: var(--primary-light-bg, #f0f4f8);
        }
        .draft-picks__empty {
          font-size: 0.75rem;
          color: var(--muted-text-color, #6b7280);
          margin-top: 0.25rem;
        }
      `}</style>
    </div>
  );
}
