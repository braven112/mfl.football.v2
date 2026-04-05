import React, { useMemo } from 'react';
import type { DraftRoomPlayer, DraftRoomPick, DraftQueueItem, DraftContext } from '../../../types/draft-room';
import { PlayerCell } from '../PlayerCell.tsx';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;

interface PlayerPoolPanelProps {
  players: DraftRoomPlayer[];
  picks: DraftRoomPick[];
  queue: DraftQueueItem[];
  searchQuery: string;
  positionFilter: string | null;
  onSearchChange: (query: string) => void;
  onPositionFilterChange: (pos: string | null) => void;
  onAddToQueue: (playerId: string) => void;
  rookiesOnly: boolean;
  onRookiesOnlyChange: (value: boolean) => void;
  draftContext: DraftContext;
}

export function PlayerPoolPanel({
  players,
  picks,
  queue,
  searchQuery,
  positionFilter,
  onSearchChange,
  onPositionFilterChange,
  onAddToQueue,
  rookiesOnly,
  onRookiesOnlyChange,
  draftContext,
}: PlayerPoolPanelProps) {
  // Build set of drafted player IDs
  const draftedIds = useMemo(
    () => new Set(picks.filter((p) => p.playerId).map((p) => p.playerId)),
    [picks]
  );

  // Build set of queued player IDs for button state
  const queuedIds = useMemo(
    () => new Set(queue.map((i) => i.playerId)),
    [queue]
  );

  // Filter available players
  const { filteredPlayers, availableCount, totalMatches, rookieCount } = useMemo(() => {
    let list = players.filter((p) => !draftedIds.has(p.id));
    const available = list.length;

    // Count rookies in the full available pool for the badge
    const rookieCount = list.filter((p) => p.isRookie).length;

    // Rookie filter — applied before position/search (broadest exclusion first)
    if (rookiesOnly) {
      list = list.filter((p) => p.isRookie === true);
    }

    if (positionFilter) {
      list = list.filter((p) => p.position === positionFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.nflTeam.toLowerCase().includes(q)
      );
    }

    const total = list.length;
    return { filteredPlayers: list.slice(0, 100), availableCount: available, totalMatches: total, rookieCount };
  }, [players, draftedIds, rookiesOnly, positionFilter, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--content-border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            color: 'var(--color-gray-900, #111827)',
            paddingLeft: '0.625rem',
            borderLeft: '2px solid var(--color-primary, #1c497c)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}>
            Available Players
          </span>
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--color-gray-400, #9ca3af)',
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <strong style={{ color: 'var(--color-gray-700, #374151)', fontWeight: 600 }}>
              {availableCount}
            </strong>
          </span>
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Filter players by name"
          className="dr-search-input"
          style={{
            width: '100%',
            padding: '0.375rem 0.625rem',
            border: '1px solid var(--content-border, #e2e8f0)',
            borderRadius: 'var(--radius-md, 0.5rem)',
            fontSize: '0.8125rem',
            background: 'var(--color-gray-50, #f9fafb)',
          }}
        />

        {/* Rookies toggle — only shown in rookie draft context */}
        {draftContext === 'rookie' && (
          <button
            type="button"
            role="switch"
            aria-pressed={rookiesOnly}
            aria-label={
              rookiesOnly
                ? `Showing rookies only (${rookieCount} available). Press to show all players.`
                : `Showing all players. Press to show rookies only (${rookieCount} available).`
            }
            onClick={() => onRookiesOnlyChange(!rookiesOnly)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              marginTop: '0.375rem',
              marginBottom: '0.125rem',
              padding: '0.25rem 0.625rem',
              borderRadius: 'var(--radius-full, 9999px)',
              border: rookiesOnly
                ? '1.5px solid var(--color-primary, #1c497c)'
                : '1.5px dashed var(--color-gray-300, #d1d5db)',
              background: rookiesOnly ? 'var(--color-primary, #1c497c)' : 'transparent',
              color: rookiesOnly ? '#ffffff' : 'var(--color-gray-500, #6b7280)',
              fontSize: '0.6875rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {rookiesOnly && (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            Rookies
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '1.125rem',
              height: '1.125rem',
              padding: '0 0.25rem',
              borderRadius: 'var(--radius-full, 9999px)',
              fontSize: '0.5625rem',
              fontWeight: 700,
              lineHeight: 1,
              background: rookiesOnly ? 'rgba(255,255,255,0.2)' : 'var(--color-gray-100, #f3f4f6)',
              color: rookiesOnly ? '#ffffff' : 'var(--color-gray-600, #4b5563)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {rookieCount}
            </span>
          </button>
        )}

        {/* Position filters */}
        <div
          role="radiogroup"
          aria-label="Filter by position"
          style={{ display: 'flex', gap: '0.25rem', marginTop: '0.375rem', flexWrap: 'wrap' }}
        >
          {POSITIONS.map((pos) => {
            const isActive = pos === 'ALL' ? !positionFilter : positionFilter === pos;
            return (
              <button
                key={pos}
                role="radio"
                aria-checked={isActive}
                aria-label={`Filter by ${pos === 'ALL' ? 'all positions' : pos + ' position'}`}
                onClick={() => onPositionFilterChange(pos === 'ALL' ? null : pos)}
                className="dr-pos-filter"
                style={{
                  padding: '0.1875rem 0.5rem',
                  borderRadius: 'var(--radius-full, 9999px)',
                  border: 'none',
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  background: isActive ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-100, #f3f4f6)',
                  color: isActive ? '#ffffff' : 'var(--color-gray-500, #6b7280)',
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
              >
                {pos}
              </button>
            );
          })}
        </div>
      </div>

      {/* Player list */}
      <div style={{ flex: 1, overflow: 'auto' }} aria-label="Available players list">
        {filteredPlayers.length === 0 ? (
          <div style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'var(--color-gray-400, #9ca3af)',
            fontSize: '0.8125rem',
          }}>
            {searchQuery || positionFilter ? 'No players match your filters.' : 'No players available.'}
          </div>
        ) : (
          <div>
            {filteredPlayers.map((player) => {
              const isQueued = queuedIds.has(player.id);
              return (
                <div
                  key={player.id}
                  className="dr-player-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.375rem 0.75rem',
                    borderBottom: '1px solid var(--color-gray-50, #f9fafb)',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerCell
                      name={player.name}
                      headshot={player.headshot}
                      position={player.position}
                      nflTeam={player.nflTeam}
                      size="compact"
                    />
                  </div>
                  <button
                    onClick={() => !isQueued && onAddToQueue(player.id)}
                    aria-label={isQueued ? `${player.name} is in your queue` : `Add ${player.name} to queue`}
                    disabled={isQueued}
                    className="dr-add-queue-btn"
                    style={{
                      flexShrink: 0,
                      width: '1.5rem',
                      height: '1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1.5px solid',
                      borderColor: isQueued
                        ? 'var(--color-primary, #1c497c)'
                        : 'var(--color-gray-300, #d1d5db)',
                      borderRadius: 'var(--radius-sm, 0.25rem)',
                      background: isQueued ? 'var(--color-primary, #1c497c)' : 'transparent',
                      color: isQueued ? '#ffffff' : 'var(--color-gray-400, #9ca3af)',
                      cursor: isQueued ? 'default' : 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      lineHeight: 1,
                      transition: 'all 0.15s ease',
                      padding: 0,
                    }}
                  >
                    {isQueued ? '✓' : '+'}
                  </button>
                </div>
              );
            })}
            {totalMatches > 100 && (
              <div style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.6875rem',
                color: 'var(--color-gray-400, #9ca3af)',
                textAlign: 'center',
                borderTop: '1px solid var(--color-gray-50, #f9fafb)',
              }}>
                Showing 100 of {totalMatches} — refine your search
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
