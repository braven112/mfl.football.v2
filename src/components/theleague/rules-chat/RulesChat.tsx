import React, { useState, useEffect, useCallback } from 'react';
import type { RulesQA } from '../../../types/rules-qa';
import { filterByRelevance, wordOverlapScore } from '../../../utils/rules-qa-matching';
import QACard from './QACard';
import AskInput from './AskInput';

interface TeamIcon {
  franchiseId: string;
  icon: string;
}

interface Props {
  preSeeded: RulesQA[];
  isAuthenticated: boolean;
  isAdmin?: boolean;
  teamIcons?: TeamIcon[];
}

export default function RulesChat({ preSeeded, isAuthenticated, isAdmin, teamIcons }: Props) {
  const [allQAs, setAllQAs] = useState<RulesQA[]>(preSeeded);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [dynamicLoaded, setDynamicLoaded] = useState(false);

  const iconMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (teamIcons) {
      for (const t of teamIcons) map[t.franchiseId] = t.icon;
    }
    return map;
  }, [teamIcons]);

  // Fetch dynamic Q&As from Redis on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/rules-qa', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.items && Array.isArray(data.items)) {
          // Merge: dynamic items that aren't in the seed set
          const seedIds = new Set(preSeeded.map(q => q.id));
          const dynamic = (data.items as RulesQA[]).filter(q => !seedIds.has(q.id));
          setAllQAs(prev => {
            const merged = [...dynamic, ...prev];
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return merged;
          });
          setDynamicLoaded(true);
        }
      })
      .catch(() => setDynamicLoaded(true));
  }, [isAuthenticated, preSeeded]);

  // Filter displayed Q&As based on search
  const displayedQAs = searchText.trim().length >= 3
    ? filterByRelevance(searchText, allQAs, 0.25)
    : allQAs;

  // Check if current search text closely matches an existing question
  const hasCloseMatch = searchText.trim().length >= 10 &&
    allQAs.some(qa => wordOverlapScore(searchText, qa.question) >= 0.6);

  const handleSubmit = useCallback(async (question: string) => {
    if (!isAuthenticated) {
      setError('You must be logged in to ask questions.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/rules-qa', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      if (data.wasDuplicate) {
        setSearchText('');
        setError(null);
        setNewId(data.qa.id);
        setTimeout(() => setNewId(null), 3000);
      } else {
        setAllQAs(prev => [data.qa, ...prev]);
        setSearchText('');
        setNewId(data.qa.id);
        setTimeout(() => setNewId(null), 3000);
      }
    } catch {
      setError('Failed to submit question. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this Q&A? This cannot be undone.')) return;

    try {
      const res = await fetch('/api/rules-qa', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        setAllQAs(prev => prev.filter(qa => qa.id !== id));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete');
      }
    } catch {
      setError('Failed to delete question.');
    }
  }, []);

  return (
    <div className="rqa">
      {isAuthenticated ? (
        <AskInput
          onSubmit={handleSubmit}
          isLoading={isLoading}
          hasCloseMatch={hasCloseMatch}
          searchText={searchText}
          onSearchChange={setSearchText}
        />
      ) : (
        <div className="rqa-login-prompt">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Sign in to ask Roger a question</span>
        </div>
      )}

      {error && (
        <div className="rqa-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
          </svg>
          {error}
        </div>
      )}

      <div className="rqa-list">
        {displayedQAs.length === 0 && searchText.trim().length >= 3 ? (
          <div className="rqa-empty">
            No matching questions found. {isAuthenticated ? 'Ask a new one above!' : ''}
          </div>
        ) : (
          displayedQAs.map(qa => (
            <QACard
              key={qa.id}
              qa={qa}
              isNew={qa.id === newId}
              isAdmin={isAdmin}
              teamIcon={qa.askedBy ? iconMap[qa.askedBy.franchiseId] : undefined}
              onDelete={isAdmin && !qa.isPreSeeded ? handleDelete : undefined}
            />
          ))
        )}
      </div>

      {displayedQAs.length > 0 && (
        <div className="rqa-count">
          {displayedQAs.length} question{displayedQAs.length !== 1 ? 's' : ''}
          {searchText.trim().length >= 3 ? ` matching "${searchText.trim()}"` : ''}
        </div>
      )}
    </div>
  );
}
