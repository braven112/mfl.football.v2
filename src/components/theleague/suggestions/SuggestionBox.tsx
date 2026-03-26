import React, { useState, useEffect, useCallback } from 'react';
import type { Idea, Comment, IdeaCategory, WebsiteFields } from '../../../types/suggestions';
import IdeaComposer from './IdeaComposer';
import IdeaCard from './IdeaCard';
import IdeaDetail from './IdeaDetail';

interface SubmitData {
  title: string;
  body: string;
  category: IdeaCategory;
  websiteFields?: WebsiteFields;
  imageUrls?: string[];
}

interface TeamIcon {
  franchiseId: string;
  icon: string;
}

interface Props {
  isAuthenticated: boolean;
  isAdmin?: boolean;
  teamIcons?: TeamIcon[];
  userFranchiseId?: string;
}

export default function SuggestionBox({ isAuthenticated, isAdmin, teamIcons, userFranchiseId }: Props) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedComments, setSelectedComments] = useState<Comment[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<IdeaCategory | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const iconMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (teamIcons) {
      for (const t of teamIcons) map[t.franchiseId] = t.icon;
    }
    return map;
  }, [teamIcons]);

  // Load ideas on mount
  useEffect(() => {
    if (!isAuthenticated) { setIsLoading(false); return; }
    fetch('/api/suggestions/ideas', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.ideas) setIdeas(data.ideas);
      })
      .catch(() => setError('Failed to load ideas'))
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

  // Handle hash-based navigation
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#idea-')) {
        setSelectedIdeaId(hash.slice(6));
      } else {
        setSelectedIdeaId(null);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Load comments when selecting an idea
  useEffect(() => {
    if (!selectedIdeaId || !isAuthenticated) return;
    fetch(`/api/suggestions/ideas/${selectedIdeaId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.comments) setSelectedComments(data.comments);
        // Update the idea in our list with fresh data
        if (data.idea) {
          setIdeas(prev => prev.map(i => i.id === data.idea.id ? data.idea : i));
        }
      })
      .catch(() => {});
  }, [selectedIdeaId, isAuthenticated]);

  const handleCreateIdea = useCallback(async (submitData: SubmitData) => {
    setError(null);
    const res = await fetch('/api/suggestions/ideas', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitData),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to create idea');
      return;
    }
    setIdeas(prev => [data.idea, ...prev]);
  }, []);

  const handleDeleteIdea = useCallback(async (id: string) => {
    if (!confirm('Delete this idea? This cannot be undone.')) return;
    const res = await fetch(`/api/suggestions/ideas/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      setIdeas(prev => prev.filter(i => i.id !== id));
      if (selectedIdeaId === id) {
        window.location.hash = '';
        setSelectedIdeaId(null);
      }
    }
  }, [selectedIdeaId]);

  const handleSelectIdea = useCallback((id: string) => {
    window.location.hash = `idea-${id}`;
  }, []);

  const handleBack = useCallback(() => {
    window.location.hash = '';
  }, []);

  const handleEditIdea = useCallback(async (id: string, title: string, body: string) => {
    const res = await fetch(`/api/suggestions/ideas/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    const data = await res.json();
    if (res.ok && data.idea) {
      setIdeas(prev => prev.map(i => i.id === id ? data.idea : i));
    }
    return res.ok;
  }, []);

  const handleAddComment = useCallback(async (ideaId: string, body: string, parentId?: string, imageUrls?: string[]) => {
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/comments`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaId, body, parentId, imageUrls }),
    });
    const data = await res.json();
    if (res.ok && data.comment) {
      setSelectedComments(prev => [...prev, data.comment]);
      // Update comment count
      setIdeas(prev => prev.map(i =>
        i.id === ideaId ? { ...i, commentCount: (i.commentCount || 0) + 1, lastActivityAt: new Date().toISOString() } : i
      ));
      // Scroll to the new comment after render
      setTimeout(() => {
        const el = document.querySelector('.sb-thread__node:last-child');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
    return res.ok;
  }, []);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    const res = await fetch(`/api/suggestions/comments/${commentId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      setSelectedComments(prev =>
        prev.map(c => c.id === commentId ? { ...c, body: '[deleted]', deletedAt: new Date().toISOString(), images: [] } : c)
      );
    }
  }, []);

  const handleEditComment = useCallback(async (commentId: string, body: string) => {
    const res = await fetch(`/api/suggestions/comments/${commentId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (res.ok && data.comment) {
      setSelectedComments(prev => prev.map(c => c.id === commentId ? data.comment : c));
    }
    return res.ok;
  }, []);

  const handleIdeaReaction = useCallback(async (ideaId: string, emoji: string) => {
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/reactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json();
    if (res.ok && data.reactions) {
      setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, reactions: data.reactions } : i));
    }
  }, []);

  const handleCommentReaction = useCallback(async (commentId: string, emoji: string) => {
    const res = await fetch(`/api/suggestions/comments/${commentId}/reactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json();
    if (res.ok && data.reactions) {
      setSelectedComments(prev => prev.map(c => c.id === commentId ? { ...c, reactions: data.reactions } : c));
    }
  }, []);

  // Build team name lookup for reaction tooltips
  const teamNameMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (teamIcons) {
      for (const t of teamIcons) map[t.franchiseId] = t.franchiseId; // placeholder
    }
    // Populate from ideas/comments authors
    for (const idea of ideas) {
      map[idea.author.franchiseId] = idea.author.teamName;
    }
    for (const c of selectedComments) {
      map[c.author.franchiseId] = c.author.teamName;
    }
    return map;
  }, [teamIcons, ideas, selectedComments]);

  // ── Admin actions ──
  const adminAction = useCallback(async (ideaId: string, endpoint: string, method = 'POST', body?: unknown) => {
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/${endpoint}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (res.ok && data.idea) {
      setIdeas(prev => prev.map(i => i.id === ideaId ? data.idea : i));
    }
    return res.ok;
  }, []);

  const handleSetStatus = useCallback((ideaId: string, status: string) => {
    adminAction(ideaId, 'status', 'PATCH', { status });
  }, [adminAction]);

  const handleTogglePin = useCallback((ideaId: string) => {
    adminAction(ideaId, 'pin');
  }, [adminAction]);

  const handleToggleLock = useCallback((ideaId: string) => {
    adminAction(ideaId, 'lock');
  }, [adminAction]);

  const handleToggleArchive = useCallback((ideaId: string) => {
    adminAction(ideaId, 'archive');
  }, [adminAction]);

  const handleCreatePoll = useCallback(async (ideaId: string, options: string[], anonymous: boolean) => {
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/poll`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options, anonymous }),
    });
    const data = await res.json();
    if (res.ok && data.idea) {
      setIdeas(prev => prev.map(i => i.id === ideaId ? data.idea : i));
    }
    return res.ok;
  }, []);

  const handleVote = useCallback(async (ideaId: string, optionId: string) => {
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/poll/vote`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    });
    const data = await res.json();
    if (res.ok && data.poll) {
      setIdeas(prev => prev.map(i => i.id === ideaId ? { ...i, poll: data.poll } : i));
    }
  }, []);

  const handleDeletePoll = useCallback(async (ideaId: string) => {
    if (!confirm('Remove the poll from this idea?')) return;
    const res = await fetch(`/api/suggestions/ideas/${ideaId}/poll`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json();
    if (res.ok && data.idea) {
      setIdeas(prev => prev.map(i => i.id === ideaId ? data.idea : i));
    }
  }, []);

  // Mark last-seen on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/suggestions/activity', { method: 'POST', credentials: 'include' }).catch(() => {});
  }, [isAuthenticated]);

  const selectedIdea = selectedIdeaId ? ideas.find(i => i.id === selectedIdeaId) : null;

  // Detail view
  if (selectedIdea) {
    return (
      <IdeaDetail
        idea={selectedIdea}
        comments={selectedComments}
        iconMap={iconMap}
        teamNameMap={teamNameMap}
        isAdmin={isAdmin}
        userFranchiseId={userFranchiseId}
        isAuthenticated={isAuthenticated}
        onBack={handleBack}
        onEdit={handleEditIdea}
        onDelete={handleDeleteIdea}
        onAddComment={handleAddComment}
        onEditComment={handleEditComment}
        onDeleteComment={handleDeleteComment}
        onIdeaReaction={handleIdeaReaction}
        onCommentReaction={handleCommentReaction}
        onSetStatus={handleSetStatus}
        onTogglePin={handleTogglePin}
        onToggleLock={handleToggleLock}
        onToggleArchive={handleToggleArchive}
        onCreatePoll={handleCreatePoll}
        onVote={handleVote}
        onDeletePoll={handleDeletePoll}
      />
    );
  }

  // List view
  return (
    <div className="sb">
      {isAuthenticated ? (
        <IdeaComposer onSubmit={handleCreateIdea} />
      ) : (
        <div className="sb-login-prompt">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Sign in to submit an idea</span>
        </div>
      )}

      {error && (
        <div className="sb-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
          </svg>
          {error}
        </div>
      )}

      {/* Category filter pills */}
      {ideas.length > 0 && (
        <div className="sb-filter" role="radiogroup" aria-label="Filter by category">
          {([['all', 'All', ''], ['rule-change', 'Rules', 'icon-gavel'], ['website', 'Website', 'icon-wrench'], ['general', 'General', 'icon-beer']] as const).map(([value, label, spriteId]) => (
            <button
              key={value}
              type="button"
              className={`sb-filter__pill${categoryFilter === value ? ' sb-filter__pill--active' : ''}`}
              onClick={() => setCategoryFilter(value)}
              role="radio"
              aria-checked={categoryFilter === value}
            >
              {spriteId && <svg className="sb-filter__icon" aria-hidden="true"><use href={`/assets/icons/sprite.svg#${spriteId}`} /></svg>}
              {label}
              <span className="sb-filter__count">
                {value === 'all' ? ideas.length : ideas.filter(i => i.category === value).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="sb-loading">Loading ideas...</div>
      ) : ideas.length === 0 ? (
        <div className="sb-empty">
          No ideas yet. Be the first to suggest something!
        </div>
      ) : (
        <div className="sb-list">
          {ideas
            .filter(idea => categoryFilter === 'all' || idea.category === categoryFilter)
            .map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              teamIcon={iconMap[idea.author.franchiseId]}
              isAdmin={isAdmin}
              isOwner={idea.author.franchiseId === userFranchiseId}
              onSelect={handleSelectIdea}
              onDelete={handleDeleteIdea}
            />
          ))}
          <div className="sb-count">
            {categoryFilter === 'all'
              ? `${ideas.length} idea${ideas.length !== 1 ? 's' : ''}`
              : `${ideas.filter(i => i.category === categoryFilter).length} of ${ideas.length} ideas`}
          </div>
        </div>
      )}
    </div>
  );
}
