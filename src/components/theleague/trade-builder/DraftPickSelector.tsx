import React, { useState } from 'react';
import type { TradeBuilderDraftPick, DraftPickKey } from '../../../types/trade-builder';

interface Props {
  draftPicks: TradeBuilderDraftPick[];
  selectedPicks: DraftPickKey[];
  teamFranchiseId: string;
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
  teamFranchiseId,
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
    return {
      ...sp,
      originalTeamName: detail?.originalTeamName ?? sp.originalPickFor,
      pickInRound: detail?.pickInRound,
    };
  });

  // Format the round portion of a pick label.
  // Current-year picks have a known slot → "2.02"; future picks fall back to "2nd".
  const formatRound = (round: string, pickInRound?: number) => {
    if (pickInRound != null) {
      return `${round}.${String(pickInRound).padStart(2, '0')}`;
    }
    const num = parseInt(round, 10);
    if (num === 1) return '1st';
    if (num === 2) return '2nd';
    if (num === 3) return '3rd';
    return `${num}th`;
  };

  // Group picks by year for organized display
  const groupByYear = <T extends { year: string }>(picks: T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const pick of picks) {
      const existing = grouped.get(pick.year) ?? [];
      existing.push(pick);
      grouped.set(pick.year, existing);
    }
    return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)));
  };

  const availableByYear = groupByYear(availablePicks);
  const selectedByYear = groupByYear(selectedPickDetails);

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
          {[...selectedByYear.entries()].map(([year, picks]) => (
            <React.Fragment key={year}>
              {selectedByYear.size > 1 && (
                <div className="draft-picks__year-label">{year}</div>
              )}
              {picks.map((pick) => (
                <div
                  key={`${pick.year}-${pick.round}-${pick.originalPickFor}`}
                  className="draft-picks__badge"
                >
                  <span>
                    {pick.year} {formatRound(pick.round, pick.pickInRound)}
                    {pick.originalPickFor !== teamFranchiseId && (
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
            </React.Fragment>
          ))}
        </div>
      )}

      {expanded && availablePicks.length > 0 && (
        <div className="draft-picks__available">
          {[...availableByYear.entries()].map(([year, picks]) => (
            <React.Fragment key={year}>
              <div className="draft-picks__year-divider">{year} Draft</div>
              {picks.map((dp) => {
                const key = { year: dp.year, round: dp.round, originalPickFor: dp.originalPickFor };
                return (
                  <button
                    key={`${dp.year}-${dp.round}-${dp.originalPickFor}`}
                    className="draft-picks__option"
                    onClick={() => onAdd(key)}
                  >
                    {formatRound(dp.round, dp.pickInRound)}
                    {dp.originalPickFor !== teamFranchiseId && (
                      <span className="draft-picks__via"> (via {dp.originalTeamName})</span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
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
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0;
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
        }
        .draft-picks__toggle {
          background: none;
          border: none;
          color: var(--color-primary, #1c497c);
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
          background: var(--color-franchise-tag-light, #ede9fe);
          color: var(--color-franchise-tag, #7c3aed);
          border-radius: var(--radius-sm, 0.25rem);
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
          color: var(--color-franchise-tag, #7c3aed);
          font-size: 1rem;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .draft-picks__remove:hover {
          color: var(--color-error, #dc2626);
        }
        .draft-picks__year-label {
          width: 100%;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-500, #6b7280);
          margin-top: 0.25rem;
        }
        .draft-picks__year-divider {
          width: 100%;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-500, #6b7280);
          padding-bottom: 0.125rem;
          border-bottom: 1px solid var(--content-border, #e2e8f0);
        }
        .draft-picks__available {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: 0.5rem;
        }
        .draft-picks__option {
          padding: 0.25rem 0.625rem;
          border: 1px dashed var(--content-border, #d1d5db);
          border-radius: var(--radius-sm, 0.25rem);
          background: transparent;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--color-gray-900, #111827);
          transition: all 0.1s ease;
        }
        .draft-picks__option:hover {
          border-color: var(--color-primary, #1c497c);
          background: var(--color-gray-50, #f9fafb);
        }
        .draft-picks__toggle:focus-visible,
        .draft-picks__option:focus-visible,
        .draft-picks__remove:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .draft-picks__empty {
          font-size: 0.75rem;
          color: var(--color-gray-500, #6b7280);
          margin-top: 0.25rem;
        }
      `}</style>
    </div>
  );
}
