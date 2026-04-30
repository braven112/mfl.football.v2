import React, { useState, useEffect, useRef } from 'react';
import type {
  TradeBuilderTeam,
  TradeBuilderPlayer,
  TradeBuilderDraftPick,
  DraftPickKey,
  RookieExtensionSim,
  TeamTradeImpact,
  TradeSubmissionState,
} from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

interface Props {
  teamA: TradeBuilderTeam;
  teamB: TradeBuilderTeam;
  allTeams: TradeBuilderTeam[];
  teamAPlayers: TradeBuilderPlayer[];
  teamBPlayers: TradeBuilderPlayer[];
  teamADraftPicks: DraftPickKey[];
  teamBDraftPicks: DraftPickKey[];
  teamARookieExtensions: Record<string, RookieExtensionSim>;
  teamBRookieExtensions: Record<string, RookieExtensionSim>;
  impactA: TeamTradeImpact;
  impactB: TeamTradeImpact;
  submissionStatus: TradeSubmissionState;
  /** The logged-in user's franchise ID — used to show "Trading as" and validate */
  userFranchiseId: string | null;
  onSubmit: (message: string) => void;
  onClose: () => void;
  onViewMyTrades?: () => void;
}

export default function TradeConfirmationModal({
  teamA,
  teamB,
  allTeams,
  teamAPlayers,
  teamBPlayers,
  teamADraftPicks,
  teamBDraftPicks,
  teamARookieExtensions,
  teamBRookieExtensions,
  impactA,
  impactB,
  submissionStatus,
  userFranchiseId,
  onSubmit,
  onClose,
  onViewMyTrades,
}: Props) {
  const [message, setMessage] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isSubmitting = submissionStatus.status === 'submitting';
  const isSuccess = submissionStatus.status === 'success';

  // Determine if the user's franchise is part of this trade
  const userIsTeamA = userFranchiseId === teamA.franchiseId;
  const userIsTeamB = userFranchiseId === teamB.franchiseId;
  const userIsPartOfTrade = userIsTeamA || userIsTeamB;
  const userTeam = userIsTeamA ? teamA : userIsTeamB ? teamB : null;

  // Lock body scroll when modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Focus trap + ESC handler — focus the dialog content, not the close button
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const modal = contentRef.current;
        if (!modal) return;
        const focusable = modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Focus the dialog content so screen reader announces the dialog label
    contentRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSubmitting]);

  // No auto-close — user clicks "Done" or "View My Trades" after success

  const formatPickLabel = (
    pick: DraftPickKey,
    teams: TradeBuilderTeam[],
    holdingTeam: TradeBuilderTeam,
  ) => {
    // Find the matching pick entry on any team — its `originalTeamName` and
    // `pickInRound` are already pre-computed by the page loader. We must NOT
    // use the *holding* team's name as the "via" — that's whoever currently
    // owns the pick, not the team it originated from.
    let dpEntry: TradeBuilderDraftPick | undefined;
    for (const t of teams) {
      dpEntry = t.draftPicks.find(
        dp =>
          dp.year === pick.year &&
          dp.round === pick.round &&
          dp.originalPickFor === pick.originalPickFor,
      );
      if (dpEntry) break;
    }

    const roundLabel = dpEntry?.pickInRound != null
      ? `${pick.round}.${String(dpEntry.pickInRound).padStart(2, '0')}`
      : `Rd ${pick.round}`;

    // Suppress "(via X)" when the holding team is the original owner —
    // it's their own pick, redundant to display.
    const showVia = pick.originalPickFor !== holdingTeam.franchiseId;
    const viaName = dpEntry?.originalTeamName;
    const via = showVia && viaName ? ` (via ${viaName})` : '';

    return `${pick.year} ${roundLabel}${via}`;
  };

  const renderTeamSection = (
    team: TradeBuilderTeam,
    players: TradeBuilderPlayer[],
    picks: DraftPickKey[],
    extensions: Record<string, RookieExtensionSim>,
  ) => (
    <div className="tcm-team-section">
      <div className="tcm-team-header">
        <img src={team.icon} alt="" className="tcm-team-icon" />
        <span className="tcm-team-name">{team.nameShort || team.nameMedium}</span>
        <span className="tcm-team-label">gives up</span>
      </div>
      <div className="tcm-assets">
        {players.map(p => {
          const ext = extensions[p.id];
          return (
            <div key={p.id} className="tcm-asset-row">
              <img src={p.headshot} alt="" className="tcm-asset-avatar" />
              <span className="tcm-asset-name">{p.name}</span>
              <span className="tcm-asset-pos">{p.position}</span>
              <span className="tcm-asset-salary">
                {formatCurrency(ext ? ext.newSalary : p.salary)}
              </span>
            </div>
          );
        })}
        {picks.map((pick, i) => (
          <div key={`pick-${i}`} className="tcm-asset-row tcm-asset-row--pick">
            <span className="tcm-asset-name">{formatPickLabel(pick, allTeams, team)}</span>
            <span className="tcm-asset-pos">PICK</span>
          </div>
        ))}
        {players.length === 0 && picks.length === 0 && (
          <div className="tcm-asset-empty">No assets</div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="tcm-overlay"
      ref={overlayRef}
      onClick={isSubmitting ? undefined : onClose}
    >
      <div
        className="tcm-content"
        ref={contentRef}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tcm-title"
        tabIndex={-1}
      >
        <button
          className="tcm-close"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close"
          title="Close (ESC)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="tcm-body">
          <h2 id="tcm-title" className="tcm-title">Confirm Trade Proposal</h2>

          {userTeam && (
            <div className="tcm-trading-as">
              <img src={userTeam.icon} alt="" className="tcm-trading-as__icon" />
              <span className="tcm-trading-as__label">Proposing as</span>
              <span className="tcm-trading-as__name">{userTeam.nameShort || userTeam.nameMedium}</span>
            </div>
          )}

          {renderTeamSection(teamA, teamAPlayers, teamADraftPicks, teamARookieExtensions)}

          <div className="tcm-swap-indicator" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {renderTeamSection(teamB, teamBPlayers, teamBDraftPicks, teamBRookieExtensions)}

          <div className="tcm-cap-impact">
            <div className="tcm-cap-card">
              <span className={`tcm-cap-value ${impactA.capDelta[0] >= 0 ? 'tcm-cap-value--positive' : 'tcm-cap-value--negative'}`}>
                {impactA.capDelta[0] >= 0 ? '+' : ''}{formatCurrency(impactA.capDelta[0])}
              </span>
              <span className="tcm-cap-label">{teamA.nameShort || teamA.abbrev} cap</span>
            </div>
            <div className="tcm-cap-card">
              <span className={`tcm-cap-value ${impactB.capDelta[0] >= 0 ? 'tcm-cap-value--positive' : 'tcm-cap-value--negative'}`}>
                {impactB.capDelta[0] >= 0 ? '+' : ''}{formatCurrency(impactB.capDelta[0])}
              </span>
              <span className="tcm-cap-label">{teamB.nameShort || teamB.abbrev} cap</span>
            </div>
          </div>

          <div className="tcm-message-field">
            <label htmlFor="tcm-message" className="tcm-message-label">
              Add a message (optional)
            </label>
            <textarea
              id="tcm-message"
              className="tcm-textarea"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="e.g. This helps your WR depth..."
              maxLength={500}
              rows={2}
              disabled={isSubmitting || isSuccess}
              aria-describedby="tcm-char-count"
            />
            <span id="tcm-char-count" className="tcm-char-count">{message.length}/500</span>
          </div>
        </div>

        <div className="tcm-footer">
          {!userIsPartOfTrade && (
            <div id="tcm-not-participant-error" className="tcm-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
              </svg>
              You must be one of the teams in this trade to submit it.
            </div>
          )}
          {submissionStatus.status === 'error' && (
            <div className="tcm-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
              </svg>
              {submissionStatus.errorMessage || 'Something went wrong'}
            </div>
          )}
          {isSuccess && (
            <div className="tcm-success" role="status">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Trade proposal sent to {teamB.nameShort || teamB.nameMedium}
            </div>
          )}
          <div className="tcm-footer-actions">
            {isSuccess ? (
              <>
                <button className="tcm-btn-cancel" onClick={onClose}>Done</button>
                {onViewMyTrades && (
                  <button className="tcm-btn-submit" onClick={() => { onClose(); onViewMyTrades(); }}>
                    View My Trades
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="tcm-btn-cancel"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="tcm-btn-submit"
                  onClick={() => onSubmit(message)}
                  disabled={isSubmitting || !userIsPartOfTrade}
                  aria-describedby={!userIsPartOfTrade ? 'tcm-not-participant-error' : undefined}
                >
                  {!userIsPartOfTrade ? 'Not Your Trade' : isSubmitting ? 'Sending...' : submissionStatus.status === 'error' ? 'Retry' : 'Send Proposal'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .tcm-overlay {
          position: fixed;
          inset: 0;
          z-index: 1001;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .tcm-content {
          position: relative;
          max-width: 480px;
          width: 100%;
          max-height: 88vh;
          border-radius: var(--radius-lg, 1rem);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          background: var(--color-white, #fff);
          display: flex;
          flex-direction: column;
          animation: tcm-enter 0.22s ease-out;
        }
        .tcm-content:focus { outline: none; }
        @keyframes tcm-enter {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .tcm-close {
          position: absolute;
          top: 0.75rem;
          right: 0.75rem;
          background: var(--color-gray-100, #f3f4f6);
          border: none;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--color-gray-500, #6b7280);
          z-index: 1;
        }
        .tcm-close:hover { background: var(--color-gray-200, #e5e7eb); }
        .tcm-close:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .tcm-close:disabled { opacity: 0.4; cursor: not-allowed; }
        .tcm-body {
          overflow-y: auto;
          padding: 1.75rem;
          flex: 1;
        }
        .tcm-title {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
          margin: 0 0 1.25rem 0;
        }
        .tcm-trading-as {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background: var(--color-gray-50, #f9fafb);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          margin-bottom: 1rem;
        }
        .tcm-trading-as__icon {
          width: 20px;
          height: 20px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .tcm-trading-as__label {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--color-gray-500, #6b7280);
        }
        .tcm-trading-as__name {
          font-size: 0.8125rem;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .tcm-team-section {
          margin-bottom: 0.5rem;
        }
        .tcm-team-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
        }
        .tcm-team-icon {
          width: 24px;
          height: 24px;
          object-fit: cover;
          object-position: top center;
          flex-shrink: 0;
          border-radius: var(--radius-full, 9999px);
          border: 1px solid var(--content-border, #e2e8f0);
          background: var(--color-gray-100, #f3f4f6);
        }
        .tcm-team-name {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
        }
        .tcm-team-label {
          font-size: 0.6875rem;
          font-weight: 500;
          color: var(--color-gray-500, #6b7280);
          text-transform: lowercase;
        }
        .tcm-assets {
          display: flex;
          flex-direction: column;
        }
        .tcm-asset-avatar {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-full, 9999px);
          object-fit: cover;
          object-position: top center;
          background: var(--color-gray-100, #f3f4f6);
          flex-shrink: 0;
        }
        .tcm-asset-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0;
          border-bottom: 1px solid var(--color-gray-50, #f9fafb);
        }
        .tcm-asset-name {
          flex: 1;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--color-gray-900, #111827);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tcm-asset-pos {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          background: var(--color-gray-100, #f3f4f6);
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-full, 9999px);
          color: var(--color-gray-600, #4b5563);
          flex-shrink: 0;
        }
        .tcm-asset-salary {
          font-size: 0.875rem;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: var(--color-gray-700, #374151);
          flex-shrink: 0;
        }
        .tcm-asset-row--pick .tcm-asset-name {
          font-weight: 500;
          color: var(--color-gray-700, #374151);
        }
        .tcm-asset-empty {
          font-size: 0.8125rem;
          color: var(--color-gray-500, #6b7280);
          padding: 0.375rem 0;
        }
        .tcm-swap-indicator {
          display: flex;
          justify-content: center;
          padding: 0.25rem 0;
          color: var(--color-gray-400, #9ca3af);
        }
        .tcm-cap-impact {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
          margin: 1rem 0;
        }
        .tcm-cap-card {
          background: var(--color-gray-50, #f9fafb);
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.625rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .tcm-cap-value {
          font-size: 1rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .tcm-cap-value--positive { color: var(--color-success-dark, #059669); }
        .tcm-cap-value--negative { color: var(--color-error, #dc2626); }
        .tcm-cap-label {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--color-gray-500, #6b7280);
        }
        .tcm-message-field {
          position: relative;
        }
        .tcm-message-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-gray-500, #6b7280);
          margin-bottom: 0.375rem;
        }
        .tcm-textarea {
          width: 100%;
          min-height: 3rem;
          max-height: 6rem;
          resize: vertical;
          padding: 0.625rem;
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-sm, 0.25rem);
          font-size: 0.875rem;
          font-family: inherit;
          color: var(--color-gray-900, #111827);
          background: var(--content-bg, #fff);
          box-sizing: border-box;
        }
        .tcm-textarea:focus-visible {
          outline: none;
          border-color: var(--color-primary, #1c497c);
          box-shadow: 0 0 0 3px rgba(28, 73, 124, 0.1);
        }
        .tcm-char-count {
          position: absolute;
          bottom: 0.375rem;
          right: 0.375rem;
          font-size: 0.6875rem;
          color: var(--color-gray-500, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .tcm-footer {
          padding: 1rem 1.75rem 1.25rem;
          border-top: 1px solid var(--content-border, #e2e8f0);
        }
        .tcm-error {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.75rem;
          background: var(--color-error-light, #fee2e2);
          border: 1px solid var(--color-error-border, #fecaca);
          border-radius: 0.375rem;
          color: var(--color-error, #dc2626);
          font-size: 0.8125rem;
          margin-bottom: 0.75rem;
        }
        .tcm-success {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.75rem;
          background: var(--color-success-light, #d1fae5);
          border: 1px solid var(--color-success-border, #a7f3d0);
          border-radius: 0.375rem;
          color: var(--color-success-dark, #059669);
          font-size: 0.8125rem;
          margin-bottom: 0.75rem;
        }
        .tcm-footer-actions {
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }
        .tcm-btn-cancel {
          background: transparent;
          border: none;
          color: var(--color-gray-500, #6b7280);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0.75rem 0.5rem;
        }
        .tcm-btn-cancel:hover { color: var(--color-gray-700, #374151); }
        .tcm-btn-cancel:disabled { opacity: 0.4; cursor: not-allowed; }
        .tcm-btn-cancel:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .tcm-btn-submit {
          flex: 1;
          background: var(--btn-primary-bg, #1c497c);
          color: #fff;
          border: none;
          border-radius: var(--radius-md, 0.5rem);
          padding: 0.75rem 1.25rem;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .tcm-btn-submit:hover:not(:disabled) { background: var(--btn-primary-bg-hover, #164066); }
        .tcm-btn-submit:disabled { opacity: 0.7; cursor: not-allowed; }
        .tcm-btn-submit:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        @media (max-width: 640px) {
          .tcm-overlay {
            align-items: flex-end;
            padding: 0;
          }
          .tcm-content {
            border-radius: 1rem 1rem 0 0;
            max-height: 92vh;
            animation: tcm-slide-up 0.26s ease-out;
          }
          @keyframes tcm-slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          .tcm-body { padding: 1.25rem; }
          .tcm-footer { padding: 1rem 1.25rem; }
          .tcm-asset-row { gap: 0.375rem; }
          .tcm-asset-name { font-size: 0.8125rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tcm-content { animation: none; }
          .tcm-btn-submit { transition: none; }
        }
      `}</style>
    </div>
  );
}
