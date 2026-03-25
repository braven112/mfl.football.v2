import React from 'react';
import type { Poll } from '../../../types/suggestions';

interface Props {
  poll: Poll;
  userFranchiseId?: string;
  teamNameMap?: Record<string, string>;
  onVote: (optionId: string) => void;
  isAuthenticated: boolean;
}

export default function PollCard({ poll, userFranchiseId, teamNameMap, onVote, isAuthenticated }: Props) {
  const totalVotes = poll.votes.length;
  const userVote = userFranchiseId ? poll.votes.find(v => v.franchiseId === userFranchiseId) : null;
  const isClosed = !!poll.closedAt;

  return (
    <div className="sb-poll">
      <div className="sb-poll__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 20V10M12 20V4M6 20v-6"/>
        </svg>
        <span className="sb-poll__title">Poll</span>
        {poll.anonymous && <span className="sb-poll__anon">Anonymous</span>}
        {isClosed && <span className="sb-poll__closed">Closed</span>}
        <span className="sb-poll__vote-count">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
      </div>

      <div className="sb-poll__options">
        {poll.options.map(option => {
          const optionVotes = poll.votes.filter(v => v.optionId === option.id);
          const pct = totalVotes > 0 ? Math.round((optionVotes.length / totalVotes) * 100) : 0;
          const isSelected = userVote?.optionId === option.id;
          const voters = !poll.anonymous && teamNameMap
            ? optionVotes.map(v => teamNameMap[v.franchiseId] ?? 'Unknown')
            : [];

          return (
            <button
              key={option.id}
              type="button"
              className={`sb-poll__option${isSelected ? ' sb-poll__option--selected' : ''}`}
              onClick={() => !isClosed && isAuthenticated && onVote(option.id)}
              disabled={isClosed || !isAuthenticated}
              title={voters.length > 0 ? voters.join(', ') : undefined}
            >
              <div className="sb-poll__bar" style={{ width: `${pct}%` }} />
              <span className="sb-poll__label">{option.label}</span>
              <span className="sb-poll__pct">{pct}%</span>
              {isSelected && (
                <svg className="sb-poll__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Show voter names for non-anonymous polls */}
      {!poll.anonymous && teamNameMap && totalVotes > 0 && (
        <div className="sb-poll__voters">
          {poll.options.map(option => {
            const optionVoters = poll.votes
              .filter(v => v.optionId === option.id)
              .map(v => teamNameMap[v.franchiseId] ?? 'Unknown');
            if (optionVoters.length === 0) return null;
            return (
              <div key={option.id} className="sb-poll__voter-row">
                <span className="sb-poll__voter-label">{option.label}:</span>
                <span className="sb-poll__voter-names">{optionVoters.join(', ')}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
